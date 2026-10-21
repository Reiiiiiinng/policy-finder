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
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import policy_engine as engine  # noqa: E402

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
PORT = int(os.environ.get("PORT", "8000"))

# 端到端自测回传端点（/__e2e_log）只在本地开发与测试里需要。
# 部署到公网时用 POLICY_ENV=production 关掉，避免把调试通道暴露出去。
E2E_ENABLED = os.environ.get("POLICY_ENV", "dev").strip().lower() != "production"

DB = engine.load_database()

DISCLAIMER = (
    "本页面由AI根据您描述的生活情况进行初步匹配，"
    "仅用于提示可能相关的公共服务权益，不代表已符合政策资格。"
    "最终资格由主管部门核定。"
)


def _json(handler, data, code=200):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
    # WSGI 适配层（见文件末尾 _WsgiHandler）靠这两个属性取回响应；
    # 独立的 ThreadingHTTPServer 模式不受影响。
    handler._status = code
    handler._headers = [("Content-Type", "application/json; charset=utf-8")]
    handler._body = body


def _brief(policy):
    return {
        "policy_id": policy["policy_id"],
        "policy_name": policy["policy_name"],
        "category": policy["category"],
        "service_type": policy.get("service_type", ""),
        "region": (policy.get("region", {}) or {}).get("scope", ""),
        "life_scenes": policy.get("life_scenes", []),
        "verification_status": (policy.get("verification", {}) or {}).get("status"),
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

    # ---------------------------------------------------------------- GET
    def do_GET(self):
        path = urlparse(self.path).path

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
                from urllib.parse import parse_qs
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
            if not policy:
                return _json(self, {"error": "policy not found"}, 404)
            return _json(self, _detail(policy))

        if path.startswith("/api/"):
            return _json(self, {"error": "unknown api"}, 404)

        return super().do_GET()

    # ---------------------------------------------------------------- POST
    def do_POST(self):
        path = urlparse(self.path).path
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
            )
            profile["missing_fields"] = engine.profile_missing_fields(profile)
            return _json(self, {"profile": profile, "disclaimer": DISCLAIMER})

        if path == "/api/match":
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

            profile["missing_fields"] = engine.profile_missing_fields(profile)
            results = engine.match_policies(DB, profile)
            return _json(self, {
                "profile": profile,
                "results": results,
                "total": len(results),
                "tier_summary": _tier_summary(results),
                "scene_library": engine.build_scene_library(DB, profile),
                "disclaimer": DISCLAIMER,
                "notice": "以下为初步匹配结果，均需进一步确认，不作为资格认定。",
            })

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

    def do_OPTIONS(self):
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


def main():
    # HOST 默认 0.0.0.0，便于局域网设备（手机）与云端部署访问；本地仍可用 127.0.0.1
    host = os.environ.get("HOST", "0.0.0.0")
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
