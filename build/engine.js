/**
 * 《政策找人》浏览器端政策引擎
 *
 * 这是 backend/policy_engine.py 的逐行移植，用在没有后端的环境（GitHub Pages）。
 * 移植原则：**不做任何"优化"**。函数边界、判断顺序、默认值、字符串拼接方式
 * 全部照抄 Python 版，因为任何一处偏差都会让浏览器算出的结果和服务器对不上，
 * 而 .tools/baseline.py 的 12 条基线用例正是盯着这些输出的。
 *
 * Python 与 JS 的语义差异已逐处处理，下面每个 `[py]` 注释都在说明对应关系。
 *
 * 数据来源：由 build/build_pages.py 把 data/*.json 内联成 DB 常量。
 */

// ---------------------------------------------------------------- 词典
// 与 policy_engine.py:38-83 逐字一致
const SCENE_KEYWORDS = {
  独居: ['独居', '一个人住', '一个人生活', '自己住', '独自居住', '单独居住', '一个人'],
  行动不便: ['行动不便', '行动不方', '走路困难', '腿脚不便', '腿脚不好', '腿脚不方便',
    '腿脚不灵活', '不能走', '走不动',
    '坐轮椅', '轮椅', '行动困难', '不方便行动', '出门困难'],
  吃饭困难: ['做饭困难', '吃饭困难', '吃饭难', '买菜', '没饭吃', '做不了饭', '吃饭问题'],
  需要照护: ['需要照护', '需要照顾', '要人照顾', '需要人照顾', '要人陪', '照护',
    '照顾', '护理', '陪护'],
  长期卧床: ['长期卧床', '卧床', '瘫痪', '下不了床', '起不来床', '躺床上'],
  医疗护理压力: ['医疗', '看病', '住院', '药费', '医药费', '护理费', '治疗',
    '生病', '慢性病', '身体不好', '健康'],
  记忆下降: ['记忆', '忘事', '健忘', '痴呆', '认知', '阿尔茨海默', '迷路', '糊涂'],
  // 「摔过」「摔过一跤」是口语里最常见的说法，原来一条都不在表里。
  // 不放「摔」这种单字——「摔门」「摔东西」会误命中；
  // 新词都从「摔/跌」起头，原有的「没有摔倒」「没摔过」仍会走到 _negated。
  跌倒风险: ['摔倒', '跌倒', '摔了', '摔跤', '滑倒',
    '摔过', '摔过一次', '跌过一次', '跌过跤',
    '摔骨折', '摔伤', '跌伤'],
  子女无法陪伴: ['不在身边', '在外地', '没法陪', '无法陪', '没时间陪', '不能陪',
    '工作忙', '没人陪'],
  经济压力: ['费用高', '压力大', '经济困难', '没钱', '负担重', '费用压力'],
  不了解政策: ['不知道有', '不了解', '没听说过', '有哪些政策', '有什么补贴'],
  住院自付高: ['住院自付', '自付高', '自付费用高', '自付了', '自费高', '自付很多',
    '住院花', '住院费用高', '报销后还要', '自己掏'],
  大病医疗支出: ['大病', '重病', '重大疾病', '肿瘤', '癌症', '化疗', '透析', '手术费'],
  长期服药: ['长期吃药', '长期服药', '每天吃药', '常年吃药', '长期用药', '长期开药'],
  门诊特定病种: ['门诊特定病种', '门特', '门慢', '特定病种'],
  家庭经济困难: ['低保', '特困', '经济困难', '家庭困难', '困难家庭', '低收入'],
  收入偏低: ['收入低', '没有收入', '没收入', '收入不高', '没有固定收入'],
  需要长期照护: ['长期照护', '长期护理', '长期照顾'],
};

const RELATION_KEYWORDS = {
  父亲: ['父亲', '爸爸', '我爸', '老爸', '爹'],
  母亲: ['母亲', '妈妈', '我妈', '老妈', '娘'],
  爷爷: ['爷爷', '祖父'],
  奶奶: ['奶奶', '祖母'],
  外公: ['外公', '姥爷'],
  外婆: ['外婆', '姥姥'],
  配偶: ['老伴', '丈夫', '妻子', '爱人'],
};

const OPERATOR_KEYWORDS = {
  女儿: ['我是他女儿', '我是她女儿', '女儿'],
  儿子: ['我是他儿子', '我是她儿子', '儿子'],
  配偶: ['老伴', '丈夫', '妻子'],
  社区工作人员: ['我是社区', '社区工作人员', '网格员', '社工'],
};

const CN_DIGITS = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const REGION_ALIASES = {
  广州: '广州市', 佛山: '佛山市', 深圳: '深圳市', 东莞: '东莞市',
  珠海: '珠海市', 中山: '中山市', 惠州: '惠州市',
  北京: '北京市', 上海: '上海市',
};

