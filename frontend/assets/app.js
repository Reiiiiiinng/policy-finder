/**
 * 《政策找人》前端公共脚本
 * - 接口封装（同源 /api）
 * - 会话状态（sessionStorage）：帮助对象、操作者、受益人、画像
 * - 状态徽章与文案渲染
 */

const API = {
  async get(path) {
    const res = await fetch(path);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return res.json();
  },
  health: () => API.get('/api/health'),
  match: (payload) => API.post('/api/match', payload),
  policy: (id) => API.get('/api/policy/' + encodeURIComponent(id)),
  explain: (policyId, profile) => API.post('/api/explain', { policy_id: policyId, profile }),
  scenes: (profile) => API.get('/api/scenes'
    + (profile ? '?profile=' + encodeURIComponent(JSON.stringify(profile)) : '')),
};

const store = {
  key: 'policy_finder_session',
  read() {
    try {
      return JSON.parse(sessionStorage.getItem(this.key) || '{}');
    } catch (e) {
      return {};
    }
  },
  write(patch) {
    const next = Object.assign(this.read(), patch);
    sessionStorage.setItem(this.key, JSON.stringify(next));
    return next;
  },
  clear() {
    sessionStorage.removeItem(this.key);
  },
};

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ==========================================================================
   站点上下文（SITE）
   目的：页面里不再写死城市名。当前政策库覆盖哪个城市，文案就跟着变。
   数据来源：/api/policies 每条政策都带 region 字段（后端既有字段，无需改动后端）。
   取不到时保持默认值（广州），保证任何情况下页面都能正常渲染，v1.0 行为不变。
   ========================================================================== */
const SITE = {
  region: '广州市',
  regionShort: '广州',
  policyCount: 0,
  loaded: false,
};

/**
 * 政策库名 → 该库覆盖的城市。
 * 政策库顶层本来就有 region 字段，但接口没有暴露它；而每条政策上的 region
 * 字段在部分库里是空的。所以这里按政策库名兜底，不依赖政策库内容。
 * 新增城市时，在下面加一行，并在 DEMO_PROFILES 里补一个案例即可。
 */
const SITE_REGION_BY_DB = {
  '广州养老政策数据库': '广州市',
  '佛山医疗救助政策数据库': '佛山市',
};

let _sitePromise = null;

/**
 * 读取站点上下文，同一页面内只请求一次。失败不抛错，用默认值兜底。
 * 取值优先级：
 *   1) 政策库里每条政策的 region 字段（数据层若补齐，自动生效，无需改这里）
 *   2) 政策库名 → 城市的对照表（当前走的这条）
 */
function loadSiteContext() {
  if (_sitePromise) return _sitePromise;
  _sitePromise = (async () => {
    let dbName = '';
    try {
      const h = await API.health();
      dbName = (h && h.database) || '';
      SITE.policyCount = (h && h.policy_count) || 0;
    } catch (e) {
      // 接口不可用：保持默认值，不阻塞页面
    }

    let region = '';
    try {
      const d = await API.get('/api/policies');
      const list = d.policies || [];
      // 取政策库里出现次数最多的地区
      const counts = {};
      list.forEach((p) => {
        if (p.region) counts[p.region] = (counts[p.region] || 0) + 1;
      });
      region = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
      if (!SITE.policyCount) SITE.policyCount = d.total || list.length;
    } catch (e) {
      // 同上
    }

    if (!region) region = SITE_REGION_BY_DB[dbName] || '';
    if (region) {
      SITE.region = region;
      SITE.regionShort = String(region).replace(/市$/, '');
    }

    SITE.loaded = true;
    return SITE;
  })();
  return _sitePromise;
}

/**
 * 演示案例档案：按政策库覆盖城市取对应案例。
 * 广州条目与 v1.0 完全一致（不破坏现有 Demo）；其他城市缺失时用通用兜底。
 */
const DEMO_PROFILES = {
  '广州市': {
    text: '我{who}72岁，一个人在广州生活，最近行动不方便。',
    selfText: '我72岁，一个人在广州生活，最近行动不方便。',
    who: '父亲',
    short: '72岁广州老人',
    title: '72 岁 · 广州 · 独居 · 行动不便',
    tags: ['72岁广州老人', '独居', '行动不便'],
    banner: '72岁广州老人 · 独居 · 行动不便',
    desc: '推荐答辩案例 · 72岁广州老人，独居，行动不便',
    rows: [['年龄', '72 岁'], ['地区', '广州'], ['家庭关系', '女儿帮助父亲查询'],
           ['居住情况', '独居'], ['身体情况', '行动不便']],
  },
  '佛山市': {
    text: '我{who}78岁，在佛山，上个月住院花了6万多，自付了3万。',
    selfText: '我78岁，在佛山，上个月住院花了6万多，自付了3万。',
    who: '母亲',
    short: '78岁佛山老人',
    title: '78 岁 · 佛山 · 住院自付 3 万',
    tags: ['78岁佛山老人', '住院', '自付 3 万'],
    banner: '78岁佛山老人 · 住院自付 3 万',
    desc: '推荐答辩案例 · 78岁佛山老人，住院自付 3 万',
    rows: [['年龄', '78 岁'], ['地区', '佛山'], ['家庭关系', '女儿帮助母亲查询'],
           ['就医情况', '住院'], ['自付金额', '3 万元']],
  },
};

/** 取当前政策库对应的演示案例；未登记的城市按站点上下文生成中性案例。 */
function demoProfile() {
  if (DEMO_PROFILES[SITE.region]) return DEMO_PROFILES[SITE.region];
  const r = SITE.regionShort;
  return {
    text: `我{who}72岁，在${r}生活，最近行动不方便。`,
    selfText: `我72岁，在${r}生活，最近行动不方便。`,
    who: '父亲',
    short: `72岁${r}老人`,
    title: `72 岁 · ${r} · 行动不便`,
    tags: [`72岁${r}老人`, '行动不便'],
    banner: `72岁${r}老人 · 行动不便`,
    desc: `推荐答辩案例 · 72岁${r}老人，行动不便`,
    rows: [['年龄', '72 岁'], ['地区', r], ['家庭关系', '女儿帮助父亲查询'],
           ['身体情况', '行动不便']],
  };
}

/** 把演示案例模板里的 {who} 换成实际受益人称呼。 */
function demoText(who) {
  const p = demoProfile();
  return String(p.text).replace('{who}', who || p.who);
}

/** 地区名比较：容忍「广州」与「广州市」写法差异。 */
function regionMatches(value, target) {
  const norm = (s) => String(s || '').trim().replace(/市$/, '');
  const a = norm(value);
  const b = norm(target);
  return !!a && !!b && a === b;
}

/**
 * 比赛演示模式：在页面顶部插入一条「演示案例」提示，避免评委误认为是真实用户数据。
 * 仅当 sessionStorage 里 demoBanner=true 时显示。各页面加载后调用 mountDemoBanner() 即可。
 */
function renderDemoBanner() {
  return `<div class="demo-banner" role="status" aria-live="polite">
    <span class="demo-banner-badge">演示案例</span>
    <span class="demo-banner-text">${escapeHtml(demoProfile().banner)}</span>
    <span class="demo-banner-note">以下为虚拟案例，不代表真实个人情况</span>
    <button type="button" class="demo-banner-reset" id="demoResetBtn">重新体验</button>
  </div>`;
}

function mountDemoBanner() {
  if (!store.read().demoBanner) return;
  const app = document.querySelector('.app');
  if (!app) return;
  const tb = app.querySelector('.topbar');
  if (!tb) return;
  if (app.querySelector('.demo-banner')) return;
  tb.insertAdjacentHTML('afterend', renderDemoBanner());
  const reset = document.getElementById('demoResetBtn');
  if (reset) {
    reset.addEventListener('click', () => {
      store.clear();
      location.href = 'index.html';
    });
  }
}

/**
 * 体验进度条：四步，当前步高亮。只在 demo 模式下显示。
 * current: 1=选择帮助对象 2=描述生活变化 3=AI发现可能权益 4=查看办理方式
 */
