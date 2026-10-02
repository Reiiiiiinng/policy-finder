"""
回归基线脚本：把关键接口的真实输出固化成可比对的快照。
用法：
    python .tools/baseline.py save     # 保存当前行为为基线
    python .tools/baseline.py check    # 与基线比对，输出差异

比对只针对「不应该被本轮改造改变的部分」：
  - 匹配结果条数、policy_id 顺序、status、score
  - 硬条件三值行为（户籍否 / 医保否 / 年龄不足 是否正确排除）
  - ai_reason 与 missing_information 文本
新增字段（evidence / priority_tier 等）不参与比对。
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import policy_engine as engine  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
SNAP = os.path.join(BASE, "baseline_snapshot.json")

DB = engine.load_database()

# 代表性用例：家庭模式 / 本人模式 / 边界与硬条件
CASES = [
    ("family-72-独居-行动不便", dict(text="我父亲72岁，一个人在广州生活，最近行动不方便。", relation="父亲", operator="女儿")),
    ("family-80-卧床-照护", dict(text="我母亲80岁，在广州，长期卧床需要人照顾，子女不在身边。", relation="母亲", operator="儿子")),
    ("family-75-记忆下降", dict(text="我奶奶75岁在广州，最近记忆下降容易忘事。", relation="奶奶", operator="女儿")),
    ("family-68-跌倒-经济", dict(text="我父亲68岁在广州，家里浴室摔倒了，经济压力大。", relation="父亲", operator="儿子")),
    ("self-72-独居", dict(text="我72岁，一个人在广州生活，最近行动不方便。", mode="self")),
    ("self-70-吃饭困难", dict(text="我70岁在广州，做饭困难，一个人住。", mode="self")),
    # 硬条件：户籍否 -> 长寿保健金（010）应被排除
    ("hard-户籍否", dict(text="我父亲72岁，一个人在广州生活，行动不方便。", relation="父亲",
                         profile=dict(hukou=False))),
    # 硬条件：医保否 + 失能 -> 长护险（009）应被排除
    ("hard-医保否", dict(text="我父亲72岁，在广州长期卧床需要照护。", relation="父亲",
                          profile=dict(insurance=False))),
    # 年龄不足 -> 65 岁门槛政策（007/008）应被排除
    ("hard-年龄不足", dict(text="我父亲55岁，在广州行动不便。", relation="父亲")),
    # 户籍是 -> 长寿保健金应回到可能相关
    ("hard-户籍是", dict(text="我父亲72岁，一个人在广州生活，行动不方便。", relation="父亲",
                          profile=dict(hukou=True))),
    # 外地 -> 全部排除
    ("外地-深圳", dict(text="我父亲72岁，在深圳生活，行动不方便。", relation="父亲")),
    # 无场景命中 -> 只保留年龄类
    ("无场景-仅年龄", dict(text="我父亲72岁，住在广州。", relation="父亲")),
]


def run_case(name, spec):
    text = spec.get("text", "")
    base = spec.get("profile") or {}
    mode = spec.get("mode")
    profile = engine.build_profile(
        text=text,
        relation=spec.get("relation"),
        operator=spec.get("operator"),
        mode=mode,
    )
    for key in ("hukou", "insurance", "disability"):
        if key in base and base[key] is not None:
            profile[key] = base[key]
    if base.get("scenes"):
        profile["scenes"] = sorted(set(profile["scenes"]) | set(base["scenes"]))
    results = engine.match_policies(DB, profile)
    return {
        "name": name,
        "profile": {k: profile.get(k) for k in
                    ("age", "region", "hukou", "insurance", "disability", "scenes", "who", "mode")},
        "results": [
            {
                "policy_id": r["policy_id"],
                "status": r["status"],
                "score": r["score"],
                "source_pending": r["source_pending"],
                "ai_reason": r["ai_reason"],
                "missing_information": r["missing_information"],
                "matched_scenes": r["matched_scenes"],
            }
            for r in results
        ],
    }


def build():
    return [run_case(n, s) for n, s in CASES]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    cur = build()

    if mode == "save":
        with open(SNAP, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=1)
        print("已保存基线：%s（%d 个用例）" % (SNAP, len(cur)))
        return

    if not os.path.exists(SNAP):
        print("尚无基线，请先运行 save")
        return

    with open(SNAP, "r", encoding="utf-8") as f:
        old = json.load(f)

    diffs = 0
    for o, c in zip(old, cur):
        if o != c:
            diffs += 1
            print("!! 用例变化: %s" % c["name"])
            for key in c:
                if o.get(key) != c.get(key):
                    print("   字段 %s:" % key)
                    print("     基线: %s" % json.dumps(o.get(key), ensure_ascii=False)[:400])
                    print("     当前: %s" % json.dumps(c.get(key), ensure_ascii=False)[:400])
    if diffs:
        print("\n共 %d 个用例发生变化——请确认是否为有意修改。" % diffs)
        sys.exit(1)
    print("回归通过：%d 个用例与基线完全一致。" % len(cur))


if __name__ == "__main__":
    main()