// policy_engine.py:662-695
const SCENE_PLAIN = {
  年龄增长: '已到相关政策的年龄门槛附近',
  独居: '描述中提到独自居住',
  行动不便: '描述中提到行动、走路方面的困难',
  吃饭困难: '描述中提到做饭、吃饭方面的困难',
  需要照护: '描述中提到需要他人照顾、照护',
  长期卧床: '描述中提到长期卧床、下不了床',
  医疗护理压力: '描述中提到就医、护理费用方面的压力',
  记忆下降: '描述中提到记忆、认知方面的变化',
  跌倒风险: '描述中提到摔倒、跌倒风险',
  子女无法陪伴: '描述中提到子女不在身边、无法陪伴',
  经济压力: '描述中提到费用、经济方面的压力',
  不了解政策: '描述中提到此前不了解相关政策',
  身体能力下降: '描述中提到整体身体能力下降',
  居家环境不安全: '描述中提到居家环境存在安全隐患',
  长期健康问题: '描述中提到长期健康问题',
  需要健康检查: '描述中提到需要健康检查',
  慢性病管理: '描述中提到慢性病管理需求',
  疑似认知问题: '描述中提到疑似认知方面问题',
  家属担心老人状态: '描述中提到家属对老人状态的担心',
  无人照顾: '描述中提到身边无人照顾',
  护理费用压力: '描述中提到护理费用方面的压力',
  家庭照护困难: '描述中提到家庭照护方面的困难',
  需要社区帮助: '描述中提到需要社区层面的帮助',
  不愿入住养老机构: '描述中提到不愿入住养老机构',
  住院自付高: '描述中提到住院后个人负担的费用较高',
  大病医疗支出: '描述中提到重大疾病带来的医疗支出',
  长期服药: '描述中提到长期用药、长期开药',
  门诊特定病种: '描述中提到门诊特定病种（门特 / 门慢）',
  家庭经济困难: '描述中提到家庭经济困难或已取得相关认定',
  收入偏低: '描述中提到家庭收入偏低',
  需要长期照护: '描述中提到需要长期照护',
};

const COND_LABEL = {
  hukou: ['户籍条件', '具有广州市户籍', '不具有广州市户籍'],
  insurance: ['医保条件', '已参加广州市社会医疗保险', '未参加广州市社会医疗保险'],
  disability: ['失能条件', '属于失能或部分失能', '不属于失能或部分失能'],
};

const EXPIRING_DAYS = 180;
const DEDUCTIBLE_KEYS = ['deductible', 'deductible_tilted', 'tilted_deductible'];
const AMOUNT_UNIT = { 万: 10000, 千: 1000, 元: 1, 块: 1 };

// Python 的 truthiness：空数组 / 空对象 / 空串 / 0 / None 都是假。
// JS 里 [] 和 {} 是真值，移植时必须显式判断，否则「没有任何生活事件」
// 会被当成「有生活事件」，分层和理由全错。
function truthy(v) {
  if (v === null || v === undefined) return false;
  if (v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

/** Python 的 `x or default`。JS 的 || 对 [] / {} 行为不同，故单独实现。 */
function pyOr(v, fallback) {
  return truthy(v) ? v : fallback;
}

/** 稳定排序，对应 Python 的 sorted()。见下方 note 说明为何需要。 */
function pySorted(arr, cmp) {
  return arr.slice().sort(cmp);
}

// ---------------------------------------------------------------- 基础解析

function _cnToInt(text) {
  if (!text) return null;
  if (!text.includes('十')) {
    let total = 0;
    for (const ch of text) {
      if (!(ch in CN_DIGITS)) return null;
      total = total * 10 + CN_DIGITS[ch];
    }
    return total || null;
  }
  const idx = text.indexOf('十');
  const head = text.slice(0, idx);
  const tail = text.slice(idx + 1);
  const tens = head === '' ? 1 : CN_DIGITS[head];
  const ones = tail === '' ? 0 : CN_DIGITS[tail];
  if (tens === undefined || ones === undefined) return null;
  return tens * 10 + ones;
}

function parseAge(text) {
  let m = /(\d{1,3})\s*(?:岁|周岁)/.exec(text);
  if (m) {
    const age = parseInt(m[1], 10);
    if (age > 0 && age <= 130) return age;
  }
  m = /([零一二两三四五六七八九十]+)\s*(?:岁|周岁)/.exec(text);
  if (m) {
    const age = _cnToInt(m[1]);
    if (age && age > 0 && age <= 130) return age;
  }
  return null;
}

function parseAgeApprox(text) {
  let m = /(\d{1,3})\s*多\s*(?:岁|周岁)/.exec(text);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 130) return n;
  }
  m = /([零一二两三四五六七八九十]+)\s*多\s*(?:岁|周岁)/.exec(text);
  if (m) {
    const n = _cnToInt(m[1]);
    if (n && n > 0 && n <= 130) return n;
  }
  return null;
}

function normalizeRegion(name) {
  if (!truthy(name)) return name;
  const s = String(name).trim();
  if (!s || s.endsWith('市')) return s;
  return Object.prototype.hasOwnProperty.call(REGION_ALIASES, s) ? REGION_ALIASES[s] : s;
}

// policy_engine.py:168-170
const SELF_PAID_RE = /(?:自付|自费|自己掏|自己付|个人负担|个人支付)[^\d]{0,8}?(\d+(?:\.\d+)?)\s*(万|千|元|块)?/;

function parseSelfPaid(text) {
  if (!truthy(text)) return null;
  const m = SELF_PAID_RE.exec(text);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return null;
  const unit = m[2] || '元';
  const amount = num * (AMOUNT_UNIT[unit] !== undefined ? AMOUNT_UNIT[unit] : 1);
  if (amount <= 0 || amount > 10000000) return null;
  return Math.trunc(amount);
}

function parseRegion(text) {
  if (text.includes('广州')) return '广州市';
  if (text.includes('佛山')) return '佛山市';
  for (const other of ['深圳', '东莞', '北京', '上海', '珠海', '中山', '惠州']) {
    if (text.includes(other)) return other;
  }
  return null;
}

function detectScenes(text) {
  const hits = [];
  for (const scene of Object.keys(SCENE_KEYWORDS)) {
    for (const w of SCENE_KEYWORDS[scene]) {
      if (hasWord(text, w) && !_negated(text, w) && !_superseded(text, w)) {
        hits.push(scene);
        break;
      }
    }
  }
  return Array.from(new Set(hits)).sort();
}

// ---- 否定 / 时态 / 程度副词 / 矛盾：与 backend/policy_engine.py 逐条对齐 ----