function renderDemoProgress(current) {
  const steps = [
    { n: 1, label: '选择帮助对象' },
    { n: 2, label: '描述生活变化' },
    { n: 3, label: 'AI发现可能权益' },
    { n: 4, label: '查看办理方式' },
  ];
  const parts = steps.map((s) => {
    const cls = s.n < current ? 'done' : (s.n === current ? 'active' : '');
    const mark = s.n < current ? '✓' : String(s.n);
    return `<div class="dstep ${cls}"><span class="dstep-n">${mark}</span><span class="dstep-label">${escapeHtml(s.label)}</span></div>`;
  });
  // 在每两个步骤之间插一条连线
  let html = '';
  parts.forEach((p, i) => {
    html += p;
    if (i < parts.length - 1) html += '<span class="dstep-line"></span>';
  });
  return `<div class="demo-progress">${html}</div>`;
}

function mountDemoProgress(current) {
  if (!store.read().demoBanner) return;
  const app = document.querySelector('.app');
  if (!app) return;
  let bar = app.querySelector('.demo-progress');
  if (bar) bar.remove();
  const anchor = app.querySelector('.demo-banner') || app.querySelector('.topbar');
  if (!anchor) return;
  anchor.insertAdjacentHTML('afterend', renderDemoProgress(current));
}

