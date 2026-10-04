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
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data")

# 政策库注册表。用环境变量 POLICY_DB 选择：guangzhou / foshan / 任意文件路径。
# 默认仍为广州库，佛山库需显式切换——避免本轮引擎改造影响既有回归基线。
# 注意：foshan 为扩展入口，V1.0 起随包提供该政策库；若部署环境未附带数据文件，
# load_database() 会打印明确提示并回退到默认广州库，不会崩溃。
DATABASES = {
    "guangzhou": os.path.join(DATA_DIR, "guangzhou_elderly_policy_v1.1.json"),
    "foshan": os.path.join(DATA_DIR, "foshan_medical_assistance_v1.json"),
}
DB_KEY = os.environ.get("POLICY_DB", "guangzhou")
DB_PATH = DATABASES.get(DB_KEY, DB_KEY)

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
    # ---- 医疗救助域（佛山场景，见 data/foshan_medical_assistance_v1.json）
    "住院自付高": ["住院自付", "自付高", "自付费用高", "自付了", "自费高", "自付很多",
                   "住院花", "住院费用高", "报销后还要", "自己掏"],
    "大病医疗支出": ["大病", "重病", "重大疾病", "肿瘤", "癌症", "化疗", "透析", "手术费"],
    "长期服药": ["长期吃药", "长期服药", "每天吃药", "常年吃药", "长期用药", "长期开药"],
    "门诊特定病种": ["门诊特定病种", "门特", "门慢", "特定病种"],
    "家庭经济困难": ["低保", "特困", "经济困难", "家庭困难", "困难家庭", "低收入"],
    "收入偏低": ["收入低", "没有收入", "没收入", "收入不高", "没有固定收入"],
    "需要长期照护": ["长期照护", "长期护理", "长期照顾"],
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


# 地区名归一化：比较时把「佛山」「深圳」等统一成「XX市」。
# 只用于比较，不改变对外返回的展示值（避免影响既有基线中的 region 字段）。
REGION_ALIASES = {
    "广州": "广州市", "佛山": "佛山市", "深圳": "深圳市", "东莞": "东莞市",
    "珠海": "珠海市", "中山": "中山市", "惠州": "惠州市",
    "北京": "北京市", "上海": "上海市",
}


def normalize_region(name):
    """把地区名归一成「XX市」形式用于比较。空值原样返回，未知名称原样返回。"""
    if not name:
        return name
    s = str(name).strip()
    if not s or s.endswith("市"):
        return s
    return REGION_ALIASES.get(s, s)


# 个人负担金额：只识别与「自付 / 自费 / 自己掏」明确关联的数字，
# 避免把住院总花费、年龄等无关数字误当作自付额。
_SELF_PAID_RE = re.compile(
    r"(?:自付|自费|自己掏|自己付|个人负担|个人支付)[^\d]{0,8}?(\d+(?:\.\d+)?)\s*(万|千|元|块)?"
)
_AMOUNT_UNIT = {"万": 10000, "千": 1000, "元": 1, "块": 1}


def parse_self_paid(text):
    """
    解析用户自述的、经报销后个人负担的医疗费用（元）。
    仅用于与政策起付标准做内部比较，不参与任何金额计算、不对外输出数值。
    解析不到返回 None，不猜测。
    """
    if not text:
        return None
    m = _SELF_PAID_RE.search(text)
    if not m:
        return None
    try:
        num = float(m.group(1))
    except ValueError:
        return None
    unit = m.group(2) or "元"
    amount = num * _AMOUNT_UNIT.get(unit, 1)
    if amount <= 0 or amount > 10000000:      # 超过一千万视为解析异常
        return None
    return int(amount)


def parse_region(text):
    """解析地区。当前支持广州与佛山两套库，其他地区由上层提示无对应数据。"""
    if "广州" in text:
        return "广州市"
    if "佛山" in text:
        return "佛山市"
    for other in ["深圳", "东莞", "北京", "上海", "珠海", "中山", "惠州"]:
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
        # ---- 佛山医疗救助场景新增（旧库用不到，恒为 None，不影响既有输出）
        # self_paid_amount 仅用于与政策起付标准做内部比较，不对外输出数值
        "self_paid_amount": parse_self_paid(text),
        # family_economic 取值见各政策 conditions.qualify[].options
        "family_economic": None,
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
    """
    读取政策库。path 默认取自 POLICY_DB（未设置时为 guangzhou）。

    保护：若指定的库文件不存在（例如部署环境未附带所选的政策库文件），
    不抛 FileNotFoundError 让服务起不来，而是打印明确提示并回退到默认广州库。
    只影响本次实际加载的库，不改变注册表，也不引入任何政策数据。
    """
    if not os.path.exists(path):
        fallback = DATABASES["guangzhou"]
        sys.stderr.write(
            "[政策库] 未找到 %s；本分支未携带该政策库，已回退到默认库：%s\n"
            % (path, fallback)
        )
        path = fallback
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