// 程度副词：夹在关键词中间不影响意思（「压力很大」=「压力大」）
const DEGREE_WORDS = ["特别", "非常", "比较", "越来越", "更", "很", "挺", "太", "还", "都"];

// 否定词：长词在前，否则「并没有」会被「没有」截断后误判位置
const NEGATION_WORDS = [
  "并没有", "并不是", "并没有在", "并没有参加",
  "没有", "不是", "不算", "不属于", "未曾", "从未", "并不", "不再",
  "不", "没", "无",
];

const PAST_MARKERS = ["以前", "之前", "去年", "前年", "曾经", "原先", "原来", "过去", "早年"];
const NOW_MARKERS = ["现在", "如今", "目前", "现在的", "后来", "如今已", "已经能", "已经好了", "目前已经"];

const SENTENCE_BREAKS = ["。", "；", ";", "！", "!", "？", "?", "\n"];

/**
 * 关键词匹配：允许程度副词插在关键词中间。
 * 「压力大」遇上「压力很大」、「行动不便」遇上「行动很不方便」，字面不等但意思一致。
 */
function hasWord(text, word) {
  if (text.includes(word)) return true;
  let stripped = text;
  for (const adv of DEGREE_WORDS) {
    if (stripped.includes(adv)) stripped = stripped.split(adv).join("\u0000");
  }
  let target = word;
  for (const adv of DEGREE_WORDS) {
    if (target.includes(adv)) target = target.split(adv).join("\u0000");
  }
  if (target === word) {
    // 关键词本身不含副词：在去掉副词的文本里按「各字之间可隔着副词」匹配
    const pattern = Array.from(word).map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\u0000*");
    return new RegExp(pattern).test(stripped);
  }
  return stripped.includes(target);
}

/** 关键词前紧邻位置有否定词就视为不成立。只覆盖紧挨着的否定，不做整句语法分析。 */
function _negated(text, word) {
  let start = 0;
  for (;;) {
    const idx = text.indexOf(word, start);
    if (idx === -1) return false;
    const prefix = text.slice(Math.max(0, idx - 6), idx);
    for (const neg of NEGATION_WORDS) {
      const pos = prefix.lastIndexOf(neg);
      if (pos !== -1) {
        const tail = prefix.slice(pos + neg.length);
        if (tail.length <= 3 && !/[，。；、！？,.;!?]/.test(tail)) return true;
      }
    }
    start = idx + 1;
  }
}

/** 关键词描述的情况是否「已经过去了」：先说过去、后说现在，才算过期。 */
function _superseded(text, word) {
  let start = 0;
  for (;;) {
    const idx = text.indexOf(word, start);
    if (idx === -1) return false;
    let segStart = -1;
    for (const p of SENTENCE_BREAKS) {
      const j = text.lastIndexOf(p, idx - 1);
      if (j > segStart) segStart = j;
    }
    segStart += 1;
    const prefix = text.slice(segStart, idx);
    const hasPast = PAST_MARKERS.some((p) => prefix.includes(p));
    if (hasPast) {
      let segEnd = text.length;
      for (const p of SENTENCE_BREAKS) {
        const j = text.indexOf(p, idx);
        if (j !== -1 && j < segEnd) segEnd = j;
      }
      const suffix = text.slice(idx, segEnd);
      if (NOW_MARKERS.some((p) => suffix.includes(p))) return true;
    }
    start = idx + 1;
  }
}

/** 挑出「两种说法不可能同时成立」的组合，不替用户裁决。 */
function detectConflicts(text) {
  text = text || "";
  const found = [];
  const both = (groupA, groupB, kind, note) => {
    // 被否定的说法不算「说过」：「不是独居，和家人一起住」里独居恰恰被否认了，
    // 照字面计入会把一句自洽的话报成自相矛盾。已经过去的情况同理。
    const live = (words) => words.filter((w) => text.includes(w)
      && !_negated(text, w) && !_superseded(text, w));
    const hitA = live(groupA);
    const hitB = live(groupB);
    if (hitA.length && hitB.length) found.push({ kind, said: hitA.concat(hitB), note });
  };
  both(
    ["独居", "一个人生活", "一个人住", "独自居住", "单独居住", "自己住", "独自生活"],
    ["和子女一起住", "跟子女一起", "和子女同住", "和家人一起住", "跟家人一起",
      "有人陪", "有人照顾", "老伴在",
      // 同义但字面不同的说法，缺一条就漏掉「独居，又和家人同住」这种典型矛盾。
      // 只收「住在一起」：「有家人照应」「子女常来看」说的是有人帮不是同住，
      // 「独居，子女住得远，平时有家人照应」完全自洽，收进来会冤枉它。
      "和家人同住", "跟家人同住", "和子女共同生活", "跟老伴一起"],
    "居住情况",
    "既说独自居住，又说有人一起住或有人陪，需要确认哪一种是现在的情况。",
  );
  const hasLocal = /(是|属于)?本市户籍|广州户口|户口在广州|广州户籍/.test(text);
  if (hasLocal && /户口不在广州|不是本市户籍|户籍不在广州|外地户口/.test(text)) {
    found.push({
      kind: "户籍情况",
      said: ["本市户籍", "户口不在广州"],
      note: "户籍说法前后不一致，需要确认户口到底在广州还是外地。",
    });
  }
  return found;
}

function detectRelation(text, fallback) {
  for (const relation of Object.keys(RELATION_KEYWORDS)) {
    for (const w of RELATION_KEYWORDS[relation]) {
      if (text.includes(w)) return relation;
    }
  }
  return fallback === undefined ? null : fallback;
}