/** 状态徽章：可能相关 / 待确认 + 核验状态 */
function statusBadge(status, sourcePending) {
  let cls = 'maybe';
  let text = status || '可能相关';
  if (status === '待确认') cls = 'confirm';
  let html = `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
  // 来源核验状态始终显式呈现：有 ✓ 已核验，没有就是来源待核验，不做模糊处理
  html += sourcePending
    ? ' <span class="badge pending">来源待核验</span>'
    : ' <span class="badge verified">✓ 已核验</span>';
  return html;
}

/**
 * 本人模式称谓转换（只改展示，不碰后端逻辑与数据）。
 * 后端为保持规则统一，待确认项统一写作「老人…」；本人模式下展示为「您…」。
 */
function personalize(text, profile) {
  let t = String(text == null ? '' : text);
  if (!profile || profile.mode !== 'self') return t;
  t = t.replace(/独居老人/g, '独居时您');
  t = t.replace(/老人/g, '您');
  t = t.replace(/您您+/g, '您');
  return t;
}

/**
 * 说明「为什么这项还需要确认」。
 * 只用通用解释，不替任何一条政策编造具体门槛、金额或口径。
 */
function explainMissing(text) {
  const t = String(text || '');
  if (/户籍/.test(t)) return '为什么需要确认？部分养老服务政策以户籍或参保地为准，未确认前无法判断是否适用。';
  if (/医保|参保|保险/.test(t)) return `为什么需要确认？长期护理保险等待遇以是否参加${SITE.region}社会医疗保险为前提。`;
  if (/失能|评估|照护需求/.test(t)) return '为什么需要确认？该类服务通常需要在完成照护需求或失能等级评估后，才能确定适用等级。';
  if (/年龄|周岁/.test(t)) return '为什么需要确认？年龄是多数老年人公共服务的基础门槛。';
  if (/补贴|标准|档次|费用/.test(t)) return '为什么需要确认？补贴与发放标准可能由各区确定，需要向受理单位核实本人适用的口径。';
  if (/需求|具体情况|需要|意愿/.test(t)) return '为什么需要确认？AI 只能识别生活变化的类别，具体需要哪一类服务，建议由本人或家属确认。';
  if (/住房|改造|施工|社区|街道|村居|村（居）|颐康|覆盖|App/.test(t)) return '为什么需要确认？该类服务依赖所在房屋条件与所在社区的覆盖范围，需向所在街镇或社区核实。';
  if (/健康档案|就医|诊断/.test(t)) return '为什么需要确认？健康管理服务通常以是否建档或就医诊断作为服务依据。';
  return '为什么需要确认？该条仍有尚未确认的适用条件，建议在办理前向受理单位核实。';
}

/**
 * 已答事实去重（展示层）：户籍 / 医保这类二元事实一旦由用户作答，
 * 就不再把数据库里的静态提问重复展示出来。只过滤展示，不改引擎结果。
 */
function filterAnsweredMissing(list, profile) {
  const p = profile || {};
  return (list || []).filter((x) => {
    const t = String(x || '');
    if (p.hukou !== null && p.hukou !== undefined && /户籍/.test(t)) return false;
    if (p.insurance !== null && p.insurance !== undefined && /医保|参保/.test(t)) return false;
    return true;
  });
}

/** 政策来源块（浅蓝信任区）：字段缺失就整行不显示，绝不补写 */
function sourceBlock(r) {
  const rows = [];
  if (r.source_department) rows.push(['来源部门', r.source_department]);
  if (r.source_document_no) rows.push(['政策文号', r.source_document_no]);
  if (r.source_publish_date) rows.push(['发布时间', r.source_publish_date]);
  const verifiedState = r.source_pending
    ? '来源待核验'
    : '已核验' + (r.source_checked_at ? ' · ' + r.source_checked_at : '');
  rows.push(['核验状态', verifiedState]);

  const rowsHtml = rows.map((x) => `<div class="src-row"><span class="k">${escapeHtml(x[0])}</span>`
    + `<span class="v">${escapeHtml(x[1])}</span></div>`).join('');

  return `
    <div class="rc-block is-trust">
      <div class="rc-label">政策来源</div>
      <div class="src-rows">${rowsHtml}</div>
    </div>`;
}

/**
 * 政策状态提示（有效期 / 被替代）。
 *
 * 纯展示：只读后端 derive_validity() 派生好的结果，不在前端做任何时效判断
 * （180 天 expiring 口径属于引擎职责，见 docs/policy-data-spec.md 第二节）。
 *
 * 空内容一律不生成 DOM：
 * - validity 为 null/undefined（旧数据、非三层库）→ ''
 * - level=normal 且 message 为空（政策库全部为 active 时恒为这种状态）→ ''
 * 只表达「政策状态变化提醒」，不做任何资格判断，也不承诺办理结果。
 */
function renderValidityNote(validity) {
  if (!validity) return '';
  const level = validity.level || 'normal';
  if (level !== 'warn' && level !== 'muted') return '';

  // 文案优先取后端派生结果；后端没给 message 时才用 expires_at 兜底拼一句
  let text = validity.message || '';
  if (!text && validity.expires_at) {
    text = level === 'warn'
      ? `该政策有效期至 ${validity.expires_at}，届时请以最新文件为准`
      : '该政策已过有效期，请以最新文件为准';
  }
  if (!text) return '';

  const isWarn = level === 'warn';
  const cls = isWarn ? 'policy-validity-warn' : 'policy-validity-muted';
  const label = isWarn ? '政策时效提醒' : '政策状态提醒';

  // 已被新文件替代时，明确给出替代文件，让用户有地方可去
  const sup = (validity.status === 'superseded' && validity.superseded_by) || null;
  const supHtml = sup && sup.name
    ? `<div class="pv-sub">替代文件：${escapeHtml(sup.name)}`
      + `${sup.document_no ? '（' + escapeHtml(sup.document_no) + '）' : ''}</div>`
    : '';

  return `
    <div class="rc-block ${cls}">
      <div class="rc-label">${escapeHtml(label)}</div>
      <div class="pv-text">${escapeHtml(text)}</div>
      ${supHtml}
    </div>`;
}

/**
 * 阈值提示（起付标准核对）。
 *
 * 纯展示：只读后端 threshold_signal() 算好的三态结论。
 * - threshold_signal 为 null（该政策没有起付线，如纯养老服务类政策）→ ''
 * - message 与 action 都为空 → ''
 * 红线：绝不输出阈值数值，也不做「能报多少」的承诺；后端文案已写成
 * 「具体标准请向医保部门核实」，前端原样展示即可。
 */
function renderThresholdNote(signal) {
  if (!signal) return '';

  const touched = signal.touched;
  let stateCls = 'is-unknown';
  if (touched === true) stateCls = 'is-hit';
  else if (touched === false) stateCls = 'is-below';

  const message = signal.message || '';
  const action = signal.action || '';
  if (!message && !action) return '';

  return `
    <div class="rc-block policy-threshold-note ${stateCls}">
      <div class="rc-label">个人负担金额核对</div>
      ${message ? `<div class="pt-text">${escapeHtml(message)}</div>` : ''}
      ${action ? `<div class="pt-action">${escapeHtml(action)}</div>` : ''}
    </div>`;
}

/** 轻量操作反馈 */
function showToast(msg, ms) {
  let el = document.getElementById('pfToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pfToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el.__timer);
  el.__timer = setTimeout(() => { el.hidden = true; }, ms || 1900);
}

/* ==========================================================================
   AI 发现过程
   原则：每一个 ✓ 都对应一次真实接口的返回，不使用 setTimeout 伪造进度。
   1) /api/profile 真正返回 → 打勾「识别生活信息」「分析可能涉及的服务场景」
   2) /api/match   真正返回 → 打勾「匹配公共服务政策范围」「整理可能相关权益」
   ========================================================================== */
const AI_STEPS = [
  { key: 'profile', text: '识别生活信息', short: '识别生活信息' },
  { key: 'scenes', text: '分析可能涉及的服务场景', short: '分析服务场景' },
  { key: 'scope', text: '匹配公共服务政策范围', short: '匹配政策范围' },
  { key: 'collect', text: '整理可能相关权益', short: '整理相关权益' },
];

function aiFlowItems(doneCount) {
  return AI_STEPS.map((s, i) => {
    const done = i < doneCount;
    const active = i === doneCount;
    const cls = done ? 'is-done' : (active ? 'is-active' : '');
    return `<li class="ai-step ${cls} animate-in d${i + 1}">
      <span class="ai-mark" aria-hidden="true">${done ? '✓' : ''}</span>
      <span class="ai-text">${escapeHtml(s.text)}</span>
    </li>`;
  }).join('');
}

function renderAiFlow(doneCount) {
  return `
    <div class="section">
      <div class="card ai-flow">
        <div class="ai-head">
          <span class="ai-head-title">AI 正在理解您的描述</span>
          <span class="ai-head-note">每一步都对应一次真实的匹配处理</span>
        </div>
        <ul class="ai-steps">${aiFlowItems(doneCount || 0)}</ul>
        <div class="ai-bar"><span class="ai-bar-inner" style="width:${Math.round((doneCount || 0) / AI_STEPS.length * 100)}%"></span></div>
      </div>
    </div>`;
}

/** 就地更新进度（只改列表与进度条，不重建容器，避免文档高度抖动） */
function updateAiFlow(doneCount) {
  const wrap = document.querySelector('.ai-flow');
  if (!wrap) return;
  const ul = wrap.querySelector('.ai-steps');
  if (ul) ul.innerHTML = aiFlowItems(doneCount);
  const bar = wrap.querySelector('.ai-bar-inner');
  if (bar) bar.style.width = Math.round(doneCount / AI_STEPS.length * 100) + '%';
}

/** 完成后保留一条可复核的「AI 分析依据」摘要，而不是让过程消失 */
function renderAiFlowDone() {
  return `
    <div class="ai-done-strip">
      <span class="k">AI 处理过程</span>
      ${AI_STEPS.map((s) => `<span class="i">✓ ${escapeHtml(s.short)}</span>`).join('')}
    </div>`;
}

function query(name) {
  const m = new URLSearchParams(location.search).get(name);
  return m;
}

/**
 * AI 分析依据：把「真正参与本次匹配的输入」逐条列出来。
 * 铁律：只展示用户真实提供 / 后端真实解析出的内容；
 *      没有的一律显示「未提供」，绝不推测、绝不补默认值。
 */
function analysisBasisRows(profile) {
  const selfMode = profile.mode === 'self';
  const rows = [];

  rows.push({
    ok: true,
    k: '查询方式',
    v: selfMode ? '本人为自己查询' : '家人代为查询',
  });

  rows.push({
    ok: true,
    k: '服务对象',
    v: selfMode ? '您（本人）' : (profile.who || profile.beneficiary_label || '未说明'),
  });

  // 家庭关系：本人模式没有亲属关系可言，明确说明而不是留空或编造
  const relation = selfMode ? '' : (profile.relation || '');
  rows.push({
    ok: selfMode || !!relation,
    k: '家庭关系',
    v: selfMode
      ? '本人查询，不涉及亲属关系'
      : (relation ? '受益人是您的' + relation : '未说明家庭关系'),
  });

  rows.push({
    ok: !!profile.age,
    k: '年龄',
    v: profile.age ? profile.age + ' 岁' : '未提供',
  });

  rows.push({
    ok: !!profile.region,
    k: '所在地区',
    v: profile.region || '未提供',
  });

  const scenes = profile.scenes || [];
  rows.push({
    ok: scenes.length > 0,
    k: '生活变化',
    v: scenes.length ? scenes.join('、') : '未识别到具体变化',
  });

  // 已补充确认的硬条件项：只有用户明确选过「是 / 否」才会出现
  const yn = (v) => (v === true ? '是' : (v === false ? '否' : null));
  [['hukou', '户籍情况'], ['insurance', '医保参保'], ['disability', '失能评估']]
    .forEach(function (pair) {
      const t = yn(profile[pair[0]]);
      if (t) rows.push({ ok: true, k: pair[1], v: '您已确认：' + t });
    });

  return rows;
}

/**
 * 结果页「AI 分析依据」区。
 * 保留 opts.selfMode / opts.title 等旧入参，老调用点不会报错。
 */
function renderProfileCard(profile, opts) {
  opts = opts || {};
  profile = profile || {};
  const rows = analysisBasisRows(profile);

  const html = rows.map(function (r) {
    return `<div class="basis-row ${r.ok ? 'ok' : 'todo'}">
      <span class="basis-mark" aria-hidden="true">${r.ok ? '✓' : '—'}</span>
      <span class="basis-key">${escapeHtml(r.k)}</span>
      <span class="basis-val">${escapeHtml(r.v)}</span>
    </div>`;
  }).join('');

  return `
    <div class="section">
      <h2 class="section-title">${escapeHtml(opts.title || 'AI 分析依据')}</h2>
      <div class="card basis-card">
        <p class="basis-lead">
          下面这些是本次匹配实际用到的信息。没有提供的内容不会被猜测补全，
          如果您返回补充后，这里会同步更新。
        </p>
        <div class="basis-list">${html}</div>
        <p class="basis-foot">
          AI 仅做初步范围匹配，以上内容不构成资格结论。
        </p>
      </div>
    </div>`;
}

/**
 * 结果页「发现了哪些生活场景」。
 * 类别名与服务类型全部取自结果里真实出现的字段，不做任何改写或补写。
 */
/** 类别角标：同一首字的不同类别要有区分，映射不到时退回首字 */
const SCENE_GLYPH = {
  '养老服务': '养',
  '养老保障': '保',
  '健康服务': '健',
  '医疗保障': '医',
};

function renderSceneSummary(list) {
  const groups = [];
  (list || []).forEach((r) => {
    const name = r.category || '其他公共服务';
    let g = null;
    groups.forEach((x) => { if (x.name === name) g = x; });
    if (!g) {
      g = { name: name, types: [], policies: [] };
      groups.push(g);
    }
    if (r.service_type && g.types.indexOf(r.service_type) < 0) g.types.push(r.service_type);
    g.policies.push(r.policy_name);
  });
  if (!groups.length) return '';

  const rows = groups.map((g) => {
    const shown = g.policies.slice(0, 4);
    const rest = g.policies.length - shown.length;
    const glyph = SCENE_GLYPH[g.name] || g.name.slice(0, 1);
    return `<div class="scene-row">
      <span class="scene-badge" aria-hidden="true">${escapeHtml(glyph)}</span>
      <div class="scene-main">
        <div class="scene-name">${escapeHtml(g.name)}<span class="scene-count">${g.policies.length} 项</span></div>
        ${g.types.length ? `<div class="scene-types">${escapeHtml(g.types.join(' · '))}</div>` : ''}
        <div class="scene-policies">
          ${shown.map((n) => `<span>${escapeHtml(n)}</span>`).join('')}
          ${rest > 0 ? `<span>还有 ${rest} 项</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="scene-box">
      <div class="scene-lead">AI 发现的生活场景（这是生活场景归纳，不是资格判断）：</div>
      ${rows}
    </div>`;
}

/**
 * 空状态：按画像里真正缺失的主因，显示对应那一种状态。
 * 三种状态互斥，按优先级取一种；不出现「没有资格 / 不符合」类否定表述。
 */
function renderEmptyState(data, opts) {
  opts = opts || {};
  const profile = (data && data.profile) || {};
  const selfMode = profile.mode === 'self';
  const who = selfMode ? '您' : '这位长辈';
  const region = profile.region || '';
  const scenes = profile.scenes || [];

  let state;
  if (!region || !regionMatches(region, SITE.region)) {
    // 状态1：地区不匹配
    state = {
      title: '暂未发现相关公共服务权益',
      sub: `这次只识别到所在地区「${region || '未写明'}」。本批次为${SITE.region}的试点数据，当前地区暂无对应服务数据。`,
      reasons: [
        '当前地区暂无对应服务数据',
        '可以尝试修改地区信息，或在描述里写明所在城市',
      ],
      next: `把「${SITE.regionShort} + 所在区或街道」写进描述，再点「开始发现」重新匹配`,
    };
  } else if (!profile.age || !scenes.length) {
    // 状态2：信息不足
    const lack = [];
    if (!profile.age) lack.push('年龄信息不足');
    if (!scenes.length) lack.push('身体变化描述不足');
    lack.push('家庭情况不足');
    state = {
      title: '还需要更多生活情况信息',
      sub: `已识别到所在地区为${SITE.region}，但${lack.join('、')}，AI 暂时无法据此判断可能相关的服务。`,
      reasons: lack,
      next: '补充年龄、家庭情况或具体身体变化后，重新匹配',
    };
  } else {
    // 状态3：暂无相关服务
    state = {
      title: '当前数据库中暂未发现匹配服务',
      sub: `已了解到：${profile.age} 岁 · ${region} · ${scenes.join('、')}。本批次为${SITE.region}公共服务政策的试点数据，范围仍在扩充。`,
      reasons: [
        '本批次政策范围有限，描述的变化可能暂时没有对应条目',
        '可以换一种说法描述同一件事再试',
      ],
      next: '修改描述后重新匹配，或稍后关注新增服务',
    };
  }

  const reasonHtml = state.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('');

  return `
    <div class="section">
      <div class="empty-card">
        <div class="empty-head">
          <span class="empty-mark" aria-hidden="true">○</span>
          <div class="empty-title">${escapeHtml(state.title)}</div>
        </div>
        <p class="empty-sub">${escapeHtml(state.sub)}不代表${escapeHtml(who)}一定没有可用权益。</p>
        <div class="empty-block">
          <div class="empty-block-label">可能原因</div>
          <ul class="reason-list">${reasonHtml}</ul>
        </div>
        <div class="empty-block">
          <div class="empty-block-label">下一步</div>
          <ul class="reason-list"><li>${escapeHtml(state.next)}</li></ul>
        </div>
        <div class="empty-actions">
          <button type="button" class="btn ghost" data-empty-act="edit">↑ 回去补充说明</button>
          <button type="button" class="btn ghost" data-empty-act="demo">用上面的演示案例试试</button>
        </div>
      </div>
    </div>`;
}


/** 补充信息卡：户籍 / 医保 / 失能 三值确认，点击后重新匹配并恢复滚动位置 */
function renderConfirmCard(profile) {
  profile = profile || {};
  const self = profile.mode === 'self';
  const items = [
    {
      key: 'hukou',
      label: self ? `您是否具有${SITE.region}户籍` : `老人是否具有${SITE.region}户籍`,
      why: '为什么需要确认？因为部分养老服务政策涉及户籍条件，未确认前无法判断是否适用。',
    },
    {
      key: 'insurance',
      label: self ? `您是否参加${SITE.region}社会医疗保险` : `老人是否参加${SITE.region}社会医疗保险`,
      why: '为什么需要确认？因为长期护理保险等待遇以参保情况为前提。',
    },
    {
      key: 'disability',
      label: self ? '您是否属于失能 / 部分失能' : '老人是否属于失能 / 部分失能',
      why: '为什么需要确认？因为家庭养老床位、长护险等服务需要先做照护需求或失能等级评估。',
    },
  ];
  const rows = items.map((it) => {
    const cur = profile[it.key];
    const val = cur === true ? '是' : (cur === false ? '否' : '不确定');
    const answered = cur !== null && cur !== undefined;
    return `
      <div class="role-row">
        <span class="role-key">${escapeHtml(it.label)}</span>
        <span class="role-val ${answered ? 'state-ok' : 'state-todo'}">${escapeHtml(val)}</span>
      </div>
      <p class="hint">${escapeHtml(it.why)}</p>
      <div class="btn-row" style="margin:8px 0 12px">
        <button type="button" class="btn ghost" data-confirm="${it.key}" data-value="true">是</button>
        <button type="button" class="btn ghost" data-confirm="${it.key}" data-value="false">否</button>
        <button type="button" class="btn ghost" data-confirm="${it.key}" data-value="null">不确定</button>
      </div>`;
  }).join('');

  return `
    <div class="section">
      <h2 class="section-title">AI发现部分政策需要进一步确认</h2>
      <p class="hint" style="margin:-4px 0 12px">
        为了避免遗漏可能相关的权益，建议补充以下信息。不确定也没关系，可以选择「不确定」，
        系统会按「尚未确认」处理，不会因此排除权益。
      </p>
      <div class="card">${rows}</div>
    </div>`;
}

/**
 * 查询关系条：「家庭协助」这条轴在流程中持续可见。
 * 只要是家人代查，顶部就一直挂着这条，让用户不会忘记
 * 「填信息的人 ≠ 享受权益的人」。本人模式下不显示。
 */
function renderRelationStrip() {
  const s = store.read();
  const p = s.profile || s.selfProfile;
  if (p && p.mode === 'self') return '';
  if (!s.operator && !s.beneficiary) return '';

  const op = s.operator || '未选择';
  const ben = s.beneficiary || '未选择';
  const confirmed = s.confirmed;
  const who = (p && p.who) || '';

  return `
    <div class="rel-strip ${confirmed ? 'is-ok' : ''}">
      <span class="rs-op">
        <span class="rs-k">${escapeHtml(op)}</span>
        <span class="rs-r">代为查询</span>
      </span>
      <span class="rs-arrow" aria-hidden="true">→</span>
      <span class="rs-ben">
        <span class="rs-k">${escapeHtml(ben)}${who ? '（' + escapeHtml(who) + '）' : ''}</span>
        <span class="rs-r">权益受益人</span>
      </span>
      <span class="rs-flag">${confirmed ? '✓ 已向本人核实' : '待本人确认'}</span>
    </div>`;
}

function mountRelationStrip() {
  const app = document.querySelector('.app');
  if (!app) return;
  let el = app.querySelector('.rel-strip');
  if (el) el.remove();
  const anchor = app.querySelector('.flow')
    || app.querySelector('.demo-progress')
    || app.querySelector('.demo-banner')
    || app.querySelector('.topbar');
  if (!anchor) return;
  const html = renderRelationStrip();
  if (!html) return;
  anchor.insertAdjacentHTML('afterend', html);
}

/**
 * 顶部返回：明确回到「父页面」，不依赖浏览器历史。
 *
 * 为什么不能只靠 history.back()：
 *   history.length 是整个历史栈的**总长度**，不是当前位置。用户刷新过、
 *   直接打开过链接、或者用过浏览器前进/后退之后，history.length 依然 > 1，
 *   但身后可能已无可退的记录——此时 history.back() 要么无效，要么把用户
 *   弹出站点。更糟的是一旦某个中间环节多压了一条历史，返回就会在
 *   「发现权益」和「进一步确定」之间来回弹。
 *
 * 现在每个页面在渲染顶部栏时登记自己的父页面，返回时直接跳过去，
 * 层级关系是写死的，不受历史栈状态影响：
 *   家庭协助 / 本人入口 → 发现权益 → 进一步确定（政策详情）
 *
 * 用 location.replace 而不是 location.href：返回时把当前页替换掉，
 * 历史栈深度不会增长，避免浏览器前进/后退又绕回详情页。
 */
const NAV_PARENT_PREFIX = 'pf_parent_';

/** 当前页面标识（用于按页面登记父级） */
function navPageKey() {
  const p = String(location.pathname || '').split('/').pop();
  return p || 'index.html';
}

/** 登记本页的父页面 */
function registerNavParent(parentHref) {
  try {
    sessionStorage.setItem(NAV_PARENT_PREFIX + navPageKey(), parentHref || '');
  } catch (e) { /* 隐私模式下忽略 */ }
}

/**
 * 解析本页的父页面。优先级：
 *   1) URL 上的 ?from=xxx.html（显式指定来源，便于将来新增入口）
 *   2) 进入本页时登记的父页面
 *   3) 页面自身的默认值
 */
function resolveNavParent(defaultHref) {
  try {
    const from = new URLSearchParams(location.search).get('from');
    if (from && /^[\w-]+\.html$/.test(from)) return from;
  } catch (e) { /* ignore */ }
  try {
    const v = sessionStorage.getItem(NAV_PARENT_PREFIX + navPageKey());
    if (v) return v;
  } catch (e) { /* ignore */ }
  return defaultHref || '';
}

/** 执行返回：明确跳到父页面 */
function goToParent(defaultHref) {
  const parent = resolveNavParent(defaultHref);
  // 连父页面都拿不到时（不应发生），兜底回首页，绝不把用户弹出站点
  location.replace(parent || 'index.html');
}

/** 父页面在渲染后才确定时（如详情页要先判断是否本人模式），更新顶部返回 */
function updateTopbarParent(parentHref) {
  registerNavParent(parentHref);
  const el = document.querySelector('.back-link');
  if (el) el.setAttribute('href', parentHref);
}

/** 结果位置记忆：进入详情前记下滚动位置与政策 id，返回时恢复 */
const LIST_POS_KEY = 'pf_list_pos';

/** 记住当前列表滚动位置（在点击某张结果卡进入详情前调用） */
function saveListPosition(policyId) {
  try {
    sessionStorage.setItem(LIST_POS_KEY, JSON.stringify({
      y: window.scrollY || window.pageYOffset || 0,
      id: policyId || '',
      t: Date.now(),
    }));
  } catch (e) { /* 隐私模式下忽略 */ }
}

/**
 * 读取并恢复列表位置。返回 true 表示已安排恢复。
 *
 * 关键点：不能一安排完就清掉记录。返回详情页时页面会重新走一遍
 * 异步匹配 + 重绘，真正能滚到目标高度要等列表渲染完、内容撑开之后。
 * 如果第一次 scrollTo 时文档还没那么高，浏览器会把位置夹到当前最大值，
 * 位置就丢了（实测会停在列表顶部）。所以这里多次重试，
 * 只有真正滚到目标附近才清除记录。
 */
function restoreListPosition() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(LIST_POS_KEY) || 'null');
  } catch (e) { return false; }
  if (!saved || typeof saved.y !== 'number') return false;

  // 超过 30 分钟视为陈旧数据，不再恢复，避免用户莫名跳到旧位置
  if (Date.now() - (saved.t || 0) > 30 * 60 * 1000) {
    clearListPosition();
    return false;
  }

  const targetY = saved.y;
  let done = false;

  const tryScroll = function () {
    if (done) return;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    // 列表还没撑开就等下一轮，避免被夹到顶部就以为成功了
    if (maxY < targetY - 4) return;
    window.scrollTo(0, targetY);
    const now = window.scrollY || window.pageYOffset || 0;
    if (Math.abs(now - targetY) < 40) {
      done = true;
      clearListPosition();
      if (saved.id) highlightPolicy(saved.id);
    }
  };

  // 内容渲染 → 布局稳定 → 关系条/动效结束，逐轮重试
  requestAnimationFrame(tryScroll);
  [80, 200, 400, 700, 1100, 1600, 2400].forEach(function (ms) {
    setTimeout(tryScroll, ms);
  });
  // 兜底：足够久之后无论如何都放行，避免记录永久残留
  setTimeout(function () {
    if (!done) {
      window.scrollTo(0, targetY);
      clearListPosition();
      if (saved.id) highlightPolicy(saved.id);
    }
  }, 3000);

  return true;
}

