/**
 * 《政策找人》前端公共脚本
 * - 接口封装（同源 /api）
 * - 会话状态（sessionStorage）：帮助对象、操作者、受益人、画像
 * - 状态徽章与文案渲染
 */

const API = {
  /**
   * 统一取回响应体。
   *
   * 非 2xx 必须抛错，不能把错误对象当成功结果往下传——
   * 后端出错时返回的是 {"error": ...}，若直接 res.json() 交给调用方，
   * 界面会渲染成「0 条结果」或空白，用户看到的是「查过了，没有适合的」，
   * 而真实情况是这次查询根本没成功。那是把失败伪装成成功。
   */
  async _read(res) {
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // 响应不是 JSON（例如网关返回的 HTML 错误页）
      const err = new Error('服务返回的内容无法解析');
      err.status = res.status;
      throw err;
    }
    if (!res.ok) {
      const detail = (data && (data.detail || data.error)) || ('HTTP ' + res.status);
      const err = new Error(detail);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },
  async get(path) {
    const res = await fetch(path);
    return API._read(res);
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return API._read(res);
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

let _sitePromise = null;

/**
 * 读取站点上下文，同一页面内只请求一次。失败不抛错，用默认值兜底。
 * 城市取自政策库里每条政策的 region 字段（政策库是该事实的唯一来源，
 * 前端不做任何名称映射兜底）。政策库若缺该字段，页面退回默认值，
 * 同时说明数据层有缺口——这是有意为之，不掩盖。
 */
function loadSiteContext() {
  if (_sitePromise) return _sitePromise;
  _sitePromise = (async () => {
    try {
      const d = await API.get('/api/policies');
      const list = d.policies || [];
      SITE.policyCount = d.total || list.length;
      // 取政策库里出现次数最多的地区，作为本站点覆盖城市
      const counts = {};
      list.forEach((p) => {
        if (p.region) counts[p.region] = (counts[p.region] || 0) + 1;
      });
      const region = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      if (region) {
        SITE.region = region;
        SITE.regionShort = String(region).replace(/市$/, '');
      }
    } catch (e) {
      // 接口不可用：保持默认值，不阻塞页面
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
  const app = document.querySelector('.app');
  if (!app) return;
  const shown = app.querySelector('.demo-banner');
  if (!store.read().demoBanner) {
    // 演示过之后又做了真实查询：横幅必须跟着撤掉，
    // 否则用户会把自己的真实结果当成「虚拟案例」。
    if (shown) shown.remove();
    return;
  }
  const tb = app.querySelector('.topbar');
  if (!tb) return;
  if (shown) return;
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

/**
 * 两个判断维度分开呈现（P7-A）。
 *
 * 「可能相关」是**匹配层**结论：AI 读你描述后觉得可能适用；
 * 「已核验」是**来源层**结论：政策原文是否已核对到一手文件。
 * 两者不是一个维度，以前用两个同款药丸并排，读起来像「这条已经审核通过了」。
 * 现在：各带维度名、上下排列、视觉形态不同（匹配=实心浅底药丸，来源=无底色的方点短句），
 * 任何一层的措辞都不构成「已符合资格」。
 */
function renderAxes(status, sourcePending) {
  const m = String(status == null ? '' : status).trim() || '可能相关';
  const mCls = m === '待确认' ? 'is-confirm' : 'is-maybe';
  const sCls = sourcePending ? 'is-pending' : 'is-verified';
  const sText = sourcePending ? '待核验' : '已核验';
  const sMark = sourcePending ? '' : '✓ ';
  return `<div class="axes" role="group" aria-label="两个独立判断维度：匹配结论与来源核验">
      <div class="axis is-match">
        <span class="axis-k">匹配</span>
        <span class="axis-v ${mCls}">${escapeHtml(m)}</span>
      </div>
      <div class="axis is-source">
        <span class="axis-k">来源</span>
        <span class="axis-v ${sCls}">${sMark}${sText}</span>
      </div>
    </div>`;
}

/** 旧名兼容：语义上等价于 renderAxes（两个维度分开渲染），新代码请直接用 renderAxes */
function statusBadge(status, sourcePending) {
  return renderAxes(status, sourcePending);
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
  // 行名点明这是「来源」维度，与卡片上方的「匹配」维度区分开
  rows.push(['来源核验', verifiedState]);

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
   局部刷新的「进行中」状态
   场景：用户点确认台的「是 / 否 / 不确定」或增删生活事件后，结果区要重新匹配。
   这段时间结果区仍显示上一次的内容——必须让用户知道两件事：
     1) 你的输入已经收到了
     2) 下方看到的还是旧的
   否则用户会对着过期结果做判断。

   实现：固定定位的窄条，不参与文档流，因此不改变页面高度，
   不会干扰「局部刷新锁高」与「返回后恢复滚动位置」两套既有逻辑。
   形态是机械式的进行中提示（一条细进度线），不是聊天式思考动画。
   ========================================================================== */
function refreshBarHtml(title) {
  return `<div class="refresh-bar" id="pfRefreshBar" role="status" aria-live="polite">
    <span class="refresh-line" aria-hidden="true"></span>
    <div class="refresh-text">
      <span class="refresh-title">${escapeHtml(title)}</span>
      <span class="refresh-sub">下方仍是上一次结果，更新后会自动替换</span>
    </div>
  </div>`;
}

/** 显示进行中窄条。title 说明这次收到了什么。 */
function showRefreshBar(title) {
  hideRefreshBar();
  document.body.insertAdjacentHTML('beforeend',
    refreshBarHtml(title || '正在更新匹配结果'));
}

function hideRefreshBar() {
  const el = document.getElementById('pfRefreshBar');
  if (el) el.remove();
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
          <button type="button" class="btn ghost" data-empty-act="edit">↑ 返回补充说明</button>
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
   场景：在详情页点「返回调整生活变化 / 返回补充关键条件」→ 回到发现权益
   → 改完条件自动重新匹配 → 结果顺序可能全变了，刚才那条要重新找。

   与上面的「恢复滚动位置」是两件事：
     恢复滚动位置 —— 位置没变，把视口挪回去；
     本机制        —— 结果已经变了，按 policy_id 在**新结果**里重新定位。

   约定：
     · 唯一标识只用 policy_id，不用政策标题（标题可能重复/改写）；
     · 详情页进入时记录当前 id + 名称；
     · 只有点「返回调整」才通过 ?back=<policy_id> 触发定位；
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
    const cur = s.n === current ? ' aria-current="step"' : '';
    return `<li class="flow-step ${cls}"${cur} data-stage="${s.n}">
      <span class="flow-dot" aria-hidden="true">${mark}</span>
      <span class="flow-text">
        <span class="flow-label">${escapeHtml(s.label)}</span>
        <span class="flow-hint">${escapeHtml(s.hint)}</span>
      </span>
    </li>`;
  }).join('');

  return `
    <nav class="flow" aria-label="使用流程" data-flow-current="${current}">
      <ol class="flow-steps">${steps}</ol>
    </nav>`;
}

/**
 * 当前阶段：唯一数据源。
 *
 * 之前顶栏「第 N 步」是页面里写死的静态文案，下方进度条高亮是 mountFlow 的动态状态，
 * 两处各说各话（policy.html 顶栏写第 3 步、进度条高亮第 4 步；discover.html 匹配后
 * 进度条进到第 2 步、顶栏还停在第 1 步）。现在只保留这一个数字，两处都从它推导。
 *
 * 铁律：步骤文案只能由 mountFlow 写入，页面不得再自己拼「第 N 步」。
 */
let _flowStage = 0;

function flowStepText(n) {
  return '第 ' + n + ' 步';
}

/** 归一化阶段序号：非数字或越界一律夹到 1..4，避免出现「第 0 步」「第 7 步」 */
function normalizeFlowStage(n) {
  const v = parseInt(n, 10);
  if (!isFinite(v)) return 1;
  return Math.min(FLOW_STAGES.length, Math.max(1, v));
}

/**
 * 顶栏步骤徽章：与进度条同源。
 * 徽章节点由这里创建/更新，页面不再预置步骤文案，从根上消除两处不一致。
 */
function syncFlowStepBadge(step) {
  const row = document.querySelector('.topbar .brand-row');
  if (!row) return;
  let col = row.querySelector('.tag-col');
  if (!col) {
    row.insertAdjacentHTML('beforeend', '<div class="tag-col"></div>');
    col = row.querySelector('.tag-col');
    if (!col) return;
  }
  let badge = col.querySelector('[data-step-badge]');
  if (!badge) {
    col.insertAdjacentHTML('beforeend', '<span class="step-tag" data-step-badge></span>');
    badge = col.querySelector('[data-step-badge]');
    if (!badge) return;
  }
  badge.textContent = flowStepText(step);
  badge.setAttribute('data-step', String(step));
}

/** 挂载流程指示器。current: 1..4 —— 同时同步顶栏步骤徽章，两处永远同源 */
function mountFlow(current) {
  _flowStage = normalizeFlowStage(current);
  syncFlowStepBadge(_flowStage);

  const app = document.querySelector('.app');
  if (!app) return;
  let el = app.querySelector('.flow');
  if (el) el.remove();
  const anchor = app.querySelector('.demo-progress')
    || app.querySelector('.demo-banner')
    || app.querySelector('.topbar');
  if (!anchor) return;
  anchor.insertAdjacentHTML('afterend', renderFlow(_flowStage));
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

  // ---- 1a. 自相矛盾的说法
  // 一句话里同时出现「独自居住」和「和子女一起住」，引擎不替用户裁决，
  // 但要明确说出来：否则用户以为 AI 采信的那句是自己想要的。
  const conflicts = Array.isArray(profile.conflicts) ? profile.conflicts : [];
  const conflictsHtml = conflicts.length ? `
    <div class="board-conflict" role="status">
      <p class="bc-t">您的描述里有一处前后不一致，需要先确认</p>
      <ul class="bc-list">
        ${conflicts.map((c) => `
          <li class="bc-item">
            <span class="bc-kind">${escapeHtml(c.kind || '说法')}</span>
            <span class="bc-said">${(c.said || []).map(escapeHtml).join(' / ')}</span>
            <span class="bc-note">${escapeHtml(c.note || '')}</span>
          </li>`).join('')}
      </ul>
      <p class="bc-tip">请在上面的描述里改成您现在真实的情况，再重新读一遍。这一次我们不会替您挑一句。</p>
    </div>` : '';

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
      ${conflictsHtml}
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
 * 原创视觉母题：「一线」——从生活线索指向权益的那条线。
 *
 * 为什么是这条线：这个产品做的事，本质是把「您随口说的生活情况」接到
 * 「一项您没听说过的权益」上。这条线就是那件事本身，不是装饰。
 *
 * 设计规则（复用时要一致，改这里就全局生效）：
 *   起点  6×6 空心方块  1px solid --brand-line  —— 生活线索（用户给的、待解释的）
 *   连线  1.5px 虚线    3px 实 / 3px 空        —— 匹配这一段推断（不是结论）
 *   终点  6×6 实心圆    --brand               —— 权益（AI 找到的）
 *   间距  节点与文字 6px；连线长度 14px；行高与正文一致
 *   尺寸  整条线高 6px，不改变所在行的行高，可以塞进任何一行正文
 *   语义  方块=输入，圆点=输出；方块空心表示「还没被核对过」
 *
 * 用法：renderThread('独居', '社区养老服务')
 *      线索或权益缺失时降级为纯文字，不画半条线。
 */
function renderThread(clue, right, opts) {
  opts = opts || {};
  const c = String(clue == null ? '' : clue).trim();
  const r = String(right == null ? '' : right).trim();
  if (!c || !r) {
    return `<span class="thread is-text">${escapeHtml(c || r)}</span>`;
  }
  const label = opts.label || `从生活线索「${c}」到权益「${r}」`;
  return `<span class="thread${opts.cls ? ' ' + opts.cls : ''}" role="img" aria-label="${escapeHtml(label)}">`
    + `<span class="th-clue">${escapeHtml(c)}</span>`
    + '<span class="th-path" aria-hidden="true"></span>'
    + `<span class="th-right">${escapeHtml(r)}</span>`
    + '</span>';
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
  // ③ 官方依据。这里只有「来源核验」这一层结论（本段不谈匹配层），
  // 所以用带维度名的方点短句，不再用和匹配层同款的药丸，避免两个维度长得一样。
  const citBadge = cit.verified
    ? '<span class="cite-state is-verified">✓ 已核验</span>'
    : '<span class="cite-state is-pending">来源待核验</span>';

  const pending = ev.pending_count || 0;

  // 视觉母题「一线」在证据链里的用法：把用户给的线索接到这条权益上。
  // 线索取画像依据里的标签（真实数据），没有就退回「您的描述」。
  const clueLabels = (ev.profile_basis || []).map((b) => b.label).filter(Boolean);
  const clueText = clueLabels.length ? clueLabels.slice(0, 2).join(' · ') : '您的描述';
  const threadHtml = renderThread(clueText, opts.policyName || '这条权益', { cls: 'thread-head' });

  return `
    <div class="evidence">
      <div class="ev-head">
        <span class="ev-title">为什么是这一条 · 证据链</span>
        ${pending ? `<span class="ev-pending">${pending} 项条件待确认</span>` : ''}
      </div>
      ${threadHtml}

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
 * 结果页分段标签：全部 / 待核验 / 已核验 / 信息待补充。
 *
 * 四个计数都来自后端返回的字段，前端不自行判定任何一条是否「核验过」：
 *   待核验     = source_pending 为真的条数（一手文件还没核到）
 *   已核验     = source_pending 为假的条数（来源维度已核对）
 *   信息待补充 = 仍有待确认信息的条数（missing_information 非空）
 * 计数可能重叠（一条既可能待核验、又需要补充信息），这是如实呈现，不是错误。
 *
 * 交互：原生 <a href="#frag"> + CSS :target，无脚本也能切换（脚本只负责同步 highight）。
 */
function renderSegments(list) {
  const seg = [
    { key: 'all', label: '全部', n: list.length },
    { key: 'pending', label: '待核验', n: list.filter((r) => r.source_pending).length },
    { key: 'verified', label: '已核验', n: list.filter((r) => !r.source_pending).length },
    { key: 'needinfo', label: '信息待补充', n: list.filter((r) => (r.missing_information || []).length).length },
  ];
  // 计数为 0 的一段没有对应分组，找过去必然是死链——降级成不可点的计数。
  return `<nav class="seg-nav" aria-label="按核验状态筛选">${seg.map((s) => (
    s.n
      ? `
      <a class="seg${s.key === 'all' ? ' is-on' : ''}" href="#seg-${s.key}" data-seg="${s.key}">
        <span class="seg-l">${s.label}</span><span class="seg-n">${s.n}</span>
      </a>`
      : `
      <span class="seg is-empty" aria-disabled="true">
        <span class="seg-l">${s.label}</span><span class="seg-n">${s.n}</span>
      </span>`
  )).join('')}</nav>`;
}

/**
 * 「推荐理由」一句话摘要：把第一人称的口语理由转成第三人称短句。
 *
 * 只做称呼替换（「您父亲」→「父亲」），不改写、不概括、不补充判断，
 * 所以摘要里的每个字仍然出自引擎给出的 ai_reason。
 */
function reasonBrief(line) {
  if (!line) return '';
  return String(line)
    .replace(/^您(?=父亲|母亲|长辈|配偶|本人)/, '')
    .replace(/^您(?=的)/, '')
    .trim();
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
  const selfLead = !!(profile.mode === 'self' || opts.selfMode);

  const oneCard = (r, opts) => {
    const meta = [r.category, r.service_type, r.region].filter(Boolean).map(escapeHtml).join(' · ');

    // 第一眼三件事之①：这条权益是什么。service_note 是库里已有的服务简介，
    // 只做两行截断，完整表述仍在详情页「这是什么？」里，不丢信息。
    const whatLine = r.service_note
      ? `<p class="result-what">${escapeHtml(r.service_note)}</p>` : '';

    // 第一眼三件事之②：为什么 —— 默认只留最有力的一条理由，其余折叠。
    // 引擎给的 ai_reason 第一条通常是「年龄/户籍等硬条件命中」，最能说明为什么是它。
    const reasons = (r.ai_reason || [])
      .map((x) => `<li>${escapeHtml(personalize(x, profile))}</li>`);
    // V14 卡面的「为什么」只留一条：有摘要就用摘要（它本身就是第一条理由），
    // 不再把同一条原文在下面重复列一遍。其余理由仍全部保留在折叠里。
    const reasonFirst = reasons[0]
      || '<li>暂无可用于判断的具体情况，建议补充描述后重新匹配。</li>';
    const reasonRest = reasons.slice(1);
    // 措辞是「另外 N 条理由」：这不是分页，只是把已经拿到的其余理由收起来。
    const restReasonHtml = reasonRest.length ? `
          <button type="button" class="reason-more" data-reason-toggle="${escapeHtml(r.policy_id)}"
                  aria-expanded="false" aria-controls="reasonRest-${escapeHtml(r.policy_id)}">另外 ${reasonRest.length} 条理由</button>
          <ul class="reason-list reason-rest" id="reasonRest-${escapeHtml(r.policy_id)}"
              data-reason-rest="${escapeHtml(r.policy_id)}" hidden>${reasonRest.join('')}</ul>` : '';

    // 卡面摘要：只取第一条理由原文做称呼替换，写成「推荐理由：…」一行。
    // 完整理由仍在下方「为什么推荐」块里（原文未改动），摘要只是让人一眼看到为什么。
    //
    // V14 之后这一行不再单独排版：它被并进下面的「与家庭情况的关联」框里，
    // 由 rc-brief 承接第二句话。变量保留是为了让「推荐理由 → 为什么推荐 →
    // 还需确认 → 来源」这个层级顺序在模板里仍然看得出先后。
    const brief = reasonBrief(profile && profile.relation
      ? personalize((r.ai_reason || [])[0] || '', profile)
      : ((r.ai_reason || [])[0] || ''));
    const briefHtml = brief
      ? `<span class="rc-brief">${escapeHtml(brief)}</span>` : '';

    // 匹配给谁 + 符合度。符合度直接用引擎 score，这里是相对分不是概率；
    // 文案写「符合度」并带 % ，但下方一定会说明它不是资格结论。
    const whoLabel = selfLead
      ? '您本人'
      : (profile && profile.relation ? profile.relation : '家人');
    const whoAge = (profile && profile.basic && profile.basic.age)
      ? `${profile.basic.age}岁` : '';
    const who = whoAge ? `${whoLabel}（${whoAge}）` : whoLabel;
    const pct = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));

    // 条件芯片：取自证据链里的政策条件（真实字段），已确认用绿、待确认用灰。
    const condChips = ((r.evidence && r.evidence.policy_conditions) || [])
      .slice(0, 4)
      .map((c) => {
        const txt = c.state === 'met'
          ? `${c.label}符合`
          : `${c.label}待确认`;
        const cls = c.state === 'met' ? 'is-met' : (c.state === 'failed' ? 'is-off' : 'is-todo');
        return `<span class="cond-chip ${cls}">${escapeHtml(txt)}</span>`;
      }).join('');

    const missing = filterAnsweredMissing(r.missing_information, profile);
    const shown = missing.slice(0, 2);
    const rest = missing.length - shown.length;
    // 惰性拼接：只在折叠区真正渲染时才展开这段 HTML。
    // 「还需确认」属于第二层信息（默认收起），不该在卡面主信息之前被求值，
    // 包成函数既能表达这个层级，也让模板里的顺序断言读得出来。
    const missingPanel = () => (missing.length ? `
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
      </div>` : '');

    // 「还需确认」与「政策来源」默认收起：它们要等用户想知道细节时才读，
    // 一直摊在卡面上会把上面那句理由和下面的动作挤走。用原生 details，
    // 内容始终在 DOM 里（折叠不等于删除），无需 JS 也能展开。
    const foldSum = [missing.length ? `还需确认 ${missing.length} 项` : '', '政策来源']
      .filter(Boolean).join(' · ');

    // 来源状态：卡底单独一行，形态与顶部的匹配状态明显不同（带维度名、方点短句）。
    const sourceState = r.source_pending
      ? '<span class="cite-state is-pending">来源待核验</span>'
      : '<span class="cite-state is-verified">✓ 已核验</span>';
    const docNo = String(r.source_document_no || '').trim();
    // 有文号就展示文号（库里真实字段），没有就退回来源状态；
    // 两种都带上右侧的箭头，表示这一行点进去能看到完整来源（与卡尾入口同一去向）。
    const citeLine = `<p class="rc-cite-line">
          <span class="rc-cite-k">政策依据</span>
          <span class="rc-cite-v">${docNo ? escapeHtml(docNo) : sourceState}</span>
          ${docNo ? `<span class="rc-cite-state">${sourceState}</span>` : ''}
          <span class="rc-cite-arrow" aria-hidden="true">›</span>
        </p>`;

    // 导航语义由卡尾的独立 <a> 承担（原生可聚焦、可 Enter、中键可新开）；
    // 整卡不再伪装成 button——button 角色里嵌 summary/按钮是无效 ARIA 嵌套。
    // 「推荐度高」只标最先出现的那一张卡：它是「优先关注」组的第一条，
    // 也就是当前排序里最值得先看的一条，不另算分数、不改排序。
    const isLeadCard = !!(opts && opts.lead);

    // V14 优先卡：把原来的「8 个纵向区块」压成原型那样一段，
    // 理由只留一条、待确认只留一句，其余全部收进卡尾两个入口。
    // 信息没删——「另外 N 条理由」「还需确认 N 项 · 政策来源」都还在，
    // 只是从「常驻卡面」变成「点一下才展开」，首屏因此能同时看到标题、
    // 推荐给谁、为什么、下一步。
    const condFirst = ((r.evidence && r.evidence.policy_conditions) || [])
      .find((c) => c.state !== 'met');
    const condLine = missing.length
      ? `还需确认：${escapeHtml(personalize(missing[0], profile))}`
      : (condFirst ? `还需确认：${escapeHtml(condFirst.label)}` : '');
    return `
      <article class="result-card${isLeadCard ? ' has-tier is-lead' : ''}" data-id="${escapeHtml(r.policy_id)}">
        ${isLeadCard ? '<span class="rc-tier">推荐度高</span>' : ''}
        <div class="result-head">
          <div class="result-head-main">
            <h3 class="result-name">${escapeHtml(r.policy_name)}</h3>
            <p class="result-meta">${meta}</p>
          </div>
          <div class="result-badges">${statusBadge(r.status, r.source_pending)}</div>
        </div>

        ${whatLine}

        <div class="rc-whofit">
          <span class="rc-who"><span class="rc-who-k">推荐给</span>${escapeHtml(who)}</span>
          <span class="rc-fit"><span class="rc-fit-k">符合度</span><b class="rc-fit-v">${pct}%</b></span>
        </div>

        <!-- 关联理由：卡面只一句，其余理由折叠在「另外 N 条理由」里，一条都不丢 -->
        <div class="reason-box">
          <div class="reason-title">与家庭情况的关联</div>
          <ul class="reason-list">${briefHtml
            ? `<li class="rc-brief-item"><span class="rb-k">推荐理由</span>${briefHtml}</li>`
            : reasonFirst}</ul>
          ${restReasonHtml}
        </div>

        ${condLine ? `<div class="condition-row">
          <span class="condition-dot" aria-hidden="true">!</span>
          <span>${condLine}</span>
        </div>` : ''}

        ${condChips ? `<div class="cond-chips">${condChips}</div>` : ''}

        ${renderValidityNote(r.validity)}
        ${renderThresholdNote(r.threshold_signal)}

        <div class="priority-footer">
          <p class="rc-cite-line">${docNo ? `政策依据：${escapeHtml(docNo)}` : '政策依据：见详情'}</p>
          <a class="evidence-link" href="policy.html?id=${encodeURIComponent(r.policy_id)}">为什么推荐　›</a>
        </div>

        <details class="rc-fold">
          <summary class="rc-fold-sum">${foldSum}</summary>
          ${missingPanel()}
          ${sourceBlock(r)}
        </details>

        <button type="button" class="ev-toggle" data-ev-toggle="${escapeHtml(r.policy_id)}"
                aria-expanded="false">为什么推荐？看依据</button>
        <div class="ev-slot" data-ev-slot="${escapeHtml(r.policy_id)}" hidden></div>

        <a class="result-foot" href="policy.html?id=${encodeURIComponent(r.policy_id)}">查看详情与办理方式 <span class="arrow">→</span></a>
      </article>`;
  };

  // 分组：引擎的「强相关」档展示为「优先关注」，其余两档合并为「其他可能相关」。
  //
  // 「信息待补充」是一条横切的属性（missing_information 非空），几乎每条政策都有——
  // 真实数据 10 条全非空。所以它不能拿来当排除条件（那会把整组清空），
  // 只用来决定「答案卡要不要展开那块缺口」。档位分组与它解耦，互不影响。
  //
  // 于是同一批政策在页面上有两种组织方式，各自回答不同问题：
  //   档位分组（优先关注 / 其他可能相关 / 信息待补充）→ 这 10 条按相关度怎么排
  //   来源分组（待核验 / 已核验）→ 按来源维度怎么分
  // 来源分组只列名字与核验状态，不复述卡片，避免同一条政策出现两遍。
  const hasMissing = (r) => (r.missing_information || []).length > 0;
  const focus = list.filter((r) => r.tier === '强相关');
  const others = list.filter((r) => r.tier !== '强相关');
  const needinfo = list.filter(hasMissing);

  const verPending = list.filter((r) => r.source_pending);
  const verVerified = list.filter((r) => !r.source_pending);

  const verListHtml = (rows, key, label, desc) => (rows.length
    ? `<div class="ver-group" id="seg-${key}">
         <div class="vg-head">
           <span class="vg-name">${label}</span>
           <span class="vg-count">${rows.length} 项</span>
         </div>
         <p class="vg-desc">${desc}</p>
         <ul class="vg-list">${rows.map((r) => `
           <li class="vg-row">
             <span class="vg-name-i">${escapeHtml(r.policy_name)}</span>
             <span class="vg-meta">${
               r.source_pending
                 ? '一手文件尚未核到'
                 : `已核验${r.source_checked_at ? ' · ' + escapeHtml(r.source_checked_at) : ''}`
             }</span>
           </li>`).join('')}</ul>
       </div>`
    : '');

  const verPendingHtml = verListHtml(
    verPending, 'pending', '来源待核验',
    '这些政策的责任部门与文号已标注，但支撑它的一手文件还没逐字核到。'
  );
  const verVerifiedHtml = verListHtml(
    verVerified, 'verified', '来源已核验',
    '这些政策的名称、对象、服务内容与依据文件已逐项核对。'
  );

  // 「优先关注」组的标题同时承担「全部」分段的落点：
  // 从这一行开始往下就是完整列表，与原设计「全部」= 回到列表起点一致。
  // 「全部」这一段在优先关注组为空时也要有落点（否则点了是死链），
  // 所以把锚点挂在一个始终存在的容器上，组标题只负责长相。
  const focusInner = (focus.length
    ? `<div class="tier-head is-focus">
         <span class="th-name">优先关注</span>
         <span class="th-count">${focus.length} 项</span>
         <span class="th-desc">AI 从您的描述中识别到了对应的生活变化，建议先了解这几项</span>
       </div>
       <div class="tier-items">${focus.map((r, i) => oneCard(r, { lead: i === 0 })).join('')}</div>`
    : '<p class="vg-desc" style="margin:0">本次匹配没有进入「优先关注」档的条目，下面按来源核验与信息完整度分组列出。</p>');
  const focusHtml = `<div class="seg-anchor" id="seg-all">${focusInner}</div>`;

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

  // 「信息待补充」组：不重复卡片，只把缺什么列出来，指回上面那条。
  // 用户点「信息待补充」跳过来时立刻知道要补哪几项，而不是面对一批一样的卡片。
  const needinfoHtml = needinfo.length
    ? `<div class="ver-group" id="seg-needinfo">
         <div class="vg-head">
           <span class="vg-name is-warn">信息待补充</span>
           <span class="vg-count">${needinfo.length} 项</span>
         </div>
         <p class="vg-desc">以下几项的适用条件里有无法从描述判断的部分，补齐后结论才会更确定。卡片本身仍在上面的分组里。</p>
         <ul class="vg-list">${needinfo.map((r) => `
           <li class="vg-row">
             <span class="vg-name-i">${escapeHtml(r.policy_name)}</span>
             <span class="vg-meta">缺 ${r.missing_information.length} 项</span>
           </li>`).join('')}</ul>
       </div>`
    : '';


  const focusCount = focus.length;
  // 这句仍保留（有 4 处端到端断言在读它），但不再单独占一个 .result-summary 块——
  // V14 把「建议优先了解」挪到了分组标题上，这里留作分段下方的一句过渡，
  // 让「总数 → 优先几项 → 具体卡」三步读下来不断。
  const summary = focusCount
    ? `建议优先了解其中 ${focusCount} 项`
    : '暂未识别到优先关注项，以下均需进一步确认';

  // 发现导语卡（V14）：先用一句话说「发现了什么」，再给三个真实分类计数。
  // 计数按引擎返回的 category 聚合取前三——不套用原型里写死的
  // 「养老照护 / 医疗保障 / 健康管理」，那是设计占位，真实库的分类未必如此。
  const catMap = new Map();
  list.forEach((r) => {
    const c = String(r.category || '').trim();
    if (!c) return;
    catMap.set(c, (catMap.get(c) || 0) + 1);
  });
  const catTop = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const catCounts = catTop.length >= 2
    ? `<div class="disc-counts">${catTop.map(([name, n]) => `
        <div class="disc-count"><strong>${n}</strong><span>${escapeHtml(name)}</span></div>`).join('')}</div>`
    : '';
  // 导语标题同样避开原型的通用文案，直接报这次真实找到的数量与重点项数。
  const introTitle = focusCount
    ? `为您的家庭找到 ${list.length} 项可能相关的服务`
    : `找到 ${list.length} 项可能相关的服务`;
  const discIntro = `
    <section class="disc-intro">
      <div class="disc-kicker"><span class="spark" aria-hidden="true">✦</span>家庭权益发现</div>
      <h2>${escapeHtml(introTitle)}</h2>
      <p>根据您填写的情况整理。以下为初步线索，不代表已经符合申请资格。</p>
      ${catCounts}
    </section>`;

  // 生活场景归纳保留，但放到结果列表之后：
  // 它与「优先关注 / 其他可能相关」是同一批信息的两种归纳，
  // 放在列表前面会把重点卡片挤出首屏。功能未删，只是换了位置。
  //
  // 顶部改成分段标签 + 计数（参考设计的结果页头部）：分段是基于后端字段的
  // 真实计数，点哪一段就跳到对应分组的锚点——不是过滤，列表内容一条不少，
  // 所以不会出现「筛完剩 0 条」这种让人以为没找到的情况。
  //
  // 四段各自必须有真实落点，否则点了不动比不能点更糟：
  //   全部       → #seg-all（优先关注组标题，往下就是整份列表）
  //   待核验     → #seg-pending（来源待核验组）
  //   已核验     → #seg-verified（来源已核验组）
  //   信息待补充 → #seg-needinfo（缺条件组）
  // 某一段当前为 0 条时该组不渲染，锚点也就不存在——这时把胶囊降级成
  // 不可点的计数，避免出现「看着能点、点了没反应」的假控件。
  // 宽屏两栏（1024px 起）：用 grid 的具名区域把「说明 + 分段 + 提示」收进左侧栏，
  // 「卡片列表」留在右侧主区。手机与平板不入列——它们的 CSS 不用 grid，仍是一列直排。
  // 分段筛选本身是锚点导航（点它滚到对应分组），放进侧栏后仍指向同一批锚点，
  // 不新增过滤能力，也没有虚构功能。
  return `
    <div class="section result-layout">
      <div class="rl-side">
        ${discIntro}
        <h2 class="section-title rl-title" id="resultAnchor">共找到 ${list.length} 条可能相关的政策</h2>
        <div class="rl-seg">${renderSegments(list)}</div>
        <p class="result-summary">${escapeHtml(summary)}</p>
        <p class="hint seg-sum" style="margin:-4px 0 10px">以下均为「可能相关」的初步匹配结果，不代表已符合资格。</p>
        <div class="notice">${escapeHtml(data.notice || '')}</div>
        ${renderAiFlowDone()}
      </div>
      <div class="rl-main">
        <div class="tier-groups">${focusHtml}${othersHtml}${verPendingHtml}${verVerifiedHtml}${needinfoHtml}</div>
        ${renderSceneSummary(list)}
        <p class="results-note">匹配结果仅用于辅助发现线索。具体资格、材料和办理方式，请以主管部门现行规定为准。</p>
      </div>
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
  // 收起时内容高度为 0，但里面的链接与按钮仍留在 Tab 顺序里：
  // 键盘用户会跳进一片看不见的区域，读屏也会念出折叠掉的条目。
  // inert 同时移出焦点与无障碍树，高度过渡不受影响。
  if (on) {
    body.removeAttribute('inert');
    body.removeAttribute('aria-hidden');
  } else {
    body.setAttribute('inert', '');
    body.setAttribute('aria-hidden', 'true');
  }

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
  // 调用方可以指定「本页把资料存在 store 的哪个键」，默认是家庭页的 profile。
  const profileKey = (currentData && currentData.__profileKey) || 'profile';
  document.querySelectorAll('[data-scene]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.scene;
      const on = btn.dataset.on === '1';
      // 场景集合要以 store 里最新的为准，不能用渲染时的 base。
      // 连点两个 chip 时，第二次点击发生在结果重渲染之前，
      // base 还是旧的，上面那次的新增会被这一下算掉，看起来像第一次没点上。
      // 本人页把资料存在 selfProfile、家庭页存在 profile，所以只认当前页那一个键；
      // 固定读 profile 会让本人页每次都退回渲染时的 base，连点照样丢选择。
      const latest = (store.read()[profileKey] && store.read()[profileKey].scenes)
        ? store.read()[profileKey]
        : base;
      const cur = latest.scenes || [];
      const next = on
        ? cur.filter((s) => s !== name)
        : cur.concat([name]);
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
        btn.textContent = '为什么推荐？看依据';
        return;
      }
      const r = (resultsById || {})[id];
      if (!r) return;
      slot.innerHTML = renderEvidenceChain(r.evidence, {
        selfMode: r.__selfMode,
        policyName: r.policy_name,
      });
      slot.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.textContent = '收起证据链';
    });
  });
}

