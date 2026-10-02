"""
《政策找人》—— 规则匹配引擎（V1，不接入大模型）

职责：
1. 读取政策数据库 data/guangzhou_elderly_policy_v1.1.json
2. 把用户的一段生活情况描述解析成「老人画像」
3. 用结构化条件 + 生活场景标签做规则匹配，输出「可能相关」的权益
4. 为未来 RAG 生成扁平化的 rag_text

设计约束（产品原则）：
- 引擎只输出「可能相关 / 待确认」，绝不输出「符合资格」
- 硬条件未知时不排除政策，而是转为「待确认」并列出缺口信息
- 来源未核验（to_verify）的政策必须带上待核验标记
"""

import json
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
DB_PATH = os.path.join(ROOT_DIR, "data", "guangzhou_elderly_policy_v1.1.json")

# ---------------------------------------------------------------- 生活场景词典
# 关键词 -> 生活场景标签（与数据库的 scene_tag_library / match.scene_signals 对齐）
SCENE_KEYWORDS = {
    "独居": ["独居", "一个人住", "一个人生活", "自己住", "独自居住", "单独居住", "一个人"],
    "行动不便": ["行动不便", "行动不方", "走路困难", "腿脚不便", "不能走", "走不动",
                 "坐轮椅", "轮椅", "行动困难", "不方便行动", "出门困难"],
    "吃饭困难": ["做饭困难", "吃饭困难", "吃饭难", "买菜", "没饭吃", "做不了饭", "吃饭问题"],
    "需要照护": ["需要照护", "需要照顾", "要人照顾", "需要人照顾", "要人陪", "照护",
                 "照顾", "护理", "陪护"],
    "长期卧床": ["长期卧床", "卧床", "瘫痪", "下不了床", "起不来床", "躺床上"],
    "医疗护理压力": ["医疗", "看病", "住院", "药费", "医药费", "护理费", "治疗",
                     "生病", "慢性病", "身体不好", "健康"],
    "记忆下降": ["记忆", "忘事", "健忘", "痴呆", "认知", "阿尔茨海默", "迷路", "糊涂"],
    "跌倒风险": ["摔倒", "跌倒", "摔了", "摔跤", "滑倒"],
    "子女无法陪伴": ["不在身边", "在外地", "没法陪", "无法陪", "没时间陪", "不能陪",
                     "工作忙", "没人陪"],
    "经济压力": ["费用高", "压力大", "经济困难", "没钱", "负担重", "费用压力"],
    "不了解政策": ["不知道有", "不了解", "没听说过", "有哪些政策", "有什么补贴"],
}

# 亲属称谓 -> 受益人称谓
RELATION_KEYWORDS = {
    "父亲": ["父亲", "爸爸", "我爸", "老爸", "爹"],
    "母亲": ["母亲", "妈妈", "我妈", "老妈", "娘"],
    "爷爷": ["爷爷", "祖父"],
    "奶奶": ["奶奶", "祖母"],
    "外公": ["外公", "姥爷"],
    "外婆": ["外婆", "姥姥"],
    "配偶": ["老伴", "丈夫", "妻子", "爱人"],
}

# 操作者身份关键词
OPERATOR_KEYWORDS = {
    "女儿": ["我是他女儿", "我是她女儿", "女儿"],
    "儿子": ["我是他儿子", "我是她儿子", "儿子"],
    "配偶": ["老伴", "丈夫", "妻子"],
    "社区工作人员": ["我是社区", "社区工作人员", "网格员", "社工"],
}

CN_DIGITS = {
    "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
}


def _cn_to_int(text):
    """把 70 以内的中文数字转成整数，例如 七十二 -> 72，八十 -> 80。失败返回 None。"""
    if not text:
        return None
    if "十" not in text:
        total = 0
        for ch in text:
            if ch not in CN_DIGITS:
                return None
            total = total * 10 + CN_DIGITS[ch]
        return total if total else None
    head, _, tail = text.partition("十")
    tens = 1 if head == "" else CN_DIGITS.get(head)
    ones = 0 if tail == "" else CN_DIGITS.get(tail)
    if tens is None or ones is None:
        return None
    return tens * 10 + ones


def parse_age(text):
    """从文本中解析年龄，支持「72岁」「72 周岁」「七十二岁」。"""
    m = re.search(r"(\d{1,3})\s*(?:岁|周岁)", text)
    if m:
        age = int(m.group(1))
        if 0 < age <= 130:
            return age
    m = re.search(r"([零一二两三四五六七八九十]+)\s*(?:岁|周岁)", text)
    if m:
        age = _cn_to_int(m.group(1))
        if age and 0 < age <= 130:
            return age
    return None


def parse_region(text):
    """解析地区。当前库只覆盖广州，其他地区返回 unknown 由上层提示。"""
    if "广州" in text:
        return "广州市"
    for other in ["深圳", "佛山", "东莞", "北京", "上海", "珠海", "中山", "惠州"]:
        if other in text:
            return other
    return None


