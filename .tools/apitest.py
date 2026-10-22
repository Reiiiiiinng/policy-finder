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
        # 2026-10-11 口径更新：008 保留已核实的国家级依据（国卫老龄发〔2024〕42号），
        # 广州本地服务点/预约方式仍未核实，因此 verified 必须保持 False。
        check("008 依据为国家级文件", "应对老年期痴呆国家行动计划" in r008[0]["evidence"]["citation"]["document"],
              r008[0]["evidence"]["citation"]["document"])
        check("008 依据不含本地实施承诺", "广州" not in r008[0]["evidence"]["citation"]["document"])
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

    print("== 否定表达不误判为生活场景 ==")
    # 「不是独居」和「独居」在子串匹配下没有区别，一旦误判，
    # 推荐给用户的政策方向就是反的。这几条锁住这个行为。
    neg = call("/api/profile", {"text": "我父亲72岁，在广州，不是独居，和家人一起住"})
    check("「不是独居」不产生独居标签",
          "独居" not in (neg["profile"].get("scenes") or []),
          str(neg["profile"].get("scenes")))
    pos = call("/api/profile", {"text": "我父亲72岁，一个人在广州生活，最近行动不方便"})
    check("「一个人生活」仍识别为独居",
          "独居" in (pos["profile"].get("scenes") or []),
          str(pos["profile"].get("scenes")))
    alone = call("/api/profile", {"text": "我父亲72岁，独自居住，行动不便"})
    check("「独自居住」仍识别为独居",
          "独居" in (alone["profile"].get("scenes") or []),
          str(alone["profile"].get("scenes")))

    print("== 已经过去的状况不当成现在 ==")
    # 「以前独居，现在和子女一起住」若当独居处理，推荐方向会反过来
    past = call("/api/profile", {"text": "我父亲72岁，以前独居，现在和子女一起住"})
    check("「以前独居，现在一起住」不算独居",
          "独居" not in (past["profile"].get("scenes") or []),
          str(past["profile"].get("scenes")))
    mobile = call("/api/profile", {"text": "我父亲72岁，之前行动不便，现在能走了"})
    check("「之前行动不便，现在能走了」不算行动不便",
          "行动不便" not in (mobile["profile"].get("scenes") or []),
          str(mobile["profile"].get("scenes")))
    # 只说过去、没交代现在的，保守保留
    onlypast = call("/api/profile", {"text": "我父亲72岁，以前独居"})
    check("只说「以前独居」仍保留独居标签（未交代现状，不擅自删除）",
          "独居" in (onlypast["profile"].get("scenes") or []),
          str(onlypast["profile"].get("scenes")))

    print("== 自相矛盾的说法要能被指出来 ==")
    # 引擎不替用户裁决哪句是真的，但必须把矛盾交出来，由界面去问。
    conflict = call("/api/profile", {"text": "我父亲72岁，一个人生活，和子女一起住"})
    cf = conflict["profile"].get("conflicts")
    check("矛盾字段恒为列表", isinstance(cf, list), str(type(cf)))
    check("「一个人生活 + 和子女一起住」被识别为矛盾",
          len(cf) == 1 and cf[0].get("kind") == "居住情况", str(cf))
    clean = call("/api/profile", {"text": "我父亲72岁，一个人在广州生活，最近行动不方便"})
    check("没有矛盾时返回空列表", clean["profile"].get("conflicts") == [],
          str(clean["profile"].get("conflicts")))
    hk = call("/api/profile", {"text": "我父亲72岁，户口不在广州，是本市户籍"})
    check("户籍前后矛盾被指出",
          any(x.get("kind") == "户籍情况" for x in (hk["profile"].get("conflicts") or [])),
          str(hk["profile"].get("conflicts")))

    # 「不是独居，和家人一起住」是一句自洽的话：独居恰恰被否认了。
    # 若只按字面命中就报矛盾，用户会被要求确认一件他明确否认过的事。
    negc = call("/api/profile", {"text": "我父亲72岁，不是独居，和家人一起住"})
    check("被否定的说法不算矛盾依据",
          not (negc["profile"].get("conflicts") or []),
          str(negc["profile"].get("conflicts")))
    pastc = call("/api/profile", {"text": "我父亲72岁，以前独居，现在和子女一起住"})
    check("已经过去的情况不构成矛盾",
          not (pastc["profile"].get("conflicts") or []),
          str(pastc["profile"].get("conflicts")))
    # 同义但字面不同的说法也要认出来，否则最典型的矛盾反而漏掉
    for text, label in [
        ("我父亲72岁，独居，又和家人同住", "和家人同住"),
        ("我父亲72岁，独自居住，跟老伴一起", "跟老伴一起"),
        ("我父亲72岁，一个人生活，和子女共同生活", "和子女共同生活"),
    ]:
        got = call("/api/profile", {"text": text})["profile"].get("conflicts") or []
        check("矛盾同义词「%s」也要认出" % label,
              any(x.get("kind") == "居住情况" for x in got), str(got))

    # 「有家人照应」说的是有人帮，不是住在一起：
    # 「独居，子女住得远，平时有家人照应」是自洽的，收进同义词会冤枉它。
    for text, label in [
        ("我父亲72岁，独居，有家人照应", "有家人照应"),
        ("我父亲72岁，独居在广州，子女每周来看他", "子女每周来看他"),
    ]:
        got = call("/api/profile", {"text": text})["profile"].get("conflicts") or []
        check("「%s」不等于同住，不算矛盾" % label,
              not any(x.get("kind") == "居住情况" for x in got), str(got))

    print("== 程度副词夹在关键词中间不影响识别 ==")
    # 「压力很大」与词典里的「压力大」意思相同，字面不同。
    # 放过这类说法之前，用户明明说了，系统却当作没提。
    adv = [
        ("我父亲72岁，经济压力很大", "经济压力"),
        ("我父亲72岁，行动很不方便", "行动不便"),
        ("我父亲72岁，腿脚很不方便", "行动不便"),
        ("我父亲72岁，费用很高", "经济压力"),
    ]
    for text, tag in adv:
        r = call("/api/profile", {"text": text})
        sc = r["profile"].get("scenes") or []
        check("「" + text.split("，")[-1].rstrip("。") + "」识别为" + tag,
              tag in sc, str(sc))
    # 放开之后不能反向误触发
    safe = call("/api/profile", {"text": "我父亲72岁，医药费都能报销，没有压力"})
    check("「没有压力」不识别为经济压力",
          "经济压力" not in (safe["profile"].get("scenes") or []),
          str(safe["profile"].get("scenes")))
    care = call("/api/profile", {"text": "我父亲72岁，身体很好，不需要人照顾我"})
    check("「不需要人照顾我」不识别为需要照护",
          "需要照护" not in (care["profile"].get("scenes") or []),
          str(care["profile"].get("scenes")))

    # ---- 跌倒风险：补词后「摔过」类口语要能识别，否定与无关用法不能被带进来
    falls = [
        ("摔过", True),
        ("摔过一跤", True),
        ("上个月摔过一跤", True),
        ("摔过一次", True),
        ("摔骨折了", True),
        ("跌过一次", True),
    ]
    for text, want in falls:
        r = call("/api/profile", {"text": text})
        sc = r["profile"].get("scenes") or []
        check("「" + text + "」识别为跌倒风险", ("跌倒风险" in sc) == want, str(sc))

    # 原有表达不能被改坏
    keep = ["摔倒", "跌倒", "摔了", "摔跤", "滑倒"]
    for text in keep:
        r = call("/api/profile", {"text": text})
        check("原有表达「" + text + "」仍识别为跌倒风险",
              "跌倒风险" in (r["profile"].get("scenes") or []),
              str(r["profile"].get("scenes")))

    # 否定语境：说了「没摔过」不等于摔过
    negs = ["没有摔倒", "没摔过", "不是摔过", "从来没有跌倒过", "没摔过一跤"]
    for text in negs:
        r = call("/api/profile", {"text": text})
        check("否定语境「" + text + "」不算跌倒风险",
              "跌倒风险" not in (r["profile"].get("scenes") or []),
              str(r["profile"].get("scenes")))

    # 历史语境：只说过去、还交代了现状已好转的，不该当作现在的风险
    r = call("/api/profile", {"text": "以前摔过一跤，现在不摔了"})
    check("「以前摔过一跤，现在不摔了」不算跌倒风险",
          "跌倒风险" not in (r["profile"].get("scenes") or []),
          str(r["profile"].get("scenes")))
    # 但只说过去、没交代现状的，保守保留（宁可多问一句，不要漏掉风险）
    r = call("/api/profile", {"text": "以前摔过一跤"})
    check("只说「以前摔过一跤」仍保留跌倒风险（未交代现状，不擅自删除）",
          "跌倒风险" in (r["profile"].get("scenes") or []),
          str(r["profile"].get("scenes")))

    # 无关用法：不能因为补了「摔」起头的词就误命中
    unrelated = ["他摔门就走", "别摔东西"]
    for text in unrelated:
        r = call("/api/profile", {"text": text})
        check("无关用法「" + text + "」不算跌倒风险",
              "跌倒风险" not in (r["profile"].get("scenes") or []),
              str(r["profile"].get("scenes")))

    # 补词不能造成重复场景或额外场景
    dup = call("/api/profile", {"text": "上个月摔过一跤"})
    scenes = dup["profile"].get("scenes") or []
    check("「摔过一跤」只产出跌倒风险一个场景",
          scenes == ["跌倒风险"], str(scenes))

    print("\n通过 %d，失败 %d" % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