function detectOperator(text, fallback) {
  for (const role of Object.keys(OPERATOR_KEYWORDS)) {
    for (const w of OPERATOR_KEYWORDS[role]) {
      if (text.includes(w)) return role;
    }
  }
  return fallback === undefined ? null : fallback;
}

// ---------------------------------------------------------------- 画像

function buildProfile(opts) {
  const o = opts || {};
  let text = o.text || '';
  // [py] age = age if age is not None else parse_age(text)
  let age = o.age !== undefined && o.age !== null ? o.age : parseAge(text);
  const ageApprox = age === null ? parseAgeApprox(text) : null;
  const region = truthy(o.region) ? o.region : parseRegion(text);
  let scenes = detectScenes(text);

  const elderAge = age !== null ? age : ageApprox;
  if (elderAge && elderAge >= 60 && !scenes.includes('年龄增长')) {
    scenes.push('年龄增长');
  }
  scenes = Array.from(new Set(scenes)).sort();

  const relation = detectRelation(text, o.relation);
  const operator = detectOperator(text, o.operator);

  let who = '老人';
  if (relation) {
    who = relation !== '配偶' ? ('您' + relation) : '您的老伴';
  }

  let mode = o.mode !== undefined && o.mode !== null ? o.mode : null;
  let beneficiaryLabel;
  if (mode === 'self') {
    // [py] relation = None；本人模式不套用亲属关系
    const selfRelation = null;
    const selfOperator = operator || '本人';
    who = '您';
    beneficiaryLabel = '本人';
    return {
      age,
      region,
      hukou: null,
      insurance: null,
      disability: null,
      scenes,
      relation: selfRelation,
      operator: selfOperator,
      beneficiary_label: beneficiaryLabel,
      who,
      mode: 'self',
      raw_text: text,
      age_approx: ageApprox,
      self_paid_amount: parseSelfPaid(text),
      family_economic: null,
      // 自相矛盾的说法：不替用户裁决，交给界面去问。恒为数组。
      conflicts: detectConflicts(text),
    };
  }
  beneficiaryLabel = relation || '老人';

  return {
    age,
    region,
    hukou: null,
    insurance: null,
    disability: null,
    scenes,
    relation,
    operator,
    beneficiary_label: beneficiaryLabel,
    who,
    mode: 'family',
    raw_text: text,
    age_approx: ageApprox,
    self_paid_amount: parseSelfPaid(text),
    family_economic: null,
    // 自相矛盾的说法：不替用户裁决，交给界面去问。恒为数组。
    conflicts: detectConflicts(text),
  };
}

function profileMissingFields(profile) {
  const missing = [];
  if (profile.age === null || profile.age === undefined) missing.push('老人的年龄');
  if (profile.region === null || profile.region === undefined) missing.push('老人所在城市');
  if (!profile.scenes || profile.scenes.length === 0) {
    missing.push('老人最近的生活变化（如行动、就医、照护情况）');
  }
  return missing;
}

// ---------------------------------------------------------------- 文本拼接

function buildRagText(policy) {
  const parts = [
    policy.policy_name || '',
    policy.category || '',
    policy.service_type || '',
    policy.description || '',
    '面向人群：' + (policy.target_people || []).join('、'),
    '生活场景：' + (policy.life_scenes || []).join('、'),
    '关键词：' + (policy.keywords || []).join('、'),
  ];
  const cond = policy.conditions || {};
  const condDesc = [];
  if (truthy(cond.age_min)) condDesc.push('年龄不低于' + cond.age_min + '周岁');
  if (cond.hukou_required === true) condDesc.push('需本市户籍');
  if (cond.insurance_required === true) condDesc.push('需参加本市医保');
  if (cond.disability_required === true) condDesc.push('需失能或部分失能');
  for (const item of cond.other || []) condDesc.push(String(item));
  if (condDesc.length > 0) parts.push('条件：' + condDesc.join('；'));
  return parts.filter((p) => p).join('\n');
}

// ---------------------------------------------------------------- 通用小工具

function _dedup(items) {
  const out = [];
  for (const it of items || []) {
    if (!truthy(it)) continue;
    let replaced = false;
    for (let i = 0; i < out.length; i += 1) {
      const old = out[i];
      if (old.includes(it)) {      // 已有条目更完整
        replaced = true;
        break;
      }
      if (it.includes(old)) {      // 新条目更完整，替换
        out[i] = it;
        replaced = true;
        break;
      }
    }
    if (!replaced) out.push(it);
  }
  return out;
}

function _hasThreeLayer(policy) {
  const cond = policy.conditions || {};
  return Array.isArray(cond.qualify);
}

// ---------------------------------------------------------------- 第 1 层：资格条件

function _qualifyState(item, profile) {
  const key = item.key;
  const itype = item.type;
  const val = profile[key];

  if (itype === 'boolean') {
    if (val === true) return ['met', '您已确认：符合'];
    if (val === false) return ['failed', '您已确认：不符合'];
    return ['unknown', '尚未确认，需要您或受理单位核实'];
  }

  if (itype === 'enum') {
    const options = item.options || [];
    const labels = {};
    for (const o of options) labels[o.value] = o.label;
    if (val === null || val === undefined) return ['unknown', '尚未选择，需要您确认'];
    if (val === 'none') return ['failed', '您已确认：以上都不是'];
    return ['met', '您已确认：' + (labels[val] !== undefined ? labels[val] : val)];
  }

  if (itype === 'ratio_condition') {
    return ['unknown', '需按票据与家庭收入核算，建议向受理单位核实'];
  }

  return ['unknown', '尚未确认'];
}