def detect_scenes(text):
    """从文本中识别生活场景标签。"""
    hits = []
    for scene, words in SCENE_KEYWORDS.items():
        for w in words:
            if w in text:
                hits.append(scene)
                break
    return sorted(set(hits))


def detect_relation(text, fallback=None):
    for relation, words in RELATION_KEYWORDS.items():
        for w in words:
            if w in text:
                return relation
    return fallback


def detect_operator(text, fallback=None):
    for role, words in OPERATOR_KEYWORDS.items():
        for w in words:
            if w in text:
                return role
    return fallback


def build_profile(text="", relation=None, operator=None, age=None, region=None, mode=None):
    """
    把用户输入解析成老人画像。未知字段一律保留为 None，不猜测。
    mode="self" 为本人模式：受益人是用户自己，称谓用「您」，不套用亲属关系。
    mode 为 None 时是原有的家庭协助模式，行为完全不变。
    """
    text = text or ""
    age = age if age is not None else parse_age(text)
    region = region or parse_region(text)
    scenes = detect_scenes(text)

    # 年龄本身就是一种生活变化：达到 60/65/70 后自动补充「年龄增长」标签
    if age and age >= 60 and "年龄增长" not in scenes:
        scenes.append("年龄增长")
    scenes = sorted(set(scenes))

    relation = detect_relation(text, relation)
    operator = detect_operator(text, operator)

    # 受益人称呼，用于渲染推荐原因，例如「您父亲」
    who = "老人"
    if relation:
        who = "您" + relation if relation not in ("配偶",) else "您的老伴"

    if mode == "self":
        # 本人模式：为自己查询，不套用亲属关系
        relation = None
        operator = operator or "本人"
        who = "您"
        beneficiary_label = "本人"
    else:
        beneficiary_label = relation or "老人"

    profile = {
        "age": age,
        "region": region,
        "hukou": None,
        "insurance": None,
        "disability": None,
        "scenes": scenes,
        "relation": relation,
        "operator": operator,
        "beneficiary_label": beneficiary_label,
        "who": who,
        "mode": mode or "family",
        "raw_text": text,
    }
    return profile


def profile_missing_fields(profile):
    """画像层面的信息缺口（与具体政策无关的部分）。"""
    missing = []
    if profile["age"] is None:
        missing.append("老人的年龄")
    if profile["region"] is None:
        missing.append("老人所在城市")
    if not profile["scenes"]:
        missing.append("老人最近的生活变化（如行动、就医、照护情况）")
    return missing


def load_database(path=DB_PATH):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_rag_text(policy):
    """把一条政策压平成用于未来向量检索的文本（RAG 预留）。"""
    parts = [
        policy.get("policy_name", ""),
        policy.get("category", ""),
        policy.get("service_type", ""),
        policy.get("description", ""),
        "面向人群：" + "、".join(policy.get("target_people", [])),
        "生活场景：" + "、".join(policy.get("life_scenes", [])),
        "关键词：" + "、".join(policy.get("keywords", [])),
    ]
    cond = policy.get("conditions", {}) or {}
    cond_desc = []
    if cond.get("age_min"):
        cond_desc.append("年龄不低于%s周岁" % cond["age_min"])
    if cond.get("hukou_required") is True:
        cond_desc.append("需本市户籍")
    if cond.get("insurance_required") is True:
        cond_desc.append("需参加本市医保")
    if cond.get("disability_required") is True:
        cond_desc.append("需失能或部分失能")
    for item in cond.get("other", []) or []:
        cond_desc.append(str(item))
    if cond_desc:
        parts.append("条件：" + "；".join(cond_desc))
    return "\n".join([p for p in parts if p])


def _dedup(items):
    """保序去重；若两条信息互为包含关系，保留信息更完整的那条。"""
    out = []
    for it in items or []:
        if not it:
            continue
        replaced = False
        for i, old in enumerate(out):
            if it in old:          # 已有条目更完整
                replaced = True
                break
            if old in it:          # 新条目更完整，替换
                out[i] = it
                replaced = True
                break
        if not replaced:
            out.append(it)
    return out