function clearListPosition() {
  try { sessionStorage.removeItem(LIST_POS_KEY); } catch (e) { /* ignore */ }
}

/** 对刚查看过的政策做短暂视觉提示，帮用户确认「就是这条」 */
function highlightPolicy(policyId) {
  const card = document.querySelector('.result-card[data-id="' + CSS.escape(policyId) + '"]');
  if (!card) return;
  card.classList.add('is-just-viewed');
  // 展开时可能被其他元素遮住，短暂聚焦即可
  setTimeout(function () { card.classList.remove('is-just-viewed'); }, 2600);
}

/* ================================================================
   带着「刚才查看的那条政策」返回
   ----------------------------------------------------------------
   场景：在详情页点「回去调整生活变化 / 回去补充关键条件」→ 回到发现权益
   → 改完条件自动重新匹配 → 结果顺序可能全变了，刚才那条要重新找。

   与上面的「恢复滚动位置」是两件事：
     恢复滚动位置 —— 位置没变，把视口挪回去；
     本机制        —— 结果已经变了，按 policy_id 在**新结果**里重新定位。

   约定：
     · 唯一标识只用 policy_id，不用政策标题（标题可能重复/改写）；
     · 详情页进入时记录当前 id + 名称；
     · 只有点「回去调整」才通过 ?back=<policy_id> 触发定位；
       顶部返回不带这个参数，因此原有返回行为完全不变。
   ================================================================ */