/**
 * 结果卡「另外 N 条理由」的展开开关。
 * 理由折叠不是分页：第一条最有力的理由始终显示，其余默认收起，
 * 点开后再把完整列表放出来，信息一条都不删。
 */
function bindReasonToggles() {
  document.querySelectorAll('[data-reason-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();       // 展开理由不等于进详情
      const id = btn.dataset.reasonToggle;
      const rest = document.querySelector('[data-reason-rest="' + CSS.escape(id) + '"]');
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        if (rest) rest.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        const n = rest ? rest.children.length : 0;
        btn.textContent = '另外 ' + n + ' 条理由';
        return;
      }
      if (rest) rest.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.textContent = '收起其余理由';
    });
  });
}

/**
 * 分段导航（全部 / 待核验 / 已核验 / 信息待补充）。
 *
 * 分段不是过滤——列表内容一条不少，点击只是把视野带到对应分组。
 * 正因为不是过滤，高亮必须跟着点击走：停在「全部」上会让用户以为
 * 筛选没生效，于是反复点同一格。这里只改选中态，不改任何内容。
 */
function bindSegments() {
  const segs = Array.from(document.querySelectorAll('.seg-nav .seg[data-seg]'));
  if (!segs.length) return;
  segs.forEach((a) => {
    if (a.__bound) return;
    a.__bound = true;
    a.addEventListener('click', () => {
      segs.forEach((x) => {
        const on = x === a;
        x.classList.toggle('is-on', on);
        if (on) x.setAttribute('aria-current', 'true');
        else x.removeAttribute('aria-current');
      });
    });
  });
}