def _hard_condition_check(policy, profile):
    """
    硬条件检查。
    返回 (blocked, missing_list)
    - blocked=True 表示明确不符合（例如年龄明确低于门槛），直接不推荐
    - missing_list 表示需要用户补充确认的信息
    """
    cond = (policy.get("conditions", {}) or {})
    missing = []

    age_min = cond.get("age_min")
    if age_min:
        if profile["age"] is None:
            missing.append("老人是否已年满%s周岁" % age_min)
        elif profile["age"] < age_min:
            return True, ["老人年龄未达到%s周岁的服务门槛" % age_min]

    # 三值判断：None=未知（转为待确认） / True=符合 / False=明确不符合（直接不推荐）
    if cond.get("hukou_required") is True:
        if profile["hukou"] is None:
            missing.append("老人是否具有广州市户籍")
        elif profile["hukou"] is False:
            return True, ["该权益要求广州市户籍，您已确认老人不具有本市户籍"]

    if cond.get("insurance_required") is True:
        if profile["insurance"] is None:
            missing.append("老人是否参加广州市社会医疗保险")
        elif profile["insurance"] is False:
            return True, ["该待遇要求参加广州市社会医疗保险，您已确认老人未参保"]

    if cond.get("disability_required") is True:
        if profile["disability"] is None:
            missing.append("老人是否属于失能或部分失能（建议先做照护需求综合评估）")
        elif profile["disability"] is False:
            return True, ["该服务面向失能或部分失能老年人，您已确认老人不属于该范围"]

    region_scope = (policy.get("region", {}) or {}).get("scope")
    if region_scope and profile["region"] and profile["region"] != region_scope:
        return True, ["该政策适用于%s，老人当前所在地区为%s" % (region_scope, profile["region"])]

    return False, missing


def render_reason(templates, profile):
    """渲染 ai_reason 占位符：{who} {age} {region}。缺值时丢弃该条原因。"""
    rendered = []
    for tpl in templates or []:
        if "{age}" in tpl and profile["age"] is None:
            continue
        if "{region}" in tpl and not profile["region"]:
            continue
        text = tpl.replace("{who}", profile["who"])
        text = text.replace("{age}", str(profile["age"]))
        text = text.replace("{region}", profile["region"] or "当地")
        rendered.append(text)
    return rendered


def score_policy(policy, profile):
    """
    计算一条政策与画像的匹配情况。
    返回 None（不推荐）或结果字典。
    """
    blocked, missing = _hard_condition_check(policy, profile)
    if blocked:
        return None

    signals = (policy.get("match", {}) or {}).get("scene_signals", []) or []
    hit = [s for s in signals if s in profile["scenes"]]

    # 无任何场景命中时，仅保留年龄门槛类政策（如长寿保健金）
    if not hit:
        cond = policy.get("conditions", {}) or {}
        age_min = cond.get("age_min")
        if not (age_min and profile["age"] and profile["age"] >= age_min):
            return None

    priority = (policy.get("match", {}) or {}).get("priority", 3) or 3
    score = len(hit) * 10 + max(0, 4 - priority) * 3
    if "年龄增长" in hit:
        score += 2

    status = "待确认" if missing else "可能相关"
    source_status = (policy.get("verification", {}) or {}).get("status", "to_verify")

    # 以下仅为「数据透传」：把 policy JSON 中已有的来源字段带出给前端展示，
    # 不参与任何打分 / 硬条件判断，不新增数据库字段。
    policy_source = policy.get("source", {}) or {}
    policy_verification = policy.get("verification", {}) or {}

    # 推荐理由只允许由画像事实支撑：
    # 1) ai_reason 为政策侧表述（年龄等条件命中即可成立）
    # 2) scene_reason_map 仅在对应生活场景确实被识别时才生成
    reasons = render_reason(policy.get("ai_reason", []), profile)
    scene_map = policy.get("scene_reason_map", {}) or {}
    for scene in hit:
        if scene in scene_map:
            reasons.append(scene_map[scene])

    if not hit:
        # 仅靠年龄门槛命中，没有任何生活场景支撑：不能断言用户存在某类需求
        reasons = [r for r in reasons if ("岁" in r or "年龄" in r or "周岁" in r)]
        reasons.append("目前仅依据年龄作出初步提示，是否有对应需求还需您确认")
        status = "待确认"
        score = min(score, 5)

    return {
        "policy_id": policy["policy_id"],
        "policy_name": policy["policy_name"],
        "category": policy["category"],
        "service_type": policy.get("service_type", ""),
        "region": (policy.get("region", {}) or {}).get("scope", ""),
        "status": status,
        "score": score,
        "ai_reason": reasons,
        "matched_scenes": hit,
        "missing_information": _dedup(list(missing) + list(policy.get("missing_information", []) or [])),
        "source_status": source_status,
        "source_pending": source_status == "to_verify",
        # 透传字段（展示用，不影响匹配结果）
        "source_department": policy_source.get("department", ""),
        "source_document_no": policy_source.get("document_no", ""),
        "source_publish_date": policy_source.get("publish_date", ""),
        "source_checked_at": policy_verification.get("checked_at", ""),
        "service_note": policy.get("service_note", ""),
    }


def match_policies(db, profile):
    """对全库做匹配，返回按分数排序的结果列表。"""
    results = []
    for policy in db.get("policies", []):
        r = score_policy(policy, profile)
        if r:
            results.append(r)
    results.sort(key=lambda x: (-x["score"], x["policy_id"]))
    return results


def find_policy(db, policy_id):
    for policy in db.get("policies", []):
        if policy["policy_id"] == policy_id:
            return policy
    return None