const RETURN_KEY = 'pf_return_policy';
const RETURN_MAX_AGE = 30 * 60 * 1000;

/** 进入政策详情时记录：当前政策 id（唯一标识）+ 名称（仅用于提示文案） */
function saveReturnPolicy(policyId, policyName) {
  if (!policyId) return;
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({
      id: policyId,
      name: policyName || '',
      t: Date.now(),
    }));
  } catch (e) { /* 隐私模式下忽略 */ }
}

function readReturnPolicy() {
  try {
    const v = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null');
    if (!v || !v.id) return null;
    if (Date.now() - (v.t || 0) > RETURN_MAX_AGE) {
      sessionStorage.removeItem(RETURN_KEY);
      return null;
    }
    return v;
  } catch (e) { return null; }
}

/**
 * 接住详情页带回的 ?back=<policy_id>。
 * 读完立刻把参数从地址栏去掉：刷新后不会重复提示，
 * 也不会把内部参数留在可分享的链接里。
 */
function consumeReturnParam() {
  try {
    const pid = new URLSearchParams(location.search).get('back');
    if (!pid) return '';
    const u = new URL(location.href);
    u.searchParams.delete('back');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    return pid;
  } catch (e) { return ''; }
}

function removeReturnBar() {
  document.querySelectorAll('[data-return-bar]').forEach((el) => el.remove());
}

function returnBarHtml(o) {
  if (o.gone) {
    return `
      <div class="return-bar is-gone" data-return-bar role="status">
        <div class="rb-icon" aria-hidden="true">○</div>
        <div class="rb-main">
          <div class="rb-title">调整后，这项政策暂未继续匹配</div>
          <div class="rb-sub">${escapeHtml(o.sub || '')}</div>
        </div>
      </div>`;
  }
  return `
    <div class="return-bar" data-return-bar role="status">
      <div class="rb-icon" aria-hidden="true">↩</div>
      <div class="rb-main">
        <div class="rb-title">你刚才查看的是这项政策</div>
        <div class="rb-sub">${escapeHtml(o.name || '')}</div>
      </div>
      <button type="button" class="rb-go" data-return-go="${escapeHtml(o.pid)}">继续查看 →</button>
    </div>`;
}

/** 提示条上的「继续查看」：与点卡片进详情走同一条路 */
function bindReturnBar() {
  const bar = document.querySelector('[data-return-bar]');
  if (!bar) return;
  const go = bar.querySelector('[data-return-go]');
  if (!go) return;
  go.addEventListener('click', (e) => {
    e.stopPropagation();
    const pid = go.dataset.returnGo;
    saveListPosition(pid);          // 返回时仍能回到这个位置
    location.href = 'policy.html?id=' + encodeURIComponent(pid);
  });
}

/** 卡片落在折叠区里时展开折叠区，否则滚不过去。
    只改视觉展开、不写 sessionStorage，避免改变用户自己的折叠偏好。 */
function openMoreGroupIfNeeded(card) {
  if (!card || !card.closest('[data-more-body]')) return;
  const btn = document.getElementById('moreToggle');
  if (!btn || btn.getAttribute('aria-expanded') === 'true') return;
  applyMoreExpanded(true);
}

function scrollToReturnCard(pid) {
  const card = document.querySelector('.result-card[data-id="' + CSS.escape(pid) + '"]');
  if (!card) return;
  highlightPolicy(pid);
  // 折叠区展开有过渡动画，高度要等一会儿才稳定，多试几轮。
  // 用瞬时 scrollTo 而不是 smooth：列表刚整体重建，本就已经换了内容，
  // 平滑滚动在这里只会拖慢定位（且与 restoreListPosition 的既有做法保持一致）。
  const tryScroll = function () {
    const top = card.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo(0, Math.max(0, top));
  };
  requestAnimationFrame(tryScroll);
  [140, 360, 700, 1200].forEach(function (ms) { setTimeout(tryScroll, ms); });
}