function _checkQualify(policy, profile) {
  const missing = [];
  const rows = [];
  let blocked = false;

  for (const item of (policy.conditions || {}).qualify || []) {
    const [state, evidence] = _qualifyState(item, profile);
    rows.push({
      key: item.key,
      label: item.label || '',
      requirement: item.requirement || '',
      state,
      evidence,
      source_ref: item.source_ref || '',
    });
    if (state === 'failed') blocked = true;
    else if (state === 'unknown') missing.push(item.ask || item.label || item.key);
  }

  return [blocked, missing, rows];
}

// ---------------------------------------------------------------- 第 2 层：阈值

function thresholdSignal(policy, profile) {
  const ths = (policy.conditions || {}).thresholds || [];
  const values = ths
    .filter((t) => DEDUCTIBLE_KEYS.includes(t.key) && typeof t.value === 'number')
    .map((t) => t.value);
  if (values.length === 0) return null;

  const paid = profile.self_paid_amount;
  if (paid === null || paid === undefined) {
    return {
      touched: null,
      message: '尚未提供个人负担金额，无法判断是否已达到起付标准',
      action: '可在补充信息里填写个人负担的大致金额，或直接向医保部门核实',
    };
  }

  if (paid >= Math.min(...values)) {
    return {
      touched: true,
      message: '按您提供的金额，可能已触及起付标准',
      action: '具体标准请向医保部门核实',
    };
  }
  return {
    touched: false,
    message: '按您提供的金额，可能尚未达到起付标准',
    action: '具体标准请向医保部门核实；如后续费用增加可重新判断',
  };
}

function thresholdRows(policy) {
  const ths = (policy.conditions || {}).thresholds || [];
  const rows = [];
  for (const t of ths) {
    rows.push({
      label: t.label || '',
      unit: t.unit || '',
      source_ref: t.source_ref || '',
      has_value: (t.value !== null && t.value !== undefined) || truthy(t.formula),
      display: '具体标准请向医保部门核实',
    });
  }
  return rows;
}

// ---------------------------------------------------------------- 政策时效

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 解析 YYYY-MM-DD 为 UTC 零点的毫秒数。
 * [py] 用 datetime.date，只关心日期差；这里统一按 UTC 计算，避免本地时区
 * 让「今天」在跨零点时偏移一天，导致 expiring / expired 判定漂移。
 */