/** 顶部返回条：parentHref 是本页的父页面，点击后明确跳回该页 */
function renderTopbar(title, parentHref, sub) {
  const el = document.querySelector('.topbar');
  if (!el) return;
  // 右上是「标签区」：主题标签（family/self 的操作者关系）在上，步骤徽章在下。
  // 这里只放主题标签；步骤徽章一律由 mountFlow → syncFlowStepBadge 创建并写入，
  // 保证「第 N 步」只有一处来源，不会出现顶栏和进度条各说各话。
  const tag = sub ? `<span class="theme-tag">${escapeHtml(sub)}</span>` : '';
  const tagCol = tag ? `<div class="tag-col">${tag}</div>` : '';
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
      ${tagCol}
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

/* ==========================================================================
   底部一级导航（首页 / 发现 / 咨询 / 我的）
   --------------------------------------------------------------------------
   为什么是四个真实文件而不是单页切换：
   本项目每个页面本来就是独立文件、靠 location.href 翻页，没有路由框架。
   加一层假路由会把「刷新页面」「中键新窗口」「浏览器后退」全部推翻重做，
   收益只有地址栏好看一点，风险远大于收益。所以底部导航做成
   「每个一级页里固定渲染同一个 <nav>，当前页那一项高亮」——
   它仍是真实的页面跳转，点哪个进哪个文件，刷新后高亮不丢。

   政策详情是二级页，不在这四个入口里；它的返回靠顶部「← 返回」。
   ========================================================================== */

const TAB_ITEMS = [
  { key: 'home', label: '首页', href: 'index.html',
    d: 'M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z' },
  { key: 'discover', label: '发现', href: 'discover.html',
    d: 'M11 4.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6zM20 20l-3.9-3.9' },
  { key: 'consult', label: '咨询', href: 'consult.html',
    d: 'M4.4 5.4h15.2v10.2H12l-4.6 3.6v-3.6H4.4z' },
  { key: 'mine', label: '我的', href: 'mine.html',
    d: 'M12 4.4a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4zM4.8 20.2a7.2 7.2 0 0 1 14.4 0' },
];

/**
 * 渲染并挂载底部一级导航。current 是当前页的 key（home/discover/consult/mine）。
 *
 * 只在缺少 <nav> 时创建；重复调用（例如结果重绘）会原地更新高亮，不会叠出第二条。
 * 同时给 <body> 打上 has-tabbar，由 CSS 负责给正文留出底部空间——
 * 内容被导航遮住这件事必须由布局解决，不能靠某个页面自己记得加 padding。
 */
function mountTabbar(current) {
  if (typeof document === 'undefined' || !document.body) return null;
  let nav = document.getElementById('tabbar');
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'tabbar';
    nav.className = 'tabbar';
    document.body.appendChild(nav);
  }
  document.body.classList.add('has-tabbar');

  nav.setAttribute('aria-label', '主导航');
  nav.innerHTML = `<div class="tb-inner">${TAB_ITEMS.map((t) => {
    const on = t.key === current;
    return `<a class="tb-item${on ? ' is-on' : ''}" href="${t.href}"
      ${on ? 'aria-current="page"' : ''} data-tab="${t.key}">
      <svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true"><path d="${t.d}"></path></svg>
      <span class="tb-label">${t.label}</span>
    </a>`;
  }).join('')}</div>`;
  return nav;
}

/**
 * 读取「本次查询」的会话。所有一级页读同一份，不另存一套。
 * 返回 null 表示还没查过（发现页据此显示空状态，而不是编一批结果）。
 */
function readQuerySession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(store.key) || '{}');
    if (!s || !s.text) return null;
    return s;
  } catch (e) {
    return null;
  }
}

/**
 * 匹配请求的序号。每次发起匹配自增一次，回来时比对，
 * 只有最新的那次请求才有资格写界面与本地状态。
 *
 * 为什么需要：用户连点两个场景 chip 时会有两次请求同时在飞，
 * 网络不保证先发先回。慢的那次后到就会把新结果盖成旧的，
 * 界面停在用户已经改掉的那份情况上，看起来像「我点了但没反应」。
 */
let MATCH_REQUEST_SEQ = 0;

function beginMatchRequest() {
  MATCH_REQUEST_SEQ += 1;
  return MATCH_REQUEST_SEQ;
}

function isLatestMatchRequest(requestId) {
  return requestId === MATCH_REQUEST_SEQ;
}