/**
 * 在**新结果**里定位刚才查看的那条政策。
 *
 * results  本次匹配结果
 * opts.pid 要定位的 policy_id（空则不做任何事）
 * opts.scroll  true 时滚动过去（重新匹配完成后用）；
 *              false 时只插提示条 + 高亮，把视口让给「调整条件」区块
 *
 * 返回 true 表示「由我接管了滚动」：调用方据此跳过自己的 restorePosition，
 * 否则两处会互相覆盖（实测会把视口拽回被点的按钮，定位失效）。
 */
function applyReturnPolicy(results, opts) {
  opts = opts || {};
  const pid = opts.pid;
  if (!pid) return false;
  const list = results || [];
  const stored = readReturnPolicy();
  const name = (stored && stored.id === pid) ? stored.name : '';
  const row = list.filter((r) => r.policy_id === pid)[0] || null;

  removeReturnBar();

  if (!row) {
    // 调整后不再匹配：不强行跳转，只说明一句，正常展示新结果。
    // name 只用于让用户确认「是哪一条」，不影响任何匹配与展示逻辑。
    const sub = (name ? name + ' 已不在本次结果中。' : '')
      + (list.length ? '下面是按新情况重新匹配的结果。' : '可以先补充更多情况再匹配一次。');
    const html = returnBarHtml({ gone: true, sub: sub });
    const anchor = document.getElementById('resultAnchor')
      || document.querySelector('.tier-groups');
    if (anchor) anchor.insertAdjacentHTML('afterend', html);
    else {
      const area = document.getElementById('resultArea');
      if (area) area.insertAdjacentHTML('afterbegin', html);
    }
    return false;   // 没定位到就保持原有行为，用户仍停在刚才操作的区块
  }

  const card = document.querySelector('.result-card[data-id="' + CSS.escape(pid) + '"]');
  openMoreGroupIfNeeded(card);

  const html = returnBarHtml({ gone: false, pid: pid, name: name });
  if (card) card.insertAdjacentHTML('beforebegin', html);
  else {
    const anchor = document.getElementById('resultAnchor');
    if (anchor) anchor.insertAdjacentHTML('afterend', html);
  }
  bindReturnBar();

  if (opts.scroll) {
    scrollToReturnCard(pid);
    return true;
  }
  highlightPolicy(pid);
  return false;
}

/**
 * 全局流程指示器：四阶段，让用户始终知道自己在哪一步、下一步是什么。
 *
 * 1 确认情况 —— 描述发生了什么，并核对 AI 的理解
 * 2 发现可能相关政策 —— AI 给出「可能相关」的权益清单
 * 3 查看政策依据 —— 条件、来源、办理方式
 * 4 进一步确认 —— 补信息、核实、决定是否去办
 *
 * 与 demo 模式的 mountDemoProgress 不同：这个在正常使用时也始终显示，
 * 是产品的骨架流程，不是演示装饰。
 */
const FLOW_STAGES = [
  { n: 1, key: 'confirm', label: '确认情况', hint: '描述并核对' },
  { n: 2, key: 'discover', label: '发现权益', hint: 'AI 初步匹配' },
  { n: 3, key: 'basis', label: '查看依据', hint: '条件与来源' },
  { n: 4, key: 'verify', label: '进一步确认', hint: '核实与决定' },
];

function renderFlow(current) {
  const steps = FLOW_STAGES.map((s) => {
    const cls = s.n < current ? 'is-done' : (s.n === current ? 'is-active' : '');
    const mark = s.n < current ? '✓' : String(s.n);
    return `<li class="flow-step ${cls}">
      <span class="flow-dot" aria-hidden="true">${mark}</span>
      <span class="flow-text">
        <span class="flow-label">${escapeHtml(s.label)}</span>
        <span class="flow-hint">${escapeHtml(s.hint)}</span>
      </span>
    </li>`;
  }).join('');

  return `
    <nav class="flow" aria-label="使用流程">
      <ol class="flow-steps">${steps}</ol>
    </nav>`;
}

/** 挂载流程指示器。current: 1..4 */
function mountFlow(current) {
  const app = document.querySelector('.app');
  if (!app) return;
  let el = app.querySelector('.flow');
  if (el) el.remove();
  const anchor = app.querySelector('.demo-progress')
    || app.querySelector('.demo-banner')
    || app.querySelector('.topbar');
  if (!anchor) return;
  anchor.insertAdjacentHTML('afterend', renderFlow(current));
}

/**
 * 情况确认台（本轮核心交互）
 * ---------------------------------------------------------------
 * 把「AI 到底认出了什么」变成用户可见、可点击、可纠正的东西。
 * 这是人机协同的关键动作：AI 给建议，用户确认或纠正，重新匹配。
 *
 * 三段结构：
 *   1. 基础事实（年龄 / 地区）—— 直接来自用户描述，只读展示
 *   2. 生活事件 —— 可增删的 chip，用户纠正 AI 的场景识别
 *   3. 关键条件（户籍 / 医保 / 失能）—— 三值确认，沿用原有 data-confirm 协议
 *
 * 铁律：chip 的选中态完全由 profile.scenes 决定；
 *      未识别的事件只显示「可能相关 N 项权益方向」，不暗示用户一定有该需求。
 */
function renderSituationBoard(profile, sceneLibrary, opts) {
  opts = opts || {};
  profile = profile || {};
  const self = profile.mode === 'self';
  const who = self ? '您' : (profile.beneficiary_label ? '这位长辈' : '老人');
  const lib = sceneLibrary || [];
  const scenes = profile.scenes || [];
  const detected = lib.filter((x) => x.detected || scenes.indexOf(x.name) >= 0);
  const optional = lib.filter((x) => !detected.some((d) => d.name === x.name));

  // ---- 1. 基础事实
  const facts = [
    { k: '年龄', v: profile.age ? profile.age + ' 岁' : '', ok: !!profile.age },
    { k: '所在地区', v: profile.region || '', ok: !!profile.region },
    {
      k: '查询关系',
      v: self ? '本人为自己查询' : (profile.who || '家人代为查询'),
      ok: true,
    },
  ];
  const factsHtml = facts.map((f) => `
    <div class="board-fact ${f.ok ? 'ok' : 'todo'}">
      <span class="bf-mark" aria-hidden="true">${f.ok ? '✓' : '—'}</span>
      <span class="bf-k">${escapeHtml(f.k)}</span>
      <span class="bf-v">${escapeHtml(f.v || '未提供')}</span>
    </div>`).join('');

  // ---- 2. 生活事件
  const chips = (list, kind) => list.map((x) => `
    <button type="button" class="scene-chip ${kind === 'on' ? 'is-on' : ''}"
            data-scene="${escapeHtml(x.name)}" data-on="${kind === 'on' ? '1' : '0'}"
            aria-pressed="${kind === 'on' ? 'true' : 'false'}">
      <span class="sc-name">${escapeHtml(x.name)}</span>
      <span class="sc-plain">${escapeHtml(x.plain)}</span>
      ${x.related_count ? `<span class="sc-rel">关联 ${x.related_count} 项权益方向</span>` : ''}
    </button>`).join('');

  const sceneBlock = lib.length ? `
    <div class="board-sec">
      <div class="board-sec-head">
        <span class="board-sec-t">AI 识别到的生活变化</span>
        <span class="board-sec-n">${detected.length} 项</span>
      </div>
      <p class="board-sec-tip">
        这些是 AI 从您的描述里读到的。请核对一下：认错了就点掉，漏了就在下面补上——
        您的确认会直接改变匹配结果。
      </p>
      ${profile.scenes_edited ? '<p class="board-edited">已按您的确认调整过，下面是调整后的情况。</p>' : ''}
      <div class="scene-chips is-on">${chips(detected, 'on')}</div>
      ${optional.length ? `
        <div class="board-sub">可能还有这些情况，如果符合请点一下</div>
        <div class="scene-chips">${chips(optional.slice(0, 10), 'off')}</div>` : ''}
    </div>` : '';

  // ---- 3. 关键条件（三值，沿用 data-confirm 协议）
  const items = [
    {
      key: 'hukou',
      label: self ? `您是否具有${SITE.region}户籍` : `老人是否具有${SITE.region}户籍`,
      why: '部分养老服务政策以户籍为准，未确认前无法判断是否适用。',
    },
    {
      key: 'insurance',
      label: self ? `您是否参加${SITE.region}社会医疗保险` : `老人是否参加${SITE.region}社会医疗保险`,
      why: '长期护理保险等待遇以是否参保为前提。',
    },
    {
      key: 'disability',
      label: self ? '您是否属于失能 / 部分失能' : '老人是否属于失能 / 部分失能',
      why: '家庭养老床位、长护险等服务需要先做照护需求或失能等级评估。',
    },
  ];
  const condHtml = items.map((it) => {
    const cur = profile[it.key];
    const answered = cur !== null && cur !== undefined;
    const val = cur === true ? '是' : (cur === false ? '否' : '不确定');
    return `
      <div class="board-cond">
        <div class="bc-top">
          <span class="bc-label">${escapeHtml(it.label)}</span>
          <span class="bc-state ${answered ? 'is-ok' : 'is-todo'}">${escapeHtml(val)}</span>
        </div>
        <div class="bc-why">${escapeHtml(it.why)}</div>
        <div class="btn-row bc-btns">
          <button type="button" class="btn ghost sm ${cur === true ? 'is-picked' : ''}"
                  data-confirm="${it.key}" data-value="true">是</button>
          <button type="button" class="btn ghost sm ${cur === false ? 'is-picked' : ''}"
                  data-confirm="${it.key}" data-value="false">否</button>
          <button type="button" class="btn ghost sm ${cur === null || cur === undefined ? 'is-picked' : ''}"
                  data-confirm="${it.key}" data-value="null">不确定</button>
        </div>
      </div>`;
  }).join('');

  const noneHint = !profile.age && !scenes.length
    ? '<p class="board-warn">还没有识别到具体信息。请回到上一步，用一句话描述年龄、地区和最近的变化。</p>'
    : '';

  return `
    <div class="section">
      <h2 class="section-title">${escapeHtml(opts.title || '第一步：确认情况')}</h2>
      <p class="hint" style="margin:-4px 0 10px">
        这一步是整件事的地基。AI 先读一遍您描述的情况，再由您核对——
        家属代为填写也不等于${escapeHtml(who)}本人已确认。
      </p>
      ${noneHint}
      <div class="card board">
        <div class="board-sec">
          <div class="board-sec-head">
            <span class="board-sec-t">基础事实</span>
            <span class="board-sec-n">来自您的描述</span>
          </div>
          <div class="board-facts">${factsHtml}</div>
        </div>
        ${sceneBlock}
        <div class="board-sec">
          <div class="board-sec-head">
            <span class="board-sec-t">需要您确认的关键条件</span>
            <span class="board-sec-n">选「不确定」也可以</span>
          </div>
          <p class="board-sec-tip">
            这些 AI 无法替您判断。不确定不会被当成「不符合」，只会继续标为待确认。
          </p>
          <div class="board-conds">${condHtml}</div>
        </div>
      </div>
      ${opts.footer || ''}
    </div>`;
}