def _has_three_layer(policy):
    """
    判断该政策是否使用新版三层条件模型（见 docs/policy-data-spec.md）。
    广州库沿用旧式扁平 conditions（age_min / hukou_required / ...），走原路径，行为不变。
    """
    cond = policy.get("conditions") or {}
    return isinstance(cond.get("qualify"), list)


# ---------------------------------------------------------------- 第 1 层：资格条件
# 决定「用户是否符合」。三值 boolean / 有限枚举 enum / 作为条件的比例 ratio_condition。
# 未知一律转「待确认」，明确不符合才 blocked——与旧路径同一套产品原则。

def _qualify_state(item, profile):
    """
    单项资格条件的三值判断。
    返回 (state, evidence)
    state: met | failed | unknown
    """
    key = item.get("key")
    itype = item.get("type")
    val = profile.get(key)

    if itype == "boolean":
        if val is True:
            return "met", "您已确认：符合"
        if val is False:
            return "failed", "您已确认：不符合"
        return "unknown", "尚未确认，需要您或受理单位核实"

    if itype == "enum":
        options = item.get("options") or []
        labels = {o.get("value"): o.get("label") for o in options}
        if val is None:
            return "unknown", "尚未选择，需要您确认"
        if val == "none":
            return "failed", "您已确认：以上都不是"
        return "met", "您已确认：%s" % labels.get(val, val)

    if itype == "ratio_condition":
        # 比例型条件：需要票据与家庭收入核算，用户无法自判，一律转待确认。
        # 这是「按用途划线」的直接收益——比例作为条件时归第 1 层，参与判定。
        return "unknown", "需按票据与家庭收入核算，建议向受理单位核实"

    return "unknown", "尚未确认"


def _check_qualify(policy, profile):
    """
    新版三层模型的第 1 层检查。
    返回 (blocked, missing_list, condition_rows)
    """
    missing = []
    rows = []
    blocked = False

    for item in (policy.get("conditions") or {}).get("qualify", []) or []:
        state, evidence = _qualify_state(item, profile)
        rows.append({
            "key": item.get("key"),
            "label": item.get("label", ""),
            "requirement": item.get("requirement", ""),
            "state": state,
            "evidence": evidence,
            "source_ref": item.get("source_ref", ""),
        })
        if state == "failed":
            blocked = True
        elif state == "unknown":
            missing.append(item.get("ask") or item.get("label") or item.get("key"))

    return blocked, missing, rows


# ---------------------------------------------------------------- 第 2 层：阈值
# 入库、参与内部比较，但**任何页面渲染路径都不得输出该数值**。
# 输出只能是「你可能已触及门槛，建议向医保部门核实具体标准」。

_DEDUCTIBLE_KEYS = ("deductible", "deductible_tilted", "tilted_deductible")


def threshold_signal(policy, profile):
    """
    把用户自述的个人负担金额与起付标准做内部比较。
    返回 None（该政策无起付线）或字典；字典里**不含任何阈值数值**。
    """
    ths = (policy.get("conditions") or {}).get("thresholds") or []
    values = [t.get("value") for t in ths
              if t.get("key") in _DEDUCTIBLE_KEYS and isinstance(t.get("value"), (int, float))]
    if not values:
        return None

    paid = profile.get("self_paid_amount")
    if paid is None:
        return {
            "touched": None,
            "message": "尚未提供个人负担金额，无法判断是否已达到起付标准",
            "action": "可在补充信息里填写个人负担的大致金额，或直接向医保部门核实",
        }

    if paid >= min(values):
        return {
            "touched": True,
            "message": "按您提供的金额，可能已触及起付标准",
            "action": "具体标准请向医保部门核实",
        }
    return {
        "touched": False,
        "message": "按您提供的金额，可能尚未达到起付标准",
        "action": "具体标准请向医保部门核实；如后续费用增加可重新判断",
    }


def threshold_rows(policy):
    """
    阈值的展示行。**只给名称与出处，不给数值**——这是产品红线。
    """
    ths = (policy.get("conditions") or {}).get("thresholds") or []
    rows = []
    for t in ths:
        rows.append({
            "label": t.get("label", ""),
            "unit": t.get("unit", ""),
            "source_ref": t.get("source_ref", ""),
            "has_value": t.get("value") is not None or bool(t.get("formula")),
            "display": "具体标准请向医保部门核实",
        })
    return rows


