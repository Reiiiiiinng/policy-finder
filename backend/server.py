"""
《政策找人》—— 原型后端（Python 标准库，零第三方依赖）

启动：
    python backend/server.py
默认监听 http://127.0.0.1:8000 ，同时托管 frontend 静态页面。

接口：
    GET  /api/health                 服务与数据库状态
    GET  /api/policies               政策列表（精简字段）
    GET  /api/policy/<id>            政策详情（全字段 + rag_text）
    POST /api/profile                文本 -> 老人画像
    POST /api/match                  画像/文本 -> 可能相关权益列表
    POST /api/explain                单条政策 -> 渲染后的推荐理由
"""

import email.message
import io
import json
import mimetypes
import os
import re
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import policy_engine as engine  # noqa: E402
import life_analysis  # noqa: E402
import semantic_discovery  # noqa: E402
import policy_assessment  # noqa: E402
import action_plan  # noqa: E402
import cleversee  # noqa: E402
from deepseek_client import DeepSeekError  # noqa: E402

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
PORT = int(os.environ.get("PORT", "8000"))

# 端到端自测回传端点（/__e2e_log）只在本地开发与测试里需要。
# 部署到公网时用 POLICY_ENV=production 关掉，避免把调试通道暴露出去。
E2E_ENABLED = os.environ.get("POLICY_ENV", "dev").strip().lower() != "production"
FOLLOWUP_SQLITE = os.environ.get("PF_FOLLOWUP_SQLITE") == "1"

DB = engine.load_database()
WEB_SEARCH = cleversee.SearchService()

DISCLAIMER = (
    "本页面由AI根据您描述的生活情况进行初步匹配，"
    "仅用于提示可能相关的公共服务权益，不代表已符合政策资格。"
    "最终资格由主管部门核定。"
)


def _protected_runtime():
    return FOLLOWUP_SQLITE and not E2E_ENABLED


def _followup_available(handler):
    if not FOLLOWUP_SQLITE or not hasattr(handler, "server"):
        return False
    if handler.server.server_address[0] != "127.0.0.1":
        return False
    if E2E_ENABLED:
        return True
    from followup_identity import gateway_configuration, gateway_mode
    return gateway_mode() and gateway_configuration() is not None


def _json(handler, data, code=200, *, cookie=None):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    if handler.path.startswith("/api/followup/") and not _protected_runtime():
        handler.send_header("Cache-Control", "no-store")
    if cookie:
        handler.send_header("Set-Cookie", cookie)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
    # WSGI 适配层（见文件末尾 _WsgiHandler）靠这两个属性取回响应；
    # 独立的 ThreadingHTTPServer 模式不受影响。
    handler._status = code
    handler._headers = [("Content-Type", "application/json; charset=utf-8")]
    handler._body = body


def _internal_error(handler, exc):
    """
    统一兜底：把未捕获异常变成 500 JSON，而不是让连接直接断开。
    前端据此能明确告诉用户「这次没成功」，而不是把它当成一次成功的空结果。
    后续服务仅记录异常类型。其他接口的诊断详情只写到 stderr。
    """
    if _protected_runtime() or getattr(handler, "path", "").startswith(("/api/followup/", "/api/ai/", "/api/action-plan/")):
        sys.stderr.write("[政策找人] followup request failed: %s\n" % type(exc).__name__)
    else:
        import traceback
        sys.stderr.write("[政策找人] 请求处理异常：%r\n" % (exc,))
        traceback.print_exc()
    try:
        _json(handler, {"error": "internal_error", "detail": "服务处理这条请求时出错，请稍后重试"}, 500)
    except Exception:
        # 连兜底都失败了（比如连接已经断了），不再抛第二次
        pass


def _brief(policy):
    return {
        "policy_id": policy["policy_id"],
        "policy_name": policy["policy_name"],
        "category": policy["category"],
        "service_type": policy.get("service_type", ""),
        "region": (policy.get("region", {}) or {}).get("scope", ""),
        "life_scenes": policy.get("life_scenes", []),
        "verification_status": (policy.get("verification", {}) or {}).get("status"),
        "description": policy.get("description", ""),
        "source_department": (policy.get("source") or {}).get("department", ""),
    }