/**
 * 证据链渲染：三段式，回答「凭什么推荐这条」。
 *   ① 依据什么  —— 用户提供的年龄/地区 + 命中的生活事件
 *   ② 要求什么  —— 该政策��结构化条件，逐条标注 met / unknown / failed
 *   ③ 出自哪里  —— 责任部门 + 文件名 + 文号 + 发布日期 + 核验状态
 *
 * 数据全部来自后端 evidence 字段（由 policy_engine 从数据库原字段派生），
 * 本函数只做展示，不新增任何判断，也不改写政策表述。
 */
function renderEvidenceChain(ev, opts) {
  opts = opts || {};
  if (!ev) return '';
  const self = opts.selfMode;

  // ① 画像依据
  const basis = (ev.profile_basis || []).map((b) => `
    <li class="ev-item">
      <span class="ev-tag">${escapeHtml(b.label)}</span>
      <span class="ev-txt">${escapeHtml(b.text)}</span>
    </li>`).join('');

  // ② 政策条件：三值状态各有措辞，绝不出现「符合资格」
  const STATE_TEXT = {
    met: { cls: 'met', label: '已确认' },
    unknown: { cls: 'unknown', label: '待确认' },
    failed: { cls: 'failed', label: '已确认不符合' },
  };
  const conds = (ev.policy_conditions || []).map((c) => {
    const st = STATE_TEXT[c.state] || STATE_TEXT.unknown;
    return `<li class="ev-cond ${st.cls}">
      <div class="ec-top">
        <span class="ec-req">${escapeHtml(c.label)}：${escapeHtml(c.requirement)}</span>
        <span class="ec-state">${escapeHtml(st.label)}</span>
      </div>
      <div class="ec-ev">${escapeHtml(c.evidence)}</div>
    </li>`;
  }).join('');

  // ③ 官方依据
  const cit = ev.citation || {};
  const citRows = [];
  if (cit.department) citRows.push(['责任部门', cit.department]);
  if (cit.document) citRows.push(['政策文件', cit.document]);
  if (cit.document_no) citRows.push(['文号', cit.document_no]);
  if (cit.publish_date) citRows.push(['发布时间', cit.publish_date]);
  const citHtml = citRows.length
    ? `<div class="ev-cite-rows">${citRows.map((r) => `
        <div class="ecr"><span class="k">${escapeHtml(r[0])}</span><span class="v">${escapeHtml(r[1])}</span></div>`).join('')}</div>`
    : '<p class="ev-none">尚未核到一手文件，暂不列出来源信息，避免指向错误出处。</p>';
  const citBadge = cit.verified
    ? '<span class="badge verified">✓ 已核验</span>'
    : '<span class="badge pending">来源待核验</span>';

  const pending = ev.pending_count || 0;

  return `
    <div class="evidence">
      <div class="ev-head">
        <span class="ev-title">为什么是这一条 · 证据链</span>
        ${pending ? `<span class="ev-pending">${pending} 项条件待确认</span>` : ''}
      </div>

      <div class="ev-step">
        <div class="ev-step-t"><span class="ev-num">1</span>依据什么（来自您的描述）</div>
        ${basis ? `<ul class="ev-list">${basis}</ul>`
                : '<p class="ev-none">本次没有从描述中提取到可用事实。</p>'}
      </div>

      <div class="ev-step">
        <div class="ev-step-t"><span class="ev-num">2</span>这条权益要求什么</div>
        ${conds ? `<ul class="ev-conds">${conds}</ul>`
                : '<p class="ev-none">该条目未设置结构化条件，请在详情页查看政策原文表述。</p>'}
      </div>

      <div class="ev-step is-trust">
        <div class="ev-step-t"><span class="ev-num">3</span>出自哪里（官方依据）</div>
        <div class="ev-cite">
          <div class="ev-cite-top">${citBadge}</div>
          ${citHtml}
        </div>
      </div>
    </div>`;
}

/**
 * 结果卡：第七阶段改为「优先关注 N 项 + 其他可能相关 N 项（默认折叠）」。
 *
 * 分组口径（只改展示，不改匹配）：
 *   引擎仍按老口径给出 tier（强相关 / 可能相关 / 待确认），分组依据不变；
 *   这里只把「强相关」这一档在界面上换成中性说法「优先关注」，
 *   并把剩下两档合并成可折叠的「其他可能相关」。
 *   单卡状态徽章（可能相关 / 待确认 / 已核验 / 来源待核验）原样保留。
 *
 * 措辞红线：不用「最符合」「强相关」「已符合资格」。
 */
