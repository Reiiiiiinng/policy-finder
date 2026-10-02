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

import json
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


def _detail(policy, profile=None):
    data = dict(policy)
    data["rag_text"] = engine.build_rag_text(policy)
    if profile:
        data["ai_reason_rendered"] = engine.render_reason(policy.get("ai_reason", []), profile)
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
            # 支持两种入参：直接给文本，或给已确认的画像（前端家庭协助页会补充字段）
            text = payload.get("text", "")
            base = payload.get("profile") or {}
            mode = payload.get("mode") or base.get("mode")
            profile = engine.build_profile(
                text=text,
                relation=base.get("relation") or payload.get("relation"),
                operator=base.get("operator") or payload.get("operator"),
                age=base.get("age"),
                region=base.get("region"),
                mode=mode,
            )
            for key in ("hukou", "insurance", "disability"):
                if key in base and base[key] is not None:
                    profile[key] = base[key]
            if base.get("scenes"):
                profile["scenes"] = sorted(set(profile["scenes"]) | set(base["scenes"]))
            # 用户在「情况确认台」手动增删生活事件后，重新解析的 scenes
            # 可以作为最终结果（replace 语义），用于人机协同纠正 AI 的识别。
            if isinstance(base.get("confirmed_scenes"), list):
                profile["scenes"] = sorted(set(base["confirmed_scenes"]))

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

        return _json(self, {"error": "unknown api"}, 404)

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


if __name__ == "__main__":
    main()