def _tier_summary(results):
    """按分层统计条数，供前端展示分组标题。顺序即展示顺序。"""
    order = ["强相关", "可能相关", "待确认"]
    counts = {k: 0 for k in order}
    for r in results:
        t = r.get("tier")
        if t in counts:
            counts[t] += 1
    return [{"tier": k, "count": counts[k]} for k in order if counts[k]]


# ---------------------------------------------------------------- 端到端自测日志接收
# 仅供 .tools/e2e.py 使用：把浏览器里跑出来的断言结果收进内存，供脚本读取。
# 不参与任何业务逻辑，收到 /api/health 的 reset 时清空。
E2E_LOG = {"lines": [], "mode": None, "done": False}


def _e2e_record(payload):
    mode = payload.get("mode") or "unknown"
    if E2E_LOG["mode"] not in (None, mode):
        E2E_LOG["lines"] = []
        E2E_LOG["done"] = False
    E2E_LOG["mode"] = mode
    E2E_LOG["lines"].append({
        "line": payload.get("line", ""),
        "cls": payload.get("cls", ""),
    })
    if "通过" in str(payload.get("line", "")) or payload.get("done"):
        E2E_LOG["done"] = True


def _detail(policy, profile=None):
    data = dict(policy)
    data["rag_text"] = engine.build_rag_text(policy)
    if profile:
        data["ai_reason_rendered"] = engine.render_reason(policy.get("ai_reason", []), profile)
    # v0.9：详情页不再依赖「重跑一次匹配」才能拿到时效与阈值。
    # validity 是纯派生（不新增数据字段，调用引擎既有派生函数）；
    # threshold_signal 需要用户画像才能与个人负担金额比较，没有画像时返回 None，
    # 不伪造结论。两个键都是新增，既有字段原样保留。
    data["validity"] = engine.derive_validity(policy)
    data["threshold_signal"] = engine.threshold_signal(policy, profile) if profile else None
    return data


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def log_request(self, code="-", size="-"):
        if _protected_runtime() or getattr(self, "path", "").startswith(("/api/followup/", "/api/ai/", "/api/action-plan/")):
            self.log_message("followup request status %s", code)
            return
        super().log_request(code, size)

    def end_headers(self):
        if _protected_runtime():
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        if _protected_runtime():
            frontend = Path(FRONTEND_DIR).resolve()
            target = Path(self.translate_path(self.path)).resolve()
            if not target.is_relative_to(frontend):
                self.send_error(404)
                return None
        return super().send_head()

    def list_directory(self, path):
        if _protected_runtime():
            self.send_error(404)
            return None
        return super().list_directory(path)

    # ---------------------------------------------------------------- GET
    def do_GET(self):
        # 任何未捕获异常都会让连接直接断开，浏览器只看到「网络错误」，
        # 分不清是服务没起还是这个请求本身有问题。统一兜成 500 JSON。
        try:
            return self._do_get()
        except Exception as exc:      # noqa: BLE001 —— 兜底，不吞掉细节
            _internal_error(self, exc)

    def _do_get(self):
        path = urlparse(self.path).path
        if path.startswith("/api/followup/"):
            return _run_followup(self, "GET", path)
        if _followup_available(self):
            from followup_identity import gateway_mode
            static_path = os.path.relpath(os.path.realpath(self.translate_path(path)),
                                          os.path.realpath(FRONTEND_DIR)).replace(os.sep, "/").lower()
            if static_path == "assets/pf-service-v3-activation.js" and gateway_mode():
                script = (
                    b"Object.defineProperties(window,{PF_V3_MODE:{value:'v1'},"
                    b"PF_V3_BLOCK_LEGACY_WRITES:{value:false},PF_V3_GATE_ERROR:{value:''}});"
                )
                self.send_response(200)
                self.send_header("Content-Type", "application/javascript")
                if not _protected_runtime():
                    self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(script)))
                self.end_headers()
                self.wfile.write(script)
                return
            legacy = {"verify-list.html": "list", "records.html": "logs", "plan.html": "plans"}
            if static_path in legacy or (_protected_runtime() and static_path == "mine.html"):
                params = parse_qs(urlparse(self.path).query, keep_blank_values=True)
                redirect = {"view": legacy.get(static_path)}
                if static_path == "plan.html" and params.get("plan_id"):
                    redirect.update(view="plan", plan=params["plan_id"][0])
                elif static_path == "plan.html" and (params.get("query") or params.get("batchReceipt")):
                    redirect["view"] = "list"
                for key in ("from", "member", "query", "batchReceipt"):
                    if params.get(key):
                        redirect[key] = params[key][0]
                if static_path == "mine.html":
                    target = "/services.html" + ("?" + urlencode({"member": redirect["member"]}) if "member" in redirect else "")
                else:
                    target = "/follow-up.html?" + urlencode(redirect)
                self.send_response(302)
                self.send_header("Location", target)
                if not _protected_runtime():
                    self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

        if path == "/api/health":
            return _json(self, {
                "ok": True,
                "database": DB.get("database_name"),
                "version": DB.get("version"),
                "policy_count": len(DB.get("policies", [])),
                "disclaimer": DISCLAIMER,
            })

        if path == "/__e2e_log":
            if not E2E_ENABLED:
                return _json(self, {"error": "not found"}, 404)
            # GET：?peek=1 只读取不重置，供测试脚本轮询；否则重置
            if "peek" not in (urlparse(self.path).query or ""):
                E2E_LOG["lines"] = []
                E2E_LOG["done"] = False
                E2E_LOG["mode"] = None
                return _json(self, {"ok": True, "reset": True})
            return _json(self, {
                "mode": E2E_LOG["mode"],
                "done": E2E_LOG["done"],
                "lines": E2E_LOG["lines"],
            })

        if path == "/api/policies":
            return _json(self, {
                "total": len(DB.get("policies", [])),
                "policies": [_brief(p) for p in DB.get("policies", [])],
            })

        if path == "/api/scenes":
            # 生活事件库：前端「情况确认台」的数据源。
            # 可选传入 profile（URL 编码的 JSON），用于标注哪些事件已被 AI 识别。
            profile = None
            qs = urlparse(self.path).query
            if qs:
                raw = (parse_qs(qs).get("profile") or [None])[0]
                if raw:
                    try:
                        profile = json.loads(raw)
                    except Exception:
                        profile = None
            return _json(self, {
                "scenes": engine.build_scene_library(DB, profile),
                "disclaimer": DISCLAIMER,
            })

        if path == "/api/tiers":
            # 分层口径说明：让前端不必硬编码解释文案
            return _json(self, {
                "tiers": [
                    {"key": "强相关", "desc": "AI 从您的描述中识别到了对应的生活事件，且没有关键条件缺口"},
                    {"key": "可能相关", "desc": "识别到了对应生活事件，但仍有户籍、医保、失能等待确认的条件"},
                    {"key": "待确认", "desc": "目前仅依据年龄等基础信息提示，是否有对应需求还需要您确认"},
                ],
            })

        if path.startswith("/api/policy/"):
            policy_id = path[len("/api/policy/"):]
            policy = engine.find_policy(DB, policy_id)
            if not policy and FOLLOWUP_SQLITE:
                try:
                    for region in semantic_discovery.REGIONS:
                        policy = next((row for row in semantic_discovery._catalog(region)
                                       if row["policy_id"] == policy_id), None)
                        if policy:
                            break
                except (OSError, ValueError, KeyError, TypeError):
                    return _json(self, {"error": "catalogue unavailable"}, 503)
            if not policy:
                return _json(self, {"error": "policy not found"}, 404)
            return _json(self, _detail(policy))

        if path.startswith("/api/"):
            return _json(self, {"error": "unknown api"}, 404)

        return super().do_GET()

    # ---------------------------------------------------------------- POST
    def do_POST(self):
        try:
            return self._do_post()
        except Exception as exc:      # noqa: BLE001
            _internal_error(self, exc)

    def _do_post(self):
        path = urlparse(self.path).path
        if path == "/api/search/web":
            return self._web_search()
        if path.startswith("/api/followup/"):
            return _run_followup(self, "POST", path)
        if path == "/api/ai/analyze":
            return _run_local_ai(self, lambda payload: life_analysis.analyze(payload, DB))
        if path == "/api/ai/discover":
            return _run_local_ai(self, semantic_discovery.discover)
        if path == "/api/ai/assess":
            return _run_local_ai(self, _assess)
        if path == "/api/ai/action-plan":
            return _run_local_ai(self, _action_plan)
        if path == "/api/action-plan/evidence":
            return _run_local_ai(self, lambda payload: action_plan.generate(payload, analyze=False))
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            payload = {}

        if path == "/api/profile":
            profile = engine.build_profile(
                text=payload.get("text", ""),
                relation=payload.get("relation"),
                operator=payload.get("operator"),
                age=payload.get("age"),
                region=payload.get("region"),
                mode=payload.get("mode"),
                age_description=engine.beneficiary_description(payload.get("life_description"), payload.get("relation")),
            )
            profile["missing_fields"] = engine.profile_missing_fields(profile)
            if isinstance(payload.get("life_description"), str):
                profile["life_description"] = payload["life_description"]
            return _json(self, {"profile": profile, "disclaimer": DISCLAIMER})

        if path == "/api/match":
            return _json(self, _match_payload(payload))

        if path == "/api/explain":
            policy = engine.find_policy(DB, payload.get("policy_id", ""))
            if not policy:
                return _json(self, {"error": "policy not found"}, 404)
            saved = payload.get("profile") or {}
            profile = engine.build_profile(
                text=saved.get("raw_text", ""),
                relation=saved.get("relation"),
                operator=saved.get("operator"),
                age=saved.get("age"),
                region=saved.get("region"),
                mode=saved.get("mode"),
            )
            return _json(self, {
                "policy": _detail(policy, profile),
                "disclaimer": DISCLAIMER,
            })

        if path == "/__e2e_log":
            if not E2E_ENABLED:
                return _json(self, {"error": "not found"}, 404)
            _e2e_record(payload)
            return _json(self, {"ok": True})

        return _json(self, {"error": "unknown api"}, 404)

    def _web_search(self):
        try:
            if not _protected_runtime() or not _followup_available(self):
                raise cleversee.SearchError("forbidden")
            host, port = self.server.server_address
            origin = f"http://{host}:{port}"
            if (self.headers.get("Host") != f"{host}:{port}"
                    or self.headers.get("Origin") != origin
                    or self.headers.get("Sec-Fetch-Site") == "cross-site"):
                raise cleversee.SearchError("forbidden")
            if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
                raise cleversee.SearchError("invalid_query")
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2048:
                    raise ValueError
                self.connection.settimeout(5)
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, OSError):
                raise cleversee.SearchError("invalid_query") from None
            return _json(self, WEB_SEARCH.search(payload))
        except cleversee.SearchError as exc:
            return _json(self, {"error": {"code": exc.code, "message": str(exc)}}, exc.status)

    def do_OPTIONS(self):
        if _protected_runtime():
            return _json(self, {"error": "not found"}, 404)
        # 仅供本机端到端自测页面回传断言结果，不涉及任何业务数据
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()
        self._status = 204
        self._headers = [
            ("Access-Control-Allow-Origin", "*"),
            ("Access-Control-Allow-Headers", "Content-Type"),
            ("Access-Control-Allow-Methods", "POST, OPTIONS"),
        ]
        self._body = b""

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def _match_payload(payload, *, discovery_scenes=()):
    # 入参分两类，来源不同、处理方式必须不同：
    #   1) 由本次文本解析出来的（年龄 / 地区 / 生活场景 / 自述自付金额）
    #      —— 一律以本次 text 为准，绝不沿用上一轮画像。
    #   2) 由用户明确作答得来的（户籍 / 医保 / 失能 / 家庭经济认定）
    #      —— 文本里推不出来，必须沿用，否则用户答过的问题会被反复问。
    # 曾经把 1) 也从上一轮画像里沿用（age / region / scenes 并集），
    # 导致用户改完描述再匹配时旧画像残留：AI 分析依据会显示上一次的
    # 年龄与地区，结果条数也虚高。这是对「可核对」这一核心承诺的直接破坏。
    text = payload.get("text", "")
    base = payload.get("profile") or {}
    mode = payload.get("mode") or base.get("mode")
    profile = engine.build_profile(
        text=text,
        relation=base.get("relation") or payload.get("relation"),
        operator=base.get("operator") or payload.get("operator"),
        age=payload.get("age"),
        region=payload.get("region"),
        mode=mode,
        age_description=engine.beneficiary_description(payload.get("life_description"), base.get("relation") or payload.get("relation")),
    )
    # 只沿用用户明确作答过的事实
    for key in ("hukou", "insurance", "disability", "family_economic"):
        if key in base and base[key] is not None:
            profile[key] = base[key]
    # 用户在「情况确认台」手动增删生活事件后，其清单作为最终结果
    # （replace 语义），用于人机协同纠正 AI 的识别。
    # 注意：这里只在用户确实编辑过时才覆盖，不做「与旧场景取并集」，
    # 否则改了描述旧场景也清不掉。
    if isinstance(base.get("confirmed_scenes"), list):
        profile["scenes"] = sorted(set(base["confirmed_scenes"]))
        # 回传用户已确认的事件清单：前端每次匹配后都会用返回的 profile
        # 覆盖本地存储，若不回传就会丢掉用户的纠正结果。
        profile["confirmed_scenes"] = list(profile["scenes"])
        profile["scenes_edited"] = True
    elif base.get("scenes_edited"):
        # 用户此前纠正过事件，但这次没再传 confirmed_scenes：
        # 沿用上次已确认的结果，不退回 AI 的初始识别。
        prev = base.get("confirmed_scenes")
        if isinstance(prev, list):
            profile["scenes"] = sorted(set(prev))
        profile["confirmed_scenes"] = list(profile["scenes"])
        profile["scenes_edited"] = True

    if discovery_scenes:
        profile["scenes"] = sorted(set(profile["scenes"]).union(discovery_scenes))
    if any(conflict["kind"] == "年龄" for conflict in profile["conflicts"]):
        profile["scenes"] = [scene for scene in profile["scenes"] if scene != "年龄增长"]
    if isinstance(payload.get("life_description"), str):
        profile["life_description"] = payload["life_description"]
    profile["missing_fields"] = engine.profile_missing_fields(profile)
    results = engine.match_policies(DB, profile)
    return {
        "profile": profile,
        "results": results,
        "total": len(results),
        "tier_summary": _tier_summary(results),
        "scene_library": engine.build_scene_library(DB, profile),
        "disclaimer": DISCLAIMER,
        "notice": "以下为初步匹配结果，均需进一步确认，不作为资格认定。",
    }