function _parseDate(s) {
  if (!truthy(s)) return null;
  const parts = String(s).trim().split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  // 拒绝 2024-02-31 这类溢出日期，与 Python datetime.date 抛错后返回 None 一致
  const back = new Date(t);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

function _todayUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * 与 Python 的键缺失对齐：Python 里 v.get("expires_at") 缺字段返回 None，
 * 但这个 None 经 json.dumps 出来仍然是 null；**真正缺键**（数据库里根本没有
 * 这个键）时 json.dumps 会省略该键。前端拿到的是 undefined，不是 null。
 *
 * 两者在 JS 里都是假值，渲染结果相同；但在对照测试里是不同的值，
 * 而且后续若有代码用 `in` 判断，语义也不同。所以这里显式模拟：
 * 键不存在就 delete，让返回对象与 Python 序列化后的形状完全一致。
 */
function _pickValiditySource(v) {
  const out = {};
  for (const key of ['expires_at', 'effective_from', 'verified_at']) {
    if (key in v) out[key] = v[key];
  }
  return out;
}

function deriveValidity(policy, today) {
  const v = policy.validity || {};
  const t = today === undefined || today === null ? _todayUtc() : today;

  const stored = v.status || 'active';
  const expires = _parseDate(v.expires_at);
  const sup = v.superseded_by;
  // [py] v.get("expires_at") —— 缺这个键时得到 None，返回的就是 null；
  // 只有「键存在但值为空」与「键不存在」在这里都落到 null，故统一取 vp，
  // 缺键时 vp 里没有该键，取出来即 undefined。
  const vp = _pickValiditySource(v);
  // basis：政策本体被延期/修改时，数据层把依据文件写在 validity.basis。
  // 原样透传（与后端 policy_engine.derive_validity 保持一致），仅用于展示，不参与时效判断。
  const basis = truthy(v.basis) ? v.basis : null;

  if (stored === 'superseded' && truthy(sup)) {
    const name = sup.name || '新文件';
    return {
      status: 'superseded',
      level: 'muted',
      expires_at: Object.prototype.hasOwnProperty.call(vp, 'expires_at') ? vp.expires_at : null,
      effective_from: Object.prototype.hasOwnProperty.call(vp, 'effective_from') ? vp.effective_from : null,
      verified_at: Object.prototype.hasOwnProperty.call(vp, 'verified_at') ? vp.verified_at : null,
      superseded_by: sup,
      message: '该政策已由《' + name + '》替代，请查看新规',
      basis: basis,
    };
  }

  if (stored === 'expired' || (expires !== null && expires < t)) {
    return {
      status: 'expired',
      level: 'muted',
      expires_at: Object.prototype.hasOwnProperty.call(vp, 'expires_at') ? vp.expires_at : null,
      effective_from: Object.prototype.hasOwnProperty.call(vp, 'effective_from') ? vp.effective_from : null,
      verified_at: Object.prototype.hasOwnProperty.call(vp, 'verified_at') ? vp.verified_at : null,
      superseded_by: sup,
      message: '该政策已过有效期，请以最新文件为准',
      basis: basis,
    };
  }

  if (expires !== null && (expires - t) / DAY_MS <= EXPIRING_DAYS) {
    return {
      status: 'expiring',
      level: 'warn',
      expires_at: Object.prototype.hasOwnProperty.call(vp, 'expires_at') ? vp.expires_at : null,
      effective_from: Object.prototype.hasOwnProperty.call(vp, 'effective_from') ? vp.effective_from : null,
      verified_at: Object.prototype.hasOwnProperty.call(vp, 'verified_at') ? vp.verified_at : null,
      superseded_by: null,
      message: '本办法有效期至 ' + v.expires_at + '，届时请以最新文件为准',
      basis: basis,
    };
  }

  return {
    status: 'active',
    level: 'normal',
    expires_at: Object.prototype.hasOwnProperty.call(vp, 'expires_at') ? vp.expires_at : null,
    effective_from: Object.prototype.hasOwnProperty.call(vp, 'effective_from') ? vp.effective_from : null,
    verified_at: Object.prototype.hasOwnProperty.call(vp, 'verified_at') ? vp.verified_at : null,
    superseded_by: null,
    message: '',
    basis: basis,
  };
}

// ---------------------------------------------------------------- 硬条件

function _hardConditionCheck(policy, profile) {
  const regionScope = (policy.region || {}).scope;
  if (regionScope && truthy(profile.region)) {
    if (normalizeRegion(profile.region) !== normalizeRegion(regionScope)) {
      return [true, ['该政策适用于' + regionScope + '，老人当前所在地区为' + profile.region]];
    }
  }

  if (_hasThreeLayer(policy)) {
    const [blocked, missing] = _checkQualify(policy, profile);
    return [blocked, missing];
  }

  const cond = policy.conditions || {};
  const missing = [];

  const ageMin = cond.age_min;
  if (truthy(ageMin)) {
    if (profile.age === null || profile.age === undefined) {
      missing.push('老人是否已年满' + ageMin + '周岁');
    } else if (profile.age < ageMin) {
      return [true, ['老人年龄未达到' + ageMin + '周岁的服务门槛']];
    }
  }

  if (cond.hukou_required === true) {
    if (profile.hukou === null || profile.hukou === undefined) {
      missing.push('老人是否具有广州市户籍');
    } else if (profile.hukou === false) {
      return [true, ['该权益要求广州市户籍，您已确认老人不具有本市户籍']];
    }
  }

  if (cond.insurance_required === true) {
    if (profile.insurance === null || profile.insurance === undefined) {
      missing.push('老人是否参加广州市社会医疗保险');
    } else if (profile.insurance === false) {
      return [true, ['该待遇要求参加广州市社会医疗保险，您已确认老人未参保']];
    }
  }

  if (cond.disability_required === true) {
    if (profile.disability === null || profile.disability === undefined) {
      missing.push('老人是否属于失能或部分失能（建议先做照护需求综合评估）');
    } else if (profile.disability === false) {
      return [true, ['该服务面向失能或部分失能老年人，您已确认老人不属于该范围']];
    }
  }

  return [false, missing];
}

function renderReason(templates, profile) {
  const rendered = [];
  for (const tpl of templates || []) {
    if (tpl.includes('{age}') && (profile.age === null || profile.age === undefined)) continue;
    if (tpl.includes('{region}') && !truthy(profile.region)) continue;
    let text = tpl.split('{who}').join(profile.who);
    text = text.split('{age}').join(String(profile.age));
    text = text.split('{region}').join(truthy(profile.region) ? profile.region : '当地');
    rendered.push(text);
  }
  return rendered;
}

// ---------------------------------------------------------------- 证据链

function _quoteSource(policy) {
  const src = policy.source || {};
  const parts = [];
  if (truthy(src.document) && src.document !== 'to_verify') parts.push(String(src.document));
  if (truthy(src.document_no)) parts.push(String(src.document_no));
  if (parts.length === 0) return '';
  let text = parts.join('、');
  if (truthy(src.publish_date)) text += '（' + src.publish_date + '）';
  return text;
}

function buildEvidenceChain(policy, profile, hitScenes, missing) {
  const basis = [];
  for (const s of hitScenes) {
    basis.push({
      kind: 'scene',
      label: s,
      text: SCENE_PLAIN[s] !== undefined ? SCENE_PLAIN[s] : '描述中提到的相关生活情况',
    });
  }
  if (profile.age !== null && profile.age !== undefined) {
    basis.push({ kind: 'age', label: '年龄 ' + profile.age + ' 岁', text: '由您在描述中提供' });
  }
  if (truthy(profile.region)) {
    basis.push({ kind: 'region', label: profile.region, text: '由您在描述中提供' });
  }

  const cond = policy.conditions || {};
  const conds = [];

  if (_hasThreeLayer(policy)) {
    const rows = _checkQualify(policy, profile)[2];
    for (const r of rows) {
      conds.push({
        label: r.label,
        requirement: r.requirement,
        state: r.state,
        evidence: r.evidence,
        source_ref: r.source_ref,
      });
    }
    for (const t of thresholdRows(policy)) {
      conds.push({
        label: t.label,
        requirement: t.display,
        state: 'unknown',
        evidence: '阈值仅用于内部判断，页面不展示具体数值',
        source_ref: t.source_ref,
        is_threshold: true,
      });
    }
  } else {
    if (truthy(cond.age_min)) {
      const met = profile.age !== null && profile.age !== undefined && profile.age >= cond.age_min;
      conds.push({
        label: '年龄门槛',
        requirement: '年满 ' + cond.age_min + ' 周岁',
        state: met ? 'met' : 'unknown',
        evidence: (profile.age !== null && profile.age !== undefined)
          ? ('您描述为 ' + profile.age + ' 岁') : '尚未提供年龄',
      });
    }
    for (const key of ['hukou', 'insurance', 'disability']) {
      const req = cond[key + '_required'];
      if (req !== true) continue;
      const [label, yesText, noText] = COND_LABEL[key];
      const val = profile[key];
      let state;
      let ev;
      if (val === true) { state = 'met'; ev = '您已确认：' + yesText; }
      else if (val === false) { state = 'failed'; ev = '您已确认：' + noText; }
      else { state = 'unknown'; ev = '尚未确认，需要您或受理单位核实'; }
      conds.push({ label, requirement: '需符合：' + yesText, state, evidence: ev });
    }
    for (const item of cond.other || []) {
      conds.push({
        label: '其他条件',
        requirement: String(item),
        state: 'unknown',
        evidence: '需向受理单位确认适用口径',
      });
    }
  }

  const src = policy.source || {};
  const ver = policy.verification || {};
  const pending = ver.status === 'to_verify';
  const citation = {
    department: src.department || '',
    document: src.document === 'to_verify' ? '' : (src.document || ''),
    document_no: src.document_no || '',
    publish_date: src.publish_date || '',
    quote: _quoteSource(policy),
    verified: !pending,
    checked_at: ver.checked_at || '',
    official_url: src.official_url || '',
  };

  return {
    profile_basis: basis,
    policy_conditions: conds,
    citation,
    pending_count: conds.filter((c) => c.state === 'unknown').length,
  };
}

function assignTier(result) {
  if (truthy(result.matched_scenes)) {
    if (result.status === '待确认') return '可能相关';
    return '强相关';
  }
  return '待确认';
}

// ---------------------------------------------------------------- 打分与匹配

function scorePolicy(policy, profile) {
  const [blocked, missing] = _hardConditionCheck(policy, profile);
  if (blocked) return null;

  const signals = (policy.match || {}).scene_signals || [];
  const hit = signals.filter((s) => profile.scenes.includes(s));

  if (hit.length === 0) {
    const cond = policy.conditions || {};
    const ageMin = cond.age_min;
    const ok = truthy(ageMin) && truthy(profile.age) && profile.age >= ageMin;
    if (!ok) return null;
  }

  const priority = pyOr((policy.match || {}).priority, 3);
  let score = hit.length * 10 + Math.max(0, 4 - priority) * 3;
  if (hit.includes('年龄增长')) score += 2;

  let status = missing.length > 0 ? '待确认' : '可能相关';
  const sourceStatus = (policy.verification || {}).status || 'to_verify';

  const policySource = policy.source || {};
  const policyVerification = policy.verification || {};

  let reasons = renderReason(policy.ai_reason || [], profile);
  const sceneMap = policy.scene_reason_map || {};
  for (const scene of hit) {
    if (sceneMap[scene] !== undefined) reasons.push(sceneMap[scene]);
  }

  const hitEmpty = hit.length === 0;
  if (hitEmpty) {
    reasons = reasons.filter((r) => r.includes('岁') || r.includes('年龄') || r.includes('周岁'));
    reasons.push('目前仅依据年龄作出初步提示，是否有对应需求还需您确认');
    status = '待确认';
    score = Math.min(score, 5);
  }

  return {
    policy_id: policy.policy_id,
    policy_name: policy.policy_name,
    category: policy.category,
    service_type: policy.service_type || '',
    region: (policy.region || {}).scope || '',
    status,
    score,
    ai_reason: reasons,
    matched_scenes: hit,
    missing_information: _dedup(missing.concat(policy.missing_information || [])),
    source_status: sourceStatus,
    source_pending: sourceStatus === 'to_verify',
    source_department: policySource.department || '',
    source_document_no: policySource.document_no || '',
    source_official_url: policySource.official_url || '',
    source_publish_date: policySource.publish_date || '',
    source_checked_at: policyVerification.checked_at || '',
    service_note: policy.service_note || '',
    evidence: buildEvidenceChain(policy, profile, hit, missing),
    tier: assignTier({ status, matched_scenes: hit }),
    policy_level: policy.policy_level || '',
    validity: deriveValidity(policy),
    green_note: policy.green_note || null,
    materials: policy.materials || [],
    threshold_signal: thresholdSignal(policy, profile),
    // [py] (policy.get("conditions") or {}).get("result_params") —— 缺键即 None
    result_params: (policy.conditions || {}).result_params !== undefined
      ? (policy.conditions || {}).result_params
      : null,
  };
}

function matchPolicies(db, profile) {
  const results = [];
  for (const policy of db.policies || []) {
    const r = scorePolicy(policy, profile);
    if (r) results.push(r);
  }
  // [py] results.sort(key=lambda x: (-x["score"], x["policy_id"]))
  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.policy_id < b.policy_id) return -1;
    if (a.policy_id > b.policy_id) return 1;
    return 0;
  });
  return results;
}