function renderResultCards(data, opts) {
  opts = opts || {};
  const list = data.results || [];
  if (!list.length) {
    return renderEmptyState(data, opts);
  }

  const profile = data.profile || {};

  const oneCard = (r) => {
    const meta = [r.category, r.service_type, r.region].filter(Boolean).map(escapeHtml).join(' · ');
    const reasons = (r.ai_reason || [])
      .map((x) => `<li>${escapeHtml(personalize(x, profile))}</li>`).join('');

    const missing = filterAnsweredMissing(r.missing_information, profile);
    const shown = missing.slice(0, 2);
    const rest = missing.length - shown.length;
    const missingHtml = missing.length ? `
      <div class="rc-block is-warm">
        <div class="rc-label">还需确认</div>
        <ul class="missing-list">
          ${shown.map((x) => {
            const t = personalize(x, profile);
            return `<li>
              <div class="mi-q">${escapeHtml(t)}</div>
              <div class="mi-why">${escapeHtml(explainMissing(t))}</div>
            </li>`;
          }).join('')}
          ${rest > 0 ? `<li class="mi-more">另有 ${rest} 项待确认内容，进入详情查看</li>` : ''}
        </ul>
      </div>` : '';

    // 分组标题已经说明了「优先关注 / 其他可能相关」，
    // 单卡再挂一条分层色条属于重复信息，这里去掉以减轻信息密度。
    return `
      <article class="result-card" data-id="${escapeHtml(r.policy_id)}" tabindex="0" role="button">
        <div class="result-head">
          <div class="result-head-main">
            <h3 class="result-name">${escapeHtml(r.policy_name)}</h3>
            <p class="result-meta">${meta}</p>
          </div>
          <div class="result-badges">${statusBadge(r.status, r.source_pending)}</div>
        </div>

        ${renderValidityNote(r.validity)}
        ${renderThresholdNote(r.threshold_signal)}

        <div class="rc-block">
          <div class="rc-label">为什么推荐</div>
          <ul class="reason-list">${reasons || '<li>暂无可用于判断的具体情况，建议补充描述后重新匹配。</li>'}</ul>
        </div>

        ${missingHtml}
        ${sourceBlock(r)}

        <button type="button" class="ev-toggle" data-ev-toggle="${escapeHtml(r.policy_id)}"
                aria-expanded="false">看证据链（依据什么 · 要求什么 · 出自哪里）</button>
        <div class="ev-slot" data-ev-slot="${escapeHtml(r.policy_id)}" hidden></div>

        <div class="result-foot">查看详情与办理方式 <span class="arrow">→</span></div>
      </article>`;
  };

  // 分组：引擎的「强相关」档展示为「优先关注」，其余两档合并为「其他可能相关」
  const focus = list.filter((r) => r.tier === '强相关');
  const others = list.filter((r) => r.tier !== '强相关');

  const focusHtml = focus.length
    ? `<div class="tier-head is-focus">
         <span class="th-name">优先关注</span>
         <span class="th-count">${focus.length} 项</span>
         <span class="th-desc">AI 从您的描述中识别到了对应的生活变化，建议先了解这几项</span>
       </div>
       <div class="tier-items">${focus.map(oneCard).join('')}</div>`
    : '';

  // 折叠区：默认收起，展开状态由 bindResultGroups 恢复
  const othersHtml = others.length
    ? `<div class="more-group" data-more-group>
         <button type="button" class="more-toggle" id="moreToggle"
                 aria-expanded="false" aria-controls="moreItems">
           <span class="mt-label">其他可能相关 ${others.length} 项</span>
           <span class="mt-arrow" aria-hidden="true">⌄</span>
         </button>
         <div class="more-body" id="moreItems" data-more-body>
           <div class="more-inner">
             <p class="more-tip">这些项目前缺少关键信息或仅有年龄等基础线索，是否适用还需进一步确认。</p>
             <div class="tier-items">${others.map(oneCard).join('')}</div>
           </div>
         </div>
       </div>`
    : '';

  const focusCount = focus.length;
  const summary = focusCount
    ? `建议优先了解其中 ${focusCount} 项`
    : '暂未识别到优先关注项，以下均需进一步确认';

  // 生活场景归纳保留，但放到结果列表之后：
  // 它与「优先关注 / 其他可能相关」是同一批信息的两种归纳，
  // 放在列表前面会把重点卡片挤出首屏。功能未删，只是换了位置。
  return `
    <div class="section">
      <h2 class="section-title" id="resultAnchor">共发现 ${list.length} 项可能相关权益</h2>
      ${renderAiFlowDone()}
      <p class="result-summary">${escapeHtml(summary)}</p>
      <p class="hint" style="margin:-4px 0 10px">
        以下均为「可能相关」的初步匹配结果，不代表已符合资格，建议逐项确认后再办理。
      </p>
      <div class="notice">${escapeHtml(data.notice || '')}</div>
      <div class="tier-groups">${focusHtml}${othersHtml}</div>
      ${renderSceneSummary(list)}
    </div>`;
}

/**
 * 折叠区交互：默认收起，点击展开/收起。
 * 高度由 JS 按真实内容测量后写进 max-height —— 不依赖 CSS 对 auto 高度
 * 的解析，保证任何环境下都能真正展开（收起高度由 CSS 的 max-height:0 兜底）。
 * 展开状态写入 sessionStorage：从详情页返回时列表会整体重建，
 * 不记住状态会让用户刚展开的内容又折起来，滚动位置也会对不上。
 */
const MORE_EXPAND_KEY = 'pf_more_expanded';

function isMoreExpanded() {
  try { return sessionStorage.getItem(MORE_EXPAND_KEY) === '1'; } catch (e) { return false; }
}

function setMoreExpanded(on) {
  try {
    if (on) sessionStorage.setItem(MORE_EXPAND_KEY, '1');
    else sessionStorage.removeItem(MORE_EXPAND_KEY);
  } catch (e) { /* 隐私模式下忽略 */ }
}

function applyMoreExpanded(on) {
  const group = document.querySelector('[data-more-group]');
  const btn = document.getElementById('moreToggle');
  const body = document.querySelector('[data-more-body]');
  const inner = document.querySelector('.more-inner');
  if (!group || !btn || !body) return;

  group.classList.toggle('is-open', !!on);
  btn.setAttribute('aria-expanded', on ? 'true' : 'false');

  if (on) {
    // 先放开高度限制量出真实内容高度，再写回具体值供 max-height 过渡
    body.style.maxHeight = 'none';
    const h = inner ? inner.scrollHeight : 0;
    body.style.maxHeight = (h || 400) + 'px';
  } else {
    // 先固定为当前高度，再强制回流让浏览器认到该高度，最后压到 0。
    // 这里不用 requestAnimationFrame：后台标签页/无头环境下 rAF 可能不触发，
    // 一旦不触发折叠就永远收不起来（实测踩过）。
    body.style.maxHeight = body.scrollHeight + 'px';
    void body.offsetHeight;      // 强制同步回流
    body.style.maxHeight = '0px';
  }
}

function bindResultGroups() {
  const btn = document.getElementById('moreToggle');
  if (!btn) return;
  if (btn.__bound) return;
  btn.__bound = true;
  applyMoreExpanded(isMoreExpanded());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = btn.getAttribute('aria-expanded') === 'true';
    setMoreExpanded(!open);
    applyMoreExpanded(!open);
  });
}

/**
 * 绑定「情况确认台」上的生活事件 chip。
 * 每次点击都把最新的 scenes 以 confirmed_scenes 提交，由后端 replace 语义覆盖，
 * 实现「用户纠正 AI」—— 这是本轮人机协同的核心闭环。
 */
function bindSceneChips(currentData, onChange) {
  const base = (currentData && currentData.profile) || {};
  document.querySelectorAll('[data-scene]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.scene;
      const on = btn.dataset.on === '1';
      const next = on
        ? (base.scenes || []).filter((s) => s !== name)
        : (base.scenes || []).concat([name]);
      const unique = Array.from(new Set(next));
      if (onChange) onChange(unique);
    });
  });
}

/**
 * 绑定结果卡上的「看证据链」展开按钮。
 * 展开时按需渲染（懒渲染），避免一次性渲染 10 张卡的证据链拖慢首屏。
 */
function bindEvidenceToggles(resultsById) {
  document.querySelectorAll('[data-ev-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();       // 展开不等于跳详情
      const id = btn.dataset.evToggle;
      const slot = document.querySelector('[data-ev-slot="' + CSS.escape(id) + '"]');
      if (!slot) return;
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        slot.hidden = true;
        slot.innerHTML = '';
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '看证据链（依据什么 · 要求什么 · 出自哪里）';
        return;
      }
      const r = (resultsById || {})[id];
      if (!r) return;
      slot.innerHTML = renderEvidenceChain(r.evidence, {
        selfMode: r.__selfMode,
      });
      slot.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.textContent = '收起证据链';
    });
  });
}

/** 顶部返回条：parentHref 是本页的父页面，点击后明确跳回该页 */
function renderTopbar(title, parentHref, sub) {
  const el = document.querySelector('.topbar');
  if (!el) return;
  const tag = sub ? `<span class="theme-tag">${escapeHtml(sub)}</span>` : '';
  let back = '';
  if (parentHref) {
    // href 保留：既是无 JS / 中键新窗口的兜底，也让父页面关系可被查看
    back = `<a class="back-link" href="${escapeHtml(parentHref)}" data-back="1">← 返回</a>`;
  }
  el.innerHTML = `
    <div class="brand-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">政策找人 · AI赋能公共服务权益发现</div>
      </div>
      ${tag}
    </div>
    <div style="margin-top:10px">${back}</div>`;

  // 登记本页父页面（返回时按它跳转，不看浏览器历史）
  registerNavParent(parentHref);

  const backEl = el.querySelector('[data-back]');
  if (backEl) {
    backEl.addEventListener('click', function (e) {
      e.preventDefault();
      goToParent(parentHref);
    });
  }
}