def _run_local_ai(handler, operation):
    # Paid endpoints require explicit opt-in on the loopback service.
    if (os.environ.get("AI_ANALYSIS_ENABLED") != "1" or not (E2E_ENABLED or _followup_available(handler))
            or not hasattr(handler, "server") or handler.server.server_address[0] != "127.0.0.1"):
        return _json(handler, {"error": "AI_UNAVAILABLE", "detail": "当前预览未启用 AI 分析。"}, 503)
    host = "127.0.0.1:%s" % handler.server.server_port
    if (handler.headers.get("Host") != host
            or handler.headers.get("Origin", "http://" + host) != "http://" + host
            or handler.headers.get("Sec-Fetch-Site") == "cross-site"):
        return _json(handler, {"error": "INVALID_ORIGIN", "detail": "请从本地预览页面发起分析。"}, 403)
    from followup_identity import LOCAL, resolve, scope
    identity = LOCAL
    if FOLLOWUP_SQLITE:
        identity = resolve(handler)
        if not identity:
            return _followup_unauthorized(handler)
    try:
        size = int(handler.headers.get("Content-Length", "0"))
        if not 0 < size <= 8192 or handler.headers.get_content_type() != "application/json":
            raise ValueError()
        payload = json.loads(handler.rfile.read(size).decode("utf-8"))
    except (ValueError, UnicodeError):
        return _json(handler, {"error": "INVALID_INPUT", "detail": "分析请求的 JSON 格式或大小不正确。"}, 400)
    try:
        with scope(identity):
            return _json(handler, operation(payload))
    except DeepSeekError as exc:
        status = 400 if exc.code == "INVALID_INPUT" else 504 if exc.code == "TIMEOUT" else 502
        return _json(handler, {"error": exc.code, "detail": str(exc), "upstream_status": exc.status}, status)
    except Exception as exc:
        from followup_api import FollowupError
        if isinstance(exc, FollowupError):
            return _json(handler, {"error": exc.code, "detail": str(exc)}, exc.status)
        raise


