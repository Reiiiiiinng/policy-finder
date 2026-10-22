"""
生成引擎移植的对照样本。

用 Python 版 policy_engine 跑一批输入，把结果存成 JSON；
再用 node 跑 build/engine.js 跑同样的输入，逐字段比对。
任何一处偏差都会让 .tools/baseline.py 的 12 条基线在浏览器里失效。
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import policy_engine as engine  # noqa: E402

DB = engine.load_database()

# 覆盖各种边界：中文数字、多岁、无年龄、单地区、无地区、本人模式、自付金额、确认项
CASES = [
    ("family-typical", {"text": "我父亲72岁，一个人在广州生活，最近行动不方便。"}),
    ("self-typical", {"text": "我72岁，一个人住在广州，行动不方便。", "mode": "self"}),
    ("cn-age", {"text": "我妈妈七十二岁，在广州，腿脚不好。"}),
    ("approx-age", {"text": "我奶奶七十多岁，独自住在广州，经常忘事。"}),
    ("no-age", {"text": "我奶奶在广州一个人住，记性不好。"}),
    ("no-region", {"text": "我父亲72岁，行动不方便。"}),
    ("foshan", {"text": "我父亲68岁在佛山，住院自付了3万元，大病。"}),
    ("shenzhen", {"text": "我父亲70岁在深圳，腿脚不方便。"}),
    ("selfpaid-wan", {"text": "我母亲75岁在佛山，住院后自己掏了5万，长期吃药。"}),
    ("memory-loss", {"text": "我外婆80岁广州，最近迷路，有点痴呆。"}),
    ("bedridden", {"text": "我爷爷78岁，长期卧床，需要在广州请人照护。"}),
    ("empty", {"text": ""}),
    ("only-model-words", {"text": "你好"}),
    ("hukou-confirmed-true", {"text": "我父亲72岁，一个人在广州生活，行动不方便。",
                              "profile": {"hukou": True}}),
    ("hukou-confirmed-false", {"text": "我父亲72岁，在广州生活，行动不方便。",
                               "profile": {"hukou": False}}),
    ("insurance-false", {"text": "我母亲75岁，在广州，需要照护。",
                         "profile": {"insurance": False}}),
    ("disability-true", {"text": "我父亲72岁，一个人在广州生活，行动不方便。",
                         "profile": {"disability": True}}),
    ("scenes-edited", {"text": "我父亲72岁，一个人在广州生活，最近行动不方便。",
                       "profile": {"confirmed_scenes": ["独居"], "scenes_edited": True}}),
    ("age-explicit", {"text": "我父亲，一个人在广州生活，行动不方便。", "age": 72}),
    ("region-explicit", {"text": "我父亲72岁，行动不方便。", "region": "广州市"}),
    ("operator", {"text": "我是他女儿，我父亲72岁在广州，行动不方便。"}),
    ("spouse", {"text": "我老伴76岁，在广州，记性不好。"}),
    ("pressure", {"text": "我父亲72岁广州，费用高，经济困难，需要照护。"}),
    ("fall-risk", {"text": "我母亲74岁广州，上个月摔倒了一次。"}),
    ("diet", {"text": "我父亲72岁广州，一个人住，做饭困难。"}),
]


def profile_to_json(p):
    return {k: v for k, v in p.items()}


def result_to_json(r):
    return r


def build_expected():
    out = {"database": DB.get("database_name"), "cases": []}
    for name, payload in CASES:
        base = payload.get("profile") or {}
        mode = payload.get("mode") or base.get("mode")
        profile = engine.build_profile(
            text=payload.get("text", ""),
            relation=base.get("relation") or payload.get("relation"),
            operator=base.get("operator") or payload.get("operator"),
            age=payload.get("age"),
            region=payload.get("region"),
            mode=mode,
        )
        for key in ("hukou", "insurance", "disability", "family_economic"):
            if key in base and base[key] is not None:
                profile[key] = base[key]
        if isinstance(base.get("confirmed_scenes"), list):
            profile["scenes"] = sorted(set(base["confirmed_scenes"]))
            profile["confirmed_scenes"] = list(profile["scenes"])
            profile["scenes_edited"] = True
        elif base.get("scenes_edited"):
            prev = base.get("confirmed_scenes")
            if isinstance(prev, list):
                profile["scenes"] = sorted(set(prev))
            profile["confirmed_scenes"] = list(profile["scenes"])
            profile["scenes_edited"] = True

        profile["missing_fields"] = engine.profile_missing_fields(profile)
        results = engine.match_policies(DB, profile)

        outline = {
            "name": name,
            "input": payload,
            "profile": profile,
            "results": results,
            "tier_summary": [
                {"tier": t, "count": c}
                for t, c in [(
                    k,
                    sum(1 for r in results if r.get("tier") == k),
                ) for k in ["强相关", "可能相关", "待确认"]]
                if c
            ],
            "scene_library": engine.build_scene_library(DB, profile),
        }
        out["cases"].append(outline)

    # 详情接口也要对
    details = {}
    for pid in [p["policy_id"] for p in DB.get("policies", [])]:
        policy = engine.find_policy(DB, pid)
        details[pid] = {
            "rag_text": engine.build_rag_text(policy),
            "validity": engine.derive_validity(policy),
        }
    out["details"] = details
    out["briefs"] = [
        {
            "policy_id": p["policy_id"],
            "policy_name": p["policy_name"],
            "category": p["category"],
            "service_type": p.get("service_type", ""),
            "region": (p.get("region", {}) or {}).get("scope", ""),
            "life_scenes": p.get("life_scenes", []),
            "verification_status": (p.get("verification", {}) or {}).get("status"),
        }
        for p in DB.get("policies", [])
    ]
    return out


if __name__ == "__main__":
    data = build_expected()
    target = os.path.join(ROOT, "build", "expected.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    total_results = sum(len(c["results"]) for c in data["cases"])
    print("用例 %d 个，政策结果 %d 条，详情 %d 条 -> expected.json"
          % (len(data["cases"]), total_results, len(data["details"])))