function findPolicy(db, policyId) {
  for (const policy of db.policies || []) {
    if (policy.policy_id === policyId) return policy;
  }
  return null;
}

// ---------------------------------------------------------------- 生活事件库

function buildSceneLibrary(db, profile) {
  const events = [];
  const seen = new Set();

  for (const name of db.scene_tag_library || []) {
    if (!seen.has(name)) { seen.add(name); events.push(name); }
  }
  for (const p of db.policies || []) {
    const combined = (p.life_scenes || []).concat((p.match || {}).scene_signals || []);
    for (const name of combined) {
      if (name && !seen.has(name)) { seen.add(name); events.push(name); }
    }
  }

  const detected = new Set(pyOr((profile || {}).scenes, []));

  const items = [];
  for (const name of events) {
    const related = [];
    for (const p of db.policies || []) {
      const signals = (p.match || {}).scene_signals || [];
      if (signals.includes(name) || (p.life_scenes || []).includes(name)) {
        related.push(p.policy_id);
      }
    }
    items.push({
      name,
      plain: SCENE_PLAIN[name] !== undefined ? SCENE_PLAIN[name] : '与您描述的情况相关',
      detected: detected.has(name),
      related_count: related.length,
    });
  }

  // [py] items.sort(key=lambda x: (not x["detected"], -x["related_count"], x["name"]))
  items.sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    if (a.related_count !== b.related_count) return b.related_count - a.related_count;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  return items;
}