def _assess(payload):
    if FOLLOWUP_SQLITE and isinstance(payload, dict) and payload.get("queryId"):
        from followup_api import assess_history
        return assess_history(payload["queryId"], lambda saved, rule: policy_assessment.assess(saved, lambda _: rule, DB))
    return policy_assessment.assess(payload, _match_payload, DB)


def _action_plan(payload):
    if FOLLOWUP_SQLITE and isinstance(payload, dict) and "planId" in payload:
        from followup_api import generate_plan_advice
        return generate_plan_advice(payload)
    return action_plan.generate(payload)


def _followup_unauthorized(handler):
    from followup_identity import gateway_mode
    if gateway_mode():
        return _json(handler, {"error": "LOGIN_REQUIRED", "detail": "会话已失效，请通过认证入口重新登录。"}, 401)
    return _json(handler, {"error": "PREVIEW_UNAUTHORIZED", "detail": "请先解锁本机预览。"}, 401)


def _query_match(payload):
    description = engine.beneficiary_description(payload.get("life_description"), payload.get("profile", {}).get("relation"))
    clues = set(engine.detect_scenes(description)) | set(engine.detect_scenes(payload.get("text", "")))
    answers = payload.get("answers", {})
    for field, value, scene in (
        ("mobility", "no", "行动不便"), ("living", "family", "独居"),
        ("help", "no", "需要照护"), ("help", "no", "需要长期照护"),
        ("meal", "no", "吃饭困难"),
    ):
        if answers.get(field) == value:
            clues.discard(scene)
    # 场景用于相关性，描述中的年龄仅用于冲突核对。原始表单仍按原样保存。
    data = _match_payload(payload, discovery_scenes=clues)
    ids = {row["policy_id"] for row in data["results"]}
    fields = ("policy_id", "description", "source", "verification", "validity")
    data["policyDetails"] = {}
    for policy in DB.get("policies", []):
        if policy["policy_id"] in ids:
            detail = _detail(policy)
            data["policyDetails"][policy["policy_id"]] = {key: detail[key] for key in fields if key in detail}
    return data


