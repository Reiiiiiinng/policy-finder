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

/**
 * 比赛演示模式：在页面顶部插入一条「演示案例」提示，避免评委误认为是真实用户数据。
 * 仅当 sessionStorage 里 demoBanner=true 时显示。各页面加载后调用 mountDemoBanner() 即可。
 */
function renderDemoBanner() {
  return `<div class="demo-banner" role="status" aria-live="polite">
    <span class="demo-banner-badge">演示案例</span>
    <span class="demo-banner-text">72岁广州老人 · 独居 · 行动不便</span>
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
  if (/医保|参保|保险/.test(t)) return '为什么需要确认？长期护理保险等待遇以是否参加广州市社会医疗保险为前提。';
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
  if (!region || !/广州/.test(region)) {
    // 状态1：地区不匹配
    state = {
      title: '暂未发现相关公共服务权益',
      sub: `这次只识别到所在地区「${region || '未写明'}」。本批次为广州市的试点数据，当前地区暂无对应服务数据。`,
      reasons: [
        '当前地区暂无对应服务数据',
        '可以尝试修改地区信息，或在描述里写明所在城市',
      ],
      next: '把「广州 + 所在区或街道」写进描述，再点「开始发现」重新匹配',
    };
  } else if (!profile.age || !scenes.length) {
    // 状态2：信息不足
    const lack = [];
    if (!profile.age) lack.push('年龄信息不足');
    if (!scenes.length) lack.push('身体变化描述不足');
    lack.push('家庭情况不足');
    state = {
      title: '还需要更多生活情况信息',
      sub: `已识别到所在地区为广州市，但${lack.join('、')}，AI 暂时无法据此判断可能相关的服务。`,
      reasons: lack,
      next: '补充年龄、家庭情况或具体身体变化后，重新匹配',
    };
  } else {
    // 状态3：暂无相关服务
    state = {
      title: '当前数据库中暂未发现匹配服务',
      sub: `已了解到：${profile.age} 岁 · ${region} · ${scenes.join('、')}。本批次为广州市老年人公共服务的试点数据，范围仍在扩充。`,
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
      label: self ? '您是否具有广州市户籍' : '老人是否具有广州市户籍',
      why: '为什么需要确认？因为部分养老服务政策涉及户籍条件，未确认前无法判断是否适用。',
    },
    {
      key: 'insurance',
      label: self ? '您是否参加广州市社会医疗保险' : '老人是否参加广州市社会医疗保险',
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
      label: self ? '您是否具有广州市户籍' : '老人是否具有广州市户籍',
      why: '部分养老服务政策以户籍为准，未确认前无法判断是否适用。',
    },
    {
      key: 'insurance',
      label: self ? '您是否参加广州市社会医疗保险' : '老人是否参加广州市社会医疗保险',
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
 * 结果卡：在原有四段结构（推荐/待确认+原因/来源/查看详情）之上，
 * 新增分层标识与可展开的证据链。既有的类名与数据属性全部保留，
 * 详情页跳转仍依赖 .result-card 的 click 与 data-id。
 */
function renderResultCards(data, opts) {
  opts = opts || {};
  const list = data.results || [];
  if (!list.length) {
    return renderEmptyState(data, opts);
  }

  const profile = data.profile || {};
  const selfMode = profile.mode === 'self';

  const TIER_META = {
    '强相关': { cls: 'tier-strong', desc: 'AI 识别到了对应的生活变化' },
    '可能相关': { cls: 'tier-mid', desc: '有对应生活变化，但有关键条件待确认' },
    '待确认': { cls: 'tier-low', desc: '目前仅依据年龄等基础信息提示' },
  };

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

    // 证据链默认收起，用户点「看证据」再展开——保持卡片首屏清爽
    const tier = r.tier || '';
    const tm = TIER_META[tier];

    return `
      <article class="result-card" data-id="${escapeHtml(r.policy_id)}" tabindex="0" role="button">
        <div class="result-head">
          <div class="result-head-main">
            <h3 class="result-name">${escapeHtml(r.policy_name)}</h3>
            <p class="result-meta">${meta}</p>
          </div>
          <div class="result-badges">${statusBadge(r.status, r.source_pending)}</div>
        </div>

        ${tm ? `<div class="tier-strip ${tm.cls}">
          <span class="ts-name">${escapeHtml(tier)}</span>
          <span class="ts-desc">${escapeHtml(tm.desc)}</span>
        </div>` : ''}

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

  // 按分层分组：强相关在前，弱提示在后，避免用户被长列表淹没
  const order = ['强相关', '可能相关', '待确认'];
  const groups = order
    .map((k) => ({ tier: k, items: list.filter((r) => r.tier === k) }))
    .filter((g) => g.items.length);
  // 有未分层的兜底（旧数据兼容）
  const orphan = list.filter((r) => order.indexOf(r.tier) < 0);
  if (orphan.length) groups.push({ tier: '', items: orphan });

  const cardsHtml = groups.map((g) => {
    const tm = TIER_META[g.tier];
    const head = g.tier
      ? `<div class="tier-head ${tm.cls}">
           <span class="th-name">${escapeHtml(g.tier)}</span>
           <span class="th-count">${g.items.length} 项</span>
           <span class="th-desc">${escapeHtml(tm.desc)}</span>
         </div>`
      : '';
    return head + `<div class="tier-items">${g.items.map(oneCard).join('')}</div>`;
  }).join('');

  return `
    <div class="section">
      <h2 class="section-title" id="resultAnchor">${escapeHtml(opts.heading
        || ('AI发现：根据您提供的信息，发现 ' + list.length + ' 项可能相关的公共服务权益'))}</h2>
      ${renderAiFlowDone()}
      <p class="hint" style="margin:-4px 0 10px">
        以下均为「可能相关」的初步匹配结果，不代表已符合资格，建议逐项确认后再办理。
      </p>
      <div class="notice">${escapeHtml(data.notice || '')}</div>
      ${renderSceneSummary(list)}
      <div class="tier-groups">${cardsHtml}</div>
    </div>`;
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

/** 顶部返回条 */
function renderTopbar(title, backHref, sub) {
  const el = document.querySelector('.topbar');
  if (!el) return;
  const tag = sub ? `<span class="theme-tag">${escapeHtml(sub)}</span>` : '';
  const back = backHref
    ? `<a class="back-link" href="${escapeHtml(backHref)}">← 返回</a>`
    : '';
  el.innerHTML = `
    <div class="brand-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">政策找人 · AI赋能公共服务权益发现</div>
      </div>
      ${tag}
    </div>
    <div style="margin-top:10px">${back}</div>`;
}