# ---------------------------------------------------------------- 政策时效

EXPIRING_DAYS = 180


def _parse_date(s):
    """解析 YYYY-MM-DD。失败返回 None，不猜测。"""
    if not s:
        return None
    try:
        parts = str(s).strip().split("-")
        if len(parts) != 3:
            return None
        import datetime
        return datetime.date(int(parts[0]), int(parts[1]), int(parts[2]))
    except Exception:
        return None


def derive_validity(policy, today=None):
    """
    从 validity 派生展示状态。
    数据层只存 active / expired / superseded；expiring 由 expires_at 与当天日期计算，
    不写死在数据里（见 docs/policy-data-spec.md 第二节）。
    返回 {status, level, expires_at, effective_from, verified_at, superseded_by, message}
    level: normal | warn | muted
    """
    import datetime
    v = policy.get("validity") or {}
    today = today or datetime.date.today()

    stored = v.get("status") or "active"
    expires = _parse_date(v.get("expires_at"))
    sup = v.get("superseded_by")

    if stored == "superseded" and sup:
        name = sup.get("name") or "新文件"
        return {
            "status": "superseded",
            "level": "muted",
            "expires_at": v.get("expires_at"),
            "effective_from": v.get("effective_from"),
            "verified_at": v.get("verified_at"),
            "superseded_by": sup,
            "message": "该政策已由《%s》替代，请查看新规" % name,
        }

    if stored == "expired" or (expires and expires < today):
        return {
            "status": "expired",
            "level": "muted",
            "expires_at": v.get("expires_at"),
            "effective_from": v.get("effective_from"),
            "verified_at": v.get("verified_at"),
            "superseded_by": sup,
            "message": "该政策已过有效期，请以最新文件为准",
        }

    if expires and (expires - today).days <= EXPIRING_DAYS:
        return {
            "status": "expiring",
            "level": "warn",
            "expires_at": v.get("expires_at"),
            "effective_from": v.get("effective_from"),
            "verified_at": v.get("verified_at"),
            "superseded_by": None,
            "message": "本办法有效期至 %s，届时请以最新文件为准" % v.get("expires_at"),
        }

    return {
        "status": "active",
        "level": "normal",
        "expires_at": v.get("expires_at"),
        "effective_from": v.get("effective_from"),
        "verified_at": v.get("verified_at"),
        "superseded_by": None,
        "message": "",
    }


def _hard_condition_check(policy, profile):
    """
    硬条件检查。
    返回 (blocked, missing_list)
    - blocked=True 表示明确不符合（例如年龄明确低于门槛），直接不推荐
    - missing_list 表示需要用户补充确认的信息

    新版三层模型（佛山库）走 _check_qualify；旧式扁平条件（广州库）走原路径。
    两条路径共享同一条产品原则：未知转「待确认」，明确不符合才排除。
    """
    # 地区不符一律排除，两种模型通用。比较时做归一化，避免「佛山」与「佛山市」被判死。
    region_scope = (policy.get("region", {}) or {}).get("scope")
    if region_scope and profile.get("region"):
        if normalize_region(profile["region"]) != normalize_region(region_scope):
            return True, ["该政策适用于%s，老人当前所在地区为%s" % (region_scope, profile["region"])]

    # 新版三层模型：第 1 层资格条件
    if _has_three_layer(policy):
        blocked, missing, _rows = _check_qualify(policy, profile)
        return blocked, missing

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


# ---------------------------------------------------------------- 证据链
# 目标：让每一条推荐都能回答三个问题——
#   1. 依据用户的哪一句话 / 哪一个生活事件？（来源：画像）
#   2. 对应政策的哪一条结构化条件？（来源：conditions）
#   3. 这条结论的可信度来自哪个部门的哪份文件？（来源：source）
# 三段全部取自数据库已有字段，不新增字段、不改写政策表述。