def _run_followup(handler, method, path):
    from followup_auth import issue
    from followup_identity import gateway_mode, resolve, scope
    if not _followup_available(handler):
        if method == "GET" and path == "/api/followup/capabilities":
            return _json(handler, {"enabled": False})
        return _json(handler, {"error": "FOLLOWUP_DISABLED", "detail": "当前预览未启用 SQLite 后续服务。"}, 503)
    host = "127.0.0.1:%s" % handler.server.server_port
    origin = "http://" + host
    if (handler.headers.get("Host") != host
            or handler.headers.get("Origin", origin) != origin
            or handler.headers.get("Sec-Fetch-Site") == "cross-site"
            or (method == "POST" and (handler.headers.get("Origin") != origin
                                    or handler.headers.get("X-PF-Local") != "1"))):
        return _json(handler, {"error": "INVALID_ORIGIN", "detail": "请从当前本机预览页面发起操作。"}, 403)
    if method == "GET" and path == "/api/followup/capabilities":
        return _json(handler, {"enabled": True})
    session = method == "POST" and path == "/api/followup/session"
    if session:
        if gateway_mode():
            return _followup_unauthorized(handler)
    else:
        identity = resolve(handler)
        if not identity:
            return _followup_unauthorized(handler)
    if method == "POST":
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536 or handler.headers.get_content_type() != "application/json":
                raise ValueError()
            def reject_constant(value):
                raise ValueError("Invalid JSON constant")

            payload = json.loads(handler.rfile.read(length).decode("utf-8"), parse_constant=reject_constant)
            if not isinstance(payload, dict):
                raise ValueError()
        except (ValueError, UnicodeError):
            return _json(handler, {"error": "INVALID_INPUT", "detail": "请求格式或大小不正确。"}, 400)
    else:
        payload = {key: values[0] for key, values in parse_qs(urlparse(handler.path).query, keep_blank_values=True).items()}
    if session:
        cookie = issue(payload.get("accessToken"), handler.server.server_port)
        return _json(handler, {"ok": True}, cookie=cookie) if cookie else _followup_unauthorized(handler)
    from followup_api import FollowupError, dispatch
    try:
        with scope(identity):
            if path.startswith("/api/followup/v32/"):
                import household_analysis
                return _json(handler, household_analysis.dispatch(method, path, payload))
            return _json(handler, dispatch(method, path, payload, match=_query_match))
    except FollowupError as exc:
        return _json(handler, {"error": exc.code, "detail": str(exc)}, exc.status)


