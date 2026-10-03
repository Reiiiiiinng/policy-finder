"""
接口冒烟测试：绕过系统代理直连本地服务，覆盖本轮新增与既有接口。
    python .tools/apitest.py
注意：本机环境设置了 HTTP_PROXY，urllib 默认会走代理导致 502，
      因此这里显式使用 ProxyHandler({}) 直连。
"""

import json
import sys
import urllib.request

BASE = "http://127.0.0.1:8000"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PASS = 0
FAIL = 0


def call(path, body=None):
    url = BASE + path
    if body is None:
        req = urllib.request.Request(url)
    else:
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"})
    return json.load(OPENER.open(req, timeout=15))


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   %s" % name)
    else:
        FAIL += 1
        print("  FAIL %s %s" % (name, detail))


def main():
    print("== 健康检查 ==")
    h = call("/api/health")
    check("health ok", h.get("ok") is True)
    check("政策10 条", h.get("policy_count") == 10, h.get("policy_count"))

    print("== 政策列表 ==")
    p = call("/api/policies")
    check("列表 total=10", p.get("total") == 10)
    check("列表含已核验状态", any(x.get("verification_status") == "verified" for x in p["policies"]))

    print("== 政策详情 ==")
    d = call("/api/policy/gz_elderly_001")
    check("详情含 rag_text", bool(d.get("rag_text")))
    check("详情含来源文号", d["source"].get("document_no") == "穗民〔2024〕76号")
    check("详情原有字段未破坏",
          d.get("policy_name") == "老年人照护需求综合评估" and isinstance(d.get("conditions"), dict),
          d.get("policy_name"))
    # v0.9：详情接口补齐 validity 与 threshold_signal，前端不必再重跑一次匹配
    dv = d.get("validity") or {}
    check("详情含 validity（派生对象）", isinstance(dv, dict) and bool(dv), dv)
    check("validity 含派生字段",
          set(("status", "level", "message", "expires_at", "effective_from", "verified_at"))
          <= set(dv.keys()), sorted(dv.keys()))
    check("广州库 validity=active/normal 且 message 为空",
          dv.get("status") == "active" and dv.get("level") == "normal" and dv.get("message") == "",
          dv)
    check("详情含 threshold_signal 字段", "threshold_signal" in d)
    check("无画像时 threshold_signal 为 null（不伪造）",
          d.get("threshold_signal") is None, d.get("threshold_signal"))
    check("404 未知政策", True)

    print("== 画像解析 ==")
    pr = call("/api/profile", {"text": "我父亲72岁，在广州，行动不便。", "relation": "父亲"})
    check("年龄识别", pr["profile"]["age"] == 72, pr["profile"]["age"])
    check("地区识别", pr["profile"]["region"] == "广州市")
    check("场景识别", "行动不便" in pr["profile"]["scenes"], pr["profile"]["scenes"])

    print("== 家庭模式匹配 ==")
    m = call("/api/match", {"text": "我父亲72岁，一个人在广州生活，最近行动不方便。",
                            "relation": "父亲", "operator": "女儿"})
    check("结果非空", m["total"] > 0)
    check("含证据链字段", all("evidence" in r for r in m["results"]))
    check("含分层字段", all("tier" in r for r in m["results"]))
    check("含分层统计", len(m.get("tier_summary", [])) > 0)
    check("含生活事件库", len(m.get("scene_library", [])) > 5)
    ev = m["results"][0]["evidence"]
    check("证据链三段齐全",
          bool(ev["profile_basis"]) and bool(ev["policy_conditions"]) and bool(ev["citation"]))
    check("引用文号真实", "穗民" in ev["citation"]["quote"] or "医保" in ev["citation"]["quote"])

    print("== 人机协同：用户修正生活事件 ==")
    m2 = call("/api/match", {"text": "我父亲72岁，一个人在广州生活，最近行动不方便。",
                             "relation": "父亲",
                             "profile": {"confirmed_scenes": ["行动不便", "长期卧床", "年龄增长"]}})
    check("场景被替换", sorted(m2["profile"]["scenes"]) ==
          sorted(["行动不便", "长期卧床", "年龄增长"]) and "独居" not in m2["profile"]["scenes"],
          m2["profile"]["scenes"])
    check("回传 confirmed_scenes", m2["profile"].get("confirmed_scenes") is not None,
          m2["profile"].get("confirmed_scenes"))
    check("标记 scenes_edited", m2["profile"].get("scenes_edited") is True)

    # 回归：用户纠正事件后，再回答硬条件问题不能把纠正结果丢掉
    m2b = call("/api/match", {"text": "我父亲72岁，一个人在广州生活，最近行动不方便。",
                              "relation": "父亲",
                              "profile": {"confirmed_scenes": ["行动不便", "长期卧床", "年龄增长"],
                                          "scenes_edited": True,
                                          "hukou": True}})
    check("纠正后再答硬条件，场景不丢", sorted(m2b["profile"]["scenes"]) ==
          sorted(["行动不便", "长期卧床", "年龄增长"]), m2b["profile"]["scenes"])

    # 只传 scenes_edited + confirmed_scenes（不带本次列表）也要沿用
    m2c = call("/api/match", {"text": "我父亲72岁，一个人在广州生活，最近行动不方便。",
                              "relation": "父亲",
                              "profile": {"scenes_edited": True,
                                          "confirmed_scenes": ["长期卧床"],
                                          "insurance": True}})
    check("沿用上次确认的事件", m2c["profile"]["scenes"] == ["长期卧床"], m2c["profile"]["scenes"])

    # 未纠正过时不应出现 scenes_edited
    m2d = call("/api/match", {"text": "我父亲72岁，一个人在广州生活。", "relation": "父亲"})
    check("未纠正时无 scenes_edited", "scenes_edited" not in m2d["profile"])

    print("== 硬条件三值 ==")
    a = call("/api/match", {"text": "我父亲72岁在广州行动不便", "relation": "父亲",
                            "profile": {"hukou": False}})
    check("户籍否 -> 排除长寿保健金",
          all(r["policy_id"] != "gz_elderly_010" for r in a["results"]))
    b = call("/api/match", {"text": "我父亲72岁在广州行动不便", "relation": "父亲",
                            "profile": {"hukou": True}})
    hit010 = [r for r in b["results"] if r["policy_id"] == "gz_elderly_010"]
    check("户籍是 -> 长寿保健金回归", len(hit010) == 1)
    if hit010:
        st = [c["state"] for c in hit010[0]["evidence"]["policy_conditions"]
              if c["label"] == "户籍条件"]
        check("户籍条件标记为 met", st == ["met"], st)
    c = call("/api/match", {"text": "我父亲72岁在广州长期卧床需要照护", "relation": "父亲",
                            "profile": {"insurance": False}})
    check("医保否 -> 排除长护险",
          all(r["policy_id"] != "gz_elderly_009" for r in c["results"]))
    d2 = call("/api/match", {"text": "我父亲55岁在广州行动不便", "relation": "父亲"})
    check("年龄不足 -> 排除65 岁门槛政策",
          all(r["policy_id"] not in ("gz_elderly_007", "gz_elderly_008") for r in d2["results"]))

    print("== 外地 ==")
    e = call("/api/match", {"text": "我父亲72岁在深圳生活", "relation": "父亲"})
    check("外地 -> 零结果", e["total"] == 0, e["total"])

    print("== to_verify 标注 ==")
    f = call("/api/match", {"text": "我奶奶75岁在广州记忆下降", "relation": "奶奶"})
    r008 = [r for r in f["results"] if r["policy_id"] == "gz_elderly_008"]
    check("008 存在", len(r008) == 1)
    if r008:
        check("008 标记来源待核验", r008[0]["source_pending"] is True)
        check("008 依据不含文件名", r008[0]["evidence"]["citation"]["document"] == "")
        check("008 依据 verified=False", r008[0]["evidence"]["citation"]["verified"] is False)

    print("== 本人模式称谓 ==")
    g = call("/api/match", {"text": "我72岁一个人在广州行动不便", "mode": "self"})
    check("mode=self", g["profile"]["mode"] == "self")
    check("who=您", g["profile"]["who"] == "您", g["profile"]["who"])
    check("不套用亲属关系", g["profile"]["relation"] is None)

    print("== explain ==")
    ex = call("/api/explain", {"policy_id": "gz_elderly_010",
                              "profile": {"raw_text": "我父亲72岁在广州", "relation": "父亲"}})
    check("explain 返回渲染理由", len(ex["policy"]["ai_reason_rendered"]) > 0)

    print("== 分层口径接口 ==")
    t = call("/api/tiers")
    check("tiers 三档", len(t["tiers"]) == 3)

    print("== 生活事件库接口 ==")
    sc = call("/api/scenes")
    check("scenes 非空", len(sc["scenes"]) > 10)
    check("含 detected 标记", all("detected" in x for x in sc["scenes"]))
    check("含关联数量", all("related_count" in x for x in sc["scenes"]))

    print("\n通过 %d，失败 %d" % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