# 生活事件 -> 该事件在数据库里的口语化说明（用于让用户看懂 AI 认出了什么）
SCENE_PLAIN = {
    "年龄增长": "已到相关政策的年龄门槛附近",
    "独居": "描述中提到独自居住",
    "行动不便": "描述中提到行动、走路方面的困难",
    "吃饭困难": "描述中提到做饭、吃饭方面的困难",
    "需要照护": "描述中提到需要他人照顾、照护",
    "长期卧床": "描述中提到长期卧床、下不了床",
    "医疗护理压力": "描述中提到就医、护理费用方面的压力",
    "记忆下降": "描述中提到记忆、认知方面的变化",
    "跌倒风险": "描述中提到摔倒、跌倒风险",
    "子女无法陪伴": "描述中提到子女不在身边、无法陪伴",
    "经济压力": "描述中提到费用、经济方面的压力",
    "不了解政策": "描述中提到此前不了解相关政策",
    "身体能力下降": "描述中提到整体身体能力下降",
    "居家环境不安全": "描述中提到居家环境存在安全隐患",
    "长期健康问题": "描述中提到长期健康问题",
    "需要健康检查": "描述中提到需要健康检查",
    "慢性病管理": "描述中提到慢性病管理需求",
    "疑似认知问题": "描述中提到疑似认知方面问题",
    "家属担心老人状态": "描述中提到家属对老人状态的担心",
    "无人照顾": "描述中提到身边无人照顾",
    "护理费用压力": "描述中提到护理费用方面的压力",
    "家庭照护困难": "描述中提到家庭照护方面的困难",
    "需要社区帮助": "描述中提到需要社区层面的帮助",
    "不愿入住养老机构": "描述中提到不愿入住养老机构",
    # ---- 医疗救助域
    "住院自付高": "描述中提到住院后个人负担的费用较高",
    "大病医疗支出": "描述中提到重大疾病带来的医疗支出",
    "长期服药": "描述中提到长期用药、长期开药",
    "门诊特定病种": "描述中提到门诊特定病种（门特 / 门慢）",
    "家庭经济困难": "描述中提到家庭经济困难或已取得相关认定",
    "收入偏低": "描述中提到家庭收入偏低",
    "需要长期照护": "描述中提到需要长期照护",
}

# 三值条件的中文标签，用于证据链里逐条列出
_COND_LABEL = {
    "hukou": ("户籍条件", "具有广州市户籍", "不具有广州市户籍"),
    "insurance": ("医保条件", "已参加广州市社会医疗保险", "未参加广州市社会医疗保险"),
    "disability": ("失能条件", "属于失能或部分失能", "不属于失能或部分失能"),
}


def _quote_source(policy):
    """从 source 里拼一句可读的依据表述；缺字段就只返回已有的部分，绝不补写。"""
    src = policy.get("source", {}) or {}
    parts = []
    if src.get("document") and src["document"] != "to_verify":
        parts.append(str(src["document"]))
    if src.get("document_no"):
        parts.append(str(src["document_no"]))
    if not parts:
        return ""
    text = "、".join(parts)
    if src.get("publish_date"):
        text += "（%s）" % src["publish_date"]
    return text


def build_evidence_chain(policy, profile, hit_scenes, missing):
    """
    为单条政策生成「证据链」：画像依据 → 政策条件 → 官方依据。
    每一段都只引用数据库已有内容；查不到就留空，不做任何推断性表述。
    """
    # ---- 第1 段：画像依据（用户提供了什么）
    basis = []
    for s in hit_scenes:
        basis.append({
            "kind": "scene",
            "label": s,
            "text": SCENE_PLAIN.get(s, "描述中提到的相关生活情况"),
        })
    if profile.get("age") is not None:
        basis.append({
            "kind": "age",
            "label": "年龄 %s 岁" % profile["age"],
            "text": "由您在描述中提供",
        })
    if profile.get("region"):
        basis.append({
            "kind": "region",
            "label": profile["region"],
            "text": "由您在描述中提供",
        })

    # ---- 第2 段：政策条件（这条权益要求什么，哪些还没确认）
    cond = policy.get("conditions", {}) or {}
    conds = []

    if _has_three_layer(policy):
        # 新版三层模型：第 1 层资格条件逐条列出；第 2 层阈值只给名称与出处，不给数值。
        _blocked, _missing, rows = _check_qualify(policy, profile)
        for r in rows:
            conds.append({
                "label": r["label"],
                "requirement": r["requirement"],
                "state": r["state"],
                "evidence": r["evidence"],
                "source_ref": r["source_ref"],
            })
        for t in threshold_rows(policy):
            conds.append({
                "label": t["label"],
                "requirement": t["display"],
                "state": "unknown",
                "evidence": "阈值仅用于内部判断，页面不展示具体数值",
                "source_ref": t["source_ref"],
                "is_threshold": True,
            })
    else:
        if cond.get("age_min"):
            met = profile.get("age") is not None and profile["age"] >= cond["age_min"]
            conds.append({
                "label": "年龄门槛",
                "requirement": "年满 %s 周岁" % cond["age_min"],
                "state": "met" if met else "unknown",
                "evidence": ("您描述为 %s 岁" % profile["age"]) if profile.get("age") is not None
                            else "尚未提供年龄",
            })
        for key in ("hukou", "insurance", "disability"):
            req = cond.get(key + "_required")
            if req is not True:
                continue
            label, yes_text, no_text = _COND_LABEL[key]
            val = profile.get(key)
            if val is True:
                state, ev = "met", "您已确认：%s" % yes_text
            elif val is False:
                state, ev = "failed", "您已确认：%s" % no_text
            else:
                state, ev = "unknown", "尚未确认，需要您或受理单位核实"
            conds.append({
                "label": label,
                "requirement": "需符合：%s" % yes_text,
                "state": state,
                "evidence": ev,
            })
        for item in cond.get("other", []) or []:
            conds.append({
                "label": "其他条件",
                "requirement": str(item),
                "state": "unknown",
                "evidence": "需向受理单位确认适用口径",
            })

    # ---- 第3 段：官方依据
    src = policy.get("source", {}) or {}
    ver = policy.get("verification", {}) or {}
    pending = ver.get("status") == "to_verify"
    citation = {
        "department": src.get("department", ""),
        "document": "" if src.get("document") == "to_verify" else src.get("document", ""),
        "document_no": src.get("document_no", ""),
        "publish_date": src.get("publish_date", ""),
        "quote": _quote_source(policy),
        "verified": not pending,
        "checked_at": ver.get("checked_at", ""),
    }

    return {
        "profile_basis": basis,
        "policy_conditions": conds,
        "citation": citation,
        "pending_count": len([c for c in conds if c["state"] == "unknown"]),
    }