function toggleScene(profile, scene, on) {
  let scenes = (profile.scenes || []).slice();
  if (on) {
    if (!scenes.includes(scene)) scenes.push(scene);
  } else {
    scenes = scenes.filter((s) => s !== scene);
  }
  return Array.from(new Set(scenes)).sort();
}

// ---------------------------------------------------------------- 对外入口
// 与 backend/server.py 的接口返回结构一一对应，这样前端 API 层可以原样对接。

const DISCLAIMER = '本页面由AI根据您描述的生活情况进行初步匹配，'
  + '仅用于提示可能相关的公共服务权益，不代表已符合政策资格。'
  + '最终资格由主管部门核定。';

function _brief(policy) {
  return {
    policy_id: policy.policy_id,
    policy_name: policy.policy_name,
    category: policy.category,
    service_type: policy.service_type || '',
    region: (policy.region || {}).scope || '',
    life_scenes: policy.life_scenes || [],
    verification_status: (policy.verification || {}).status,
  };
}

function _tierSummary(results) {
  const order = ['强相关', '可能相关', '待确认'];
  const counts = {};
  for (const k of order) counts[k] = 0;
  for (const r of results) {
    if (r.tier in counts) counts[r.tier] += 1;
  }
  return order.filter((k) => counts[k] > 0).map((k) => ({ tier: k, count: counts[k] }));
}

function _detail(policy, profile) {
  const data = Object.assign({}, policy);
  data.rag_text = buildRagText(policy);
  if (truthy(profile)) {
    data.ai_reason_rendered = renderReason(policy.ai_reason || [], profile);
  }
  data.validity = deriveValidity(policy);
  data.threshold_signal = truthy(profile) ? thresholdSignal(policy, profile) : null;
  return data;
}

/** DB 由页面在引擎脚本之前注入（见 build/build_pages.py）。 */
function localApi(DB) {
  if (!DB) throw new Error('政策库未加载');

  return {
    health() {
      return {
        ok: true,
        database: DB.database_name,
        version: DB.version,
        policy_count: (DB.policies || []).length,
        disclaimer: DISCLAIMER,
      };
    },

    policies() {
      return {
        total: (DB.policies || []).length,
        policies: (DB.policies || []).map(_brief),
      };
    },

    policy(id) {
      const p = findPolicy(DB, id);
      if (!p) throw new Error('policy not found');
      return _detail(p);
    },

    scenes(profile) {
      return {
        scenes: buildSceneLibrary(DB, profile),
        disclaimer: DISCLAIMER,
      };
    },

    tiers() {
      return {
        tiers: [
          { key: '强相关', desc: 'AI 从您的描述中识别到了对应的生活事件，且没有关键条件缺口' },
          { key: '可能相关', desc: '识别到了对应生活事件，但仍有户籍、医保、失能等待确认的条件' },
          { key: '待确认', desc: '目前仅依据年龄等基础信息提示，是否有对应需求还需要您确认' },
        ],
      };
    },

    // 与 server.py:207-217 一致
    profile(payload) {
      const p = payload || {};
      const profile = buildProfile({
        text: p.text || '',
        relation: p.relation,
        operator: p.operator,
        age: p.age,
        region: p.region,
        mode: p.mode,
      });
      profile.missing_fields = profileMissingFields(profile);
      return { profile, disclaimer: DISCLAIMER };
    },

    // 与 server.py:219-272 一致，包括那 4 条「只沿用用户明确作答过的事实」的规则
    match(payload) {
      const p = payload || {};
      const text = p.text || '';
      const base = p.profile || {};
      const mode = truthy(p.mode) ? p.mode : base.mode;
      const profile = buildProfile({
        text,
        relation: truthy(base.relation) ? base.relation : p.relation,
        operator: truthy(base.operator) ? base.operator : p.operator,
        age: p.age,
        region: p.region,
        mode,
      });
      for (const key of ['hukou', 'insurance', 'disability', 'family_economic']) {
        if (key in base && base[key] !== null && base[key] !== undefined) {
          profile[key] = base[key];
        }
      }
      if (Array.isArray(base.confirmed_scenes)) {
        profile.scenes = Array.from(new Set(base.confirmed_scenes)).sort();
        profile.confirmed_scenes = profile.scenes.slice();
        profile.scenes_edited = true;
      } else if (base.scenes_edited) {
        const prev = base.confirmed_scenes;
        if (Array.isArray(prev)) {
          profile.scenes = Array.from(new Set(prev)).sort();
        }
        profile.confirmed_scenes = profile.scenes.slice();
        profile.scenes_edited = true;
      }

      profile.missing_fields = profileMissingFields(profile);
      const results = matchPolicies(DB, profile);
      return {
        profile,
        results,
        total: results.length,
        tier_summary: _tierSummary(results),
        scene_library: buildSceneLibrary(DB, profile),
        disclaimer: DISCLAIMER,
        notice: '以下为初步匹配结果，均需进一步确认，不作为资格认定。',
      };
    },

    explain(payload) {
      const p = payload || {};
      const policy = findPolicy(DB, p.policy_id || '');
      if (!policy) throw new Error('policy not found');
      const saved = p.profile || {};
      const profile = buildProfile({
        text: saved.raw_text || '',
        relation: saved.relation,
        operator: saved.operator,
        age: saved.age,
        region: saved.region,
        mode: saved.mode,
      });
      return { policy: _detail(policy, profile), disclaimer: DISCLAIMER };
    },
  };
}
