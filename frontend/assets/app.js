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

/** AI发现结果区：政策卡片列表 */
function renderResultCards(data, opts) {
  opts = opts || {};
  const list = data.results || [];
  if (!list.length) {
    return renderEmptyState(data, opts);
  }

  const profile = data.profile || {};
  const cards = list.map((r) => {
    const meta = [r.category, r.service_type, r.region].filter(Boolean).map(escapeHtml).join(' · ');
    const reasons = (r.ai_reason || [])
      .map((x) => `<li>${escapeHtml(personalize(x, profile))}</li>`).join('');

    const missing = filterAnsweredMissing(r.missing_information, profile);
    const shown = missing.slice(0, 3);
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

    return `
      <div class="result-card" data-id="${escapeHtml(r.policy_id)}">
        <div class="result-head">
          <div class="result-head-main">
            <h3 class="result-name">${escapeHtml(r.policy_name)}</h3>
            <p class="result-meta">${meta}</p>
          </div>
          <div class="result-badges">${statusBadge(r.status, r.source_pending)}</div>
        </div>
        <div class="rc-block">
          <div class="rc-label">为什么推荐</div>
          <ul class="reason-list">${reasons || '<li>暂无可用于判断的具体情况，建议补充描述后重新匹配。</li>'}</ul>
        </div>
        ${missingHtml}
        ${sourceBlock(r)}
        <div class="result-foot">查看详情与办理方式 <span class="arrow">→</span></div>
      </div>`;
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
      <div style="margin-top:12px">${cards}</div>
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