def assign_tier(result):
    """
    结果分层：只做展示分组，不改变推荐与否。
    强相关：有场景命中且无关键条件缺口
    可能相关：有场景命中，但存在待确认项
    待确认：仅年龄门槛命中、缺少生活事件支撑
    """
    if result.get("matched_scenes"):
        if result.get("status") == "待确认":
            return "可能相关"
        return "强相关"
    return "待确认"


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
        # 证据链与分层：纯展示派生，不参与任何判断，也不改变上面任何既有字段
        "evidence": build_evidence_chain(policy, profile, hit, missing),
        "tier": assign_tier({"status": status, "matched_scenes": hit}),
        # 佛山库新增字段。全部为纯透传或纯派生：广州库缺这些字段时返回空值/None，
        # 既有调用方与基线输出完全不受影响。
        "policy_level": policy.get("policy_level", ""),
        "validity": derive_validity(policy),
        "green_note": policy.get("green_note") or None,
        "materials": policy.get("materials") or [],
        "threshold_signal": threshold_signal(policy, profile),
        "result_params": (policy.get("conditions") or {}).get("result_params"),
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


# ---------------------------------------------------------------- 生活事件库
# 作用：把「生活事件」变成用户可见、可确认、可修正的一等公民，
# 而不是只藏在 AI 的中间结果里。用户可以据此判断 AI 有没有认错自己的情况。

def build_scene_library(db, profile=None):
    """
    构造生活事件库：每个事件标注「AI 是否已从描述中识别」+「可能关联哪些权益方向」。
    事件清单取自数据库的 scene_tag_library 与各政策的 life_scenes 并集，不新增事件定义。
    profile 为空时只返回清单，用于发现页的确认台。
    """
    events = []
    seen = set()

    # 以数据库里真实出现的事件为准：scene_tag_library + 各政策 life_scenes + match 信号
    for name in db.get("scene_tag_library", []) or []:
        if name not in seen:
            seen.add(name)
            events.append(name)
    for p in db.get("policies", []):
        for name in (p.get("life_scenes") or []) + ((p.get("match") or {}).get("scene_signals") or []):
            if name and name not in seen:
                seen.add(name)
                events.append(name)

    detected = set((profile or {}).get("scenes") or [])

    items = []
    for name in events:
        related = []
        for p in db.get("policies", []):
            signals = (p.get("match") or {}).get("scene_signals") or []
            if name in signals or name in (p.get("life_scenes") or []):
                related.append(p["policy_id"])
        items.append({
            "name": name,
            "plain": SCENE_PLAIN.get(name, "与您描述的情况相关"),
            "detected": name in detected,
            "related_count": len(related),
        })

    # 已识别的排前面，方便用户第一眼看到 AI 认出了什么
    items.sort(key=lambda x: (not x["detected"], -x["related_count"], x["name"]))
    return items


def toggle_scene(profile, scene, on):
    """
    用户手动增删生活事件。返回新的 scenes 列表。
    这是人机协同的关键动作：AI 给建议，用户可以纠正。
    """
    scenes = list(profile.get("scenes") or [])
    if on:
        if scene not in scenes:
            scenes.append(scene)
    else:
        scenes = [s for s in scenes if s != scene]
    return sorted(set(scenes))