def main():
    # HOST 默认 0.0.0.0，便于局域网设备（手机）与云端部署访问；本地仍可用 127.0.0.1
    host = os.environ.get("HOST", "0.0.0.0")
    if FOLLOWUP_SQLITE:
        _prepare_followup_runtime(host)
    addr = (host, PORT)
    httpd = ThreadingHTTPServer(addr, Handler)
    print("政策找人 原型服务已启动: http://%s:%d" % (host, PORT))
    print("数据库: %s %s（%d 条政策）" % (
        DB.get("database_name"), DB.get("version"), len(DB.get("policies", []))))
    print("按 Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        httpd.server_close()


def _prepare_followup_runtime(host):
    from followup_auth import configured
    from followup_identity import gateway_configuration, gateway_mode
    from followup_db import SCHEMA_VERSION, check_integrity, db_path, initialize_preview
    from sqlite3 import Error

    if host != "127.0.0.1":
        raise SystemExit("SQLite 后续服务只允许在本机回环地址监听。")
    protected = _protected_runtime()
    if protected and not gateway_mode():
        raise SystemExit("Production follow-up requires gateway identity.")
    if gateway_mode() and not gateway_configuration():
        raise SystemExit("Missing identity gateway issuer, audience or signing key.")
    if not gateway_mode() and not configured():
        raise SystemExit("Set a private PF_FOLLOWUP_ACCESS_TOKEN of at least 32 characters for the local preview.")
    if protected and not os.environ.get("PF_FOLLOWUP_DB", "").strip():
        raise SystemExit("Production follow-up requires an explicit PF_FOLLOWUP_DB.")
    try:
        if protected:
            # Service startup may validate an existing database, but never initialize or upgrade it.
            path = db_path()
            with path.open("rb") as source:
                header = source.read(20)
            if not header.startswith(b"SQLite format 3\x00") or header[18:20] != b"\x01\x01":
                raise ValueError("Expected a SQLite database in rollback journal mode.")
        else:
            initialize_preview()
        state = check_integrity()
        if not state["ok"] or (protected and state["version"] != SCHEMA_VERSION):
            raise ValueError("Database integrity or schema validation failed.")
    except (OSError, ValueError, Error) as exc:
        raise SystemExit("Follow-up database preflight failed. Check the configured private database and schema.") from exc



# ------------------------------------------------------------------ WSGI 适配
# PythonAnywhere 之类的平台只能跑 WSGI 应用，不能起自己的服务器。
# 这里给上面的 Handler 套一层薄壳：把 WSGI 的请求塞进它认得的形状（headers /
# rfile / wfile），再把 _json() 记录的响应取出来。业务逻辑一行没改。


class _FakeSocket(object):
    """让 Handler 以为自己在写 http.server 的 wfile。"""

    def __init__(self):
        self._chunks = []

    def write(self, data):
        self._chunks.append(data)

    def flush(self):
        pass

    def value(self):
        return b"".join(self._chunks)


class _WsgiHandler(Handler):
    """只借用 Handler 的路由逻辑，不走 BaseHTTPRequestHandler 的套接字那套。"""

    def __init__(self, environ):
        self.path = environ.get("PATH_INFO", "/")
        qs = environ.get("QUERY_STRING", "")
        if qs:
            self.path += "?" + qs
        self.headers = email.message.Message()
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                self.headers[key[5:].replace("_", "-").title()] = value
        if environ.get("CONTENT_TYPE"):
            self.headers["Content-Type"] = environ["CONTENT_TYPE"]
        if environ.get("CONTENT_LENGTH"):
            self.headers["Content-Length"] = environ["CONTENT_LENGTH"]

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            length = 0
        raw = environ["wsgi.input"].read(length) if length else b""
        self.rfile = io.BytesIO(raw)
        self.wfile = _FakeSocket()

        self._status = 500
        self._headers = [("Content-Type", "text/plain; charset=utf-8")]
        self._body = b"internal error"

    # 被拦下来的父类方法：WSGI 下没有真实连接，这些调用只是记账。
    def send_response(self, code, message=None):
        self._status = code

    def send_header(self, key, value):
        self._headers.append((key, value))

    def end_headers(self):
        pass


def _serve_static(path_info):
    """把 frontend/ 下的文件按 WSGI 返回。路径穿越在归一化后被挡掉。"""
    rel = path_info.lstrip("/") or "index.html"
    target = os.path.normpath(os.path.join(FRONTEND_DIR, rel))
    if not os.path.abspath(target).startswith(os.path.abspath(FRONTEND_DIR)):
        return 404, [("Content-Type", "text/plain; charset=utf-8")], b"forbidden"
    if os.path.isdir(target):
        target = os.path.join(target, "index.html")
    if not os.path.isfile(target):
        return 404, [("Content-Type", "text/plain; charset=utf-8")], b"not found"
    with open(target, "rb") as fh:
        body = fh.read()
    ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
        ctype += "; charset=utf-8"
    return 200, [("Content-Type", ctype), ("Content-Length", str(len(body)))], body


_STATUS_TEXT = {
    200: "OK",
    204: "No Content",
    400: "Bad Request",
    404: "Not Found",
    405: "Method Not Allowed",
    500: "Internal Server Error",
}

def application(environ, start_response):
    """WSGI 入口。PythonAnywhere 的 WSGI 配置文件里 import 这个模块即可。"""
    if _protected_runtime():
        # Do not silently fall back to old static/legacy paths when this runtime is misconfigured.
        start_response("503 Service Unavailable", [("Content-Type", "text/plain; charset=utf-8"),
                                                    ("Cache-Control", "no-store")])
        return [b"Protected follow-up requires the standalone loopback service."]
    handler = _WsgiHandler(environ)
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = urlparse(handler.path).path

    if method == "POST":
        handler.do_POST()
    elif method == "OPTIONS":
        handler.do_OPTIONS()
    elif method == "HEAD":
        handler.do_GET()
        handler._body = b""
    elif method == "GET" and path.startswith("/api/") or method == "GET" and path == "/__e2e_log":
        handler.do_GET()
    elif method == "GET":
        status, headers, body = _serve_static(path)
        handler._status, handler._headers, handler._body = status, headers, body
    else:
        handler._status = 405
        handler._headers = [("Content-Type", "text/plain; charset=utf-8")]
        handler._body = b"method not allowed"

    status_line = "%d %s" % (handler._status, _STATUS_TEXT.get(handler._status, "OK"))
    headers = [(k, v) for k, v in handler._headers if k.lower() != "content-length"]
    headers.append(("Content-Length", str(len(handler._body))))
    start_response(status_line, headers)
    return [handler._body]




if __name__ == "__main__":
    main()
