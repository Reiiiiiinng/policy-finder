/* ============================================================
   首页脚本（theme-cb 结构 × partner-v1.1 业务逻辑）—— 行为隔离层
   ------------------------------------------------------------
   只被 index.html 引入，且必须在 assets/app.js 之后加载：
   这里使用的 store / activeQueryMode / escapeHtml / API / showToast /
   loadSiteContext / demoProfile / demoText / mountTabbar 全部来自
   partner-v1.1 的 app.js，本文件不重新定义、不覆盖它们。

   与 theme-cb 的差异（有意为之）：
   - 底部导航用 mountTabbar('home')（partner 契约），不用 mountBottomNav；
   - 「我的权益」指向 mine.html（partner 有这页，theme-cb 的 services.html 没有）；
   - 「政策解读 / 办理指引」不做「建设中」死路，仍按 partner 语义送到
     discover.html（intent 只影响落地提示，不改匹配结果）；
   - 「继续处理」区在 partner-v1.1 没有对应存储（无 verify-list / plan），
     因此永久保持 hidden，绝不编造待办数量。
   ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ============================================================
     一、头像映射（只按已选关系白名单映射，不猜姓名、不认照片）
     ============================================================ */

  // 首页真正可达的 5 个角色；原始 PNG 为 1024×1024 大图，已按 44px 展示
  // 需求压到 96×96（2× 屏），随包体积从 3.2MB 降到约 63KB。
  const AVA_SRC = {
    'elder-male': 'assets/avatars/elder-male.png',
    'elder-female': 'assets/avatars/elder-female.png',
    couple: 'assets/avatars/couple.png',
    self: 'assets/avatars/self.png',
    neutral: 'assets/avatars/neutral.png',
  };

  // 与 family.html 受益人选项（data-role）逐字对齐
  const AVA_MALE = ['父亲', '爷爷', '外公', '爸爸', '祖父', '外祖父'];
  const AVA_FEMALE = ['母亲', '奶奶', '外婆', '妈妈', '祖母', '外祖母'];
  const AVA_COUPLE = ['配偶', '老伴'];

  const ICON_ADD = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<circle cx="10" cy="9.2" r="3.3" stroke="currentColor" stroke-width="1.8"/>'
    + '<path d="M4.2 19.2c0-2.6 2.6-4.5 5.8-4.5s5.8 1.9 5.8 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '<path d="M18.6 7.6v5.2M16 10.2h5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '</svg>';

  const ICON_PERSON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<circle cx="12" cy="9" r="3.4" stroke="currentColor" stroke-width="1.8"/>'
    + '<path d="M5.4 19.4c0-2.8 2.9-4.8 6.6-4.8s6.6 2 6.6 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '</svg>';

  /**
   * 关系 → 头像角色。mode 为 'self' 时固定「本人」。
   * 未识别的一律 neutral，不做任何推断。
   */
  function avatarRole(name, mode) {
    if (mode === 'self') return 'self';
    const v = String(name || '').trim();
    if (!v) return 'neutral';
    if (AVA_COUPLE.indexOf(v) >= 0) return 'couple';
    if (AVA_MALE.indexOf(v) >= 0) return 'elder-male';
    if (AVA_FEMALE.indexOf(v) >= 0) return 'elder-female';
    return 'neutral';
  }

  function avatarMarkup(role) {
    if (role === 'add') return ICON_ADD;
    const key = AVA_SRC[role] ? role : 'neutral';
    return '<img class="hp-ava-img" src="' + AVA_SRC[key] + '" alt="" aria-hidden="true" '
      + 'decoding="async" data-ava="' + key + '">';
  }

  // 图片缺失/被拦截时回退到线稿头像，不留空白圆圈
  function bindAvatarFallback(root) {
    root.querySelectorAll('.hp-ava-img').forEach((img) => {
      img.addEventListener('error', () => {
        if (img.parentNode) img.parentNode.innerHTML = ICON_PERSON;
      }, { once: true });
    });
  }

  /* ============================================================
     二、家庭画像卡（成员、年龄只来自真实会话）
     ============================================================ */

  function memberCard(name, ageText, role) {
    return '<div class="hp-member is-active">'
      + '<span class="hp-avatar">' + avatarMarkup(role) + '</span>'
      + '<span class="nm">' + escapeHtml(name) + '</span>'
      + '<span class="ag">' + escapeHtml(ageText || '') + '</span>'
      + '</div>';
  }

  function renderHomeProfile() {
    const s = store.read();
    const membersEl = $('hpMembers');
    const countEl = $('hpCount');
    const titleEl = $('hpTitle');
    const enterEl = $('hpEnter');
    if (!membersEl) return;

    const mode = activeQueryMode();
    const ben = String(s.beneficiary || '').trim();
    // 年龄只在真实画像给出数字时展示，没有就不写，绝不补默认值
    const famAge = (s.profile && typeof s.profile.age === 'number') ? s.profile.age + ' 岁' : '';
    const selfAge = (s.selfProfile && typeof s.selfProfile.age === 'number') ? s.selfProfile.age + ' 岁' : '';

    if (mode === 'self') {
      countEl.textContent = '正在为自己查找';
      titleEl.textContent = '为自己的情况，找到可能遗漏的权益';
      membersEl.innerHTML = memberCard('本人', selfAge, 'self');
      enterEl.textContent = '重新评估家庭情况';
    } else if (ben) {
      countEl.textContent = '正在为 1 位家庭成员查找';
      titleEl.textContent = '为' + ben + '，找到可能遗漏的权益';
      membersEl.innerHTML = memberCard(ben, famAge, avatarRole(ben, 'family'))
        + '<button type="button" class="hp-member is-more" id="hpMore">'
        + '<span class="hp-avatar">' + avatarMarkup('add') + '</span>'
        + '<span class="nm">更多成员</span>'
        + '<span class="ag">在下一步选择</span>'
        + '</button>';
      const more = $('hpMore');
      if (more) more.addEventListener('click', goFamilyEntry);
      enterEl.textContent = '重新评估家庭情况';
    } else {
      countEl.textContent = '尚未建立家庭画像';
      titleEl.textContent = '为家人的生活变化，找到可能遗漏的权益';
      membersEl.innerHTML = '<button type="button" class="hp-empty" id="hpEmpty" '
        + 'aria-label="开始建立家庭画像">'
        + '<span class="hp-avatar">' + avatarMarkup('add') + '</span>'
        + '<span>'
        + '<span class="nm">建立家庭画像</span><br>'
        + '<span class="ag">选择帮谁查 · 确认查询关系 · 一句话描述变化</span>'
        + '</span>'
        + '</button>';
      const empty = $('hpEmpty');
      if (empty) empty.addEventListener('click', goFamilyEntry);
      enterEl.textContent = '开始建立家庭画像';
    }
    bindAvatarFallback(membersEl);
  }

  /* ============================================================
     三、入口分流（沿用 partner 契约：data-target + session.target）
     ============================================================ */

  // 「我的长辈」语义由 family.html 的「其他关系」折叠区承接，跳转契约不变
  function goFamilyEntry() {
    const prev = store.read().target;
    store.write({ target: (prev === 'family' ? 'family' : 'parents'), demo: false, demoBanner: false });
    location.href = 'family.html';
  }

  function goSelfEntry() {
    store.write({ target: 'self', demo: false, demoBanner: false });
    location.href = 'self.html';
  }

  /* ============================================================
     四、发现动态卡：数量只来自一次真实匹配请求
     ============================================================ */

  // 无可用会话时把用户送到对象选择区并说明下一步，
  // 而不是送进一个必然是空的结果页
  function promptEntry() {
    const box = $('hpEntry');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (box && !document.getElementById('entryPrompt')) {
      const tip = document.createElement('p');
      tip.id = 'entryPrompt';
      tip.className = 'entry-prompt';
      tip.setAttribute('role', 'status');
      tip.textContent = '请先选择这次为谁查询：点「重新评估家庭情况」或「为自己查找」，再继续。';
      const enter = $('hpEnter');
      if (enter && enter.parentNode === box) box.insertBefore(tip, enter);
      else box.appendChild(tip);
    }
    if (typeof showToast === 'function') showToast('请先选择这次为谁查询');
    const enter = $('hpEnter');
    if (enter) setTimeout(() => enter.focus({ preventScroll: true }), 260);
  }

  function sessionText() {
    const s = store.read();
    const mode = activeQueryMode();
    const text = String((mode === 'self' ? s.selfText : s.text) || '').trim();
    return { mode: mode, text: text, session: s };
  }

  // 与 discover.html / self.html 完全相同的 payload，避免「首页说有 N 项、结果页却是 M 项」
  async function lastMatchCount() {
    const cur = sessionText();
    if (!cur.text) return null;
    const payload = cur.mode === 'self'
      ? { text: cur.text, mode: 'self', profile: cur.session.selfProfile || {} }
      : {
        text: cur.text,
        relation: cur.session.beneficiary,
        operator: cur.session.operator,
        profile: cur.session.profile || {},
      };
    try {
      const data = await API.match(payload);
      return ((data && data.results) || []).length;
    } catch (e) {
      return null;
    }
  }

  async function renderDiscoverCard() {
    const card = $('discoverCard');
    const txt = $('dcTxt');
    if (!card || !txt) return;
    const cur = sessionText();
    if (!cur.text) {
      card.classList.add('is-empty');
      txt.textContent = '从生活变化出发，发现可能相关的政策';
      return;
    }
    const count = await lastMatchCount();
    if (count === null) {
      // 请求失败：不猜数字，回到可解释的空态
      card.classList.add('is-empty');
      txt.textContent = '上次的匹配结果暂时读不到，点击重新描述情况';
      return;
    }
    card.classList.remove('is-empty');
    txt.innerHTML = count === 0
      ? '上次没有发现可能相关的权益，点击重新描述情况'
      : '上次发现 <b>' + count + ' 项</b>可能相关的权益，点击查看';
  }

  /* ============================================================
     五、服务入口宫格
     ============================================================ */

  function goDiscoverOrPrompt() {
    const cur = sessionText();
    if (!cur.text) { promptEntry(); return; }
    location.href = cur.mode === 'self' ? 'self.html' : 'discover.html';
  }

  /* ============================================================
     六、我的收藏（partner 现有能力，有数据才出现）
     ============================================================ */

  function renderSaved() {
    const sec = $('savedSec');
    const list = $('savedList');
    const count = $('savedCount');
    if (!sec || !list) return;
    let items = [];
    try {
      const raw = localStorage.getItem('pf_saved');
      items = raw ? JSON.parse(raw) : [];
    } catch (e) { items = []; }
    if (!Array.isArray(items) || !items.length) return;

    count.textContent = items.length + ' 条';
    list.innerHTML = items.map((it) => ''
      + '<a class="saved-item" href="policy.html?id=' + encodeURIComponent(it.id || '') + '">'
      + '<span class="saved-item-body">'
      + '<span class="saved-item-name">' + escapeHtml(it.name || '') + '</span>'
      + (it.dept ? '<span class="saved-item-dept">' + escapeHtml(it.dept) + '</span>' : '')
      + '</span>'
      + '<span class="saved-item-arrow" aria-hidden="true">›</span>'
      + '</a>').join('');
    sec.hidden = false;
  }

  /* ============================================================
     七、数据可信度（partner 现有能力，数字全部来自 /api/policies）
     ============================================================ */

  async function loadTrustStrip() {
    const strip = $('trustStrip');
    const panel = $('statPanel');
    const note = $('trustNote');
    if (!strip) return;
    try {
      const d = await API.get('/api/policies');
      const list = d.policies || [];
      const total = d.total || list.length;
      if (!total) return;

      // 原文页数需要详情：逐条补齐（本地引擎，无网络开销）
      const details = await Promise.all(list.map((p) => API.policy(p.policy_id).catch(() => null)));
      const urlSet = new Set(
        details
          .map((pd) => (pd && String(((pd.source || {}).official_url) || '').trim()) || '')
          .filter(Boolean),
      );
      const distinctPages = urlSet.size;
      const verified = list.filter((p) => p.verification_status === 'verified').length;
      const pending = total - verified;

      $('statTotal').textContent = total;
      $('statVerified').textContent = verified;
      $('statSources').textContent = distinctPages;

      const bar = $('spVerifyBar');
      const legend = $('spVerifyLegend');
      const pctV = Math.round((verified / total) * 100);
      bar.innerHTML = '<span class="sp-seg sp-seg-ok" style="width:' + pctV + '%" title="已核验 '
        + verified + ' / ' + total + '"></span>'
        + '<span class="sp-seg sp-seg-pending" style="width:' + (100 - pctV) + '%" title="待核验 '
        + pending + ' / ' + total + '"></span>';
      bar.setAttribute('aria-label', '共 ' + total + ' 条，已核验 ' + verified + ' 条，待核验 ' + pending + ' 条');

      const rows = [
        { cls: 'ok', name: '已核验', n: verified, desc: '依据文件已核到发文机关页面，详情页显示「已核验」' },
        { cls: 'pending', name: '待核验', n: pending, desc: '一手文件尚未核到，详情页显示「来源待核验」' },
      ];
      legend.innerHTML = rows.map((r) => ''
        + '<li class="sp-lg-item">'
        + '<span class="sp-dot sp-dot-' + r.cls + '" aria-hidden="true"></span>'
        + '<span class="sp-lg-name">' + r.name + '</span>'
        + '<span class="sp-lg-num">' + r.n + ' 条</span>'
        + '<span class="sp-lg-desc">' + r.desc + '</span>'
        + '</li>').join('');

      const cats = new Map();
      list.forEach((p) => {
        const k = p.category || '未分类';
        cats.set(k, (cats.get(k) || 0) + 1);
      });
      const catRows = Array.from(cats.entries()).sort((a, b) => b[1] - a[1]);
      const catMax = catRows.length ? catRows[0][1] : 1;
      $('spCats').innerHTML = catRows.map(([name, n]) => ''
        + '<li class="sp-cat">'
        + '<span class="sp-cat-name">' + escapeHtml(name) + '</span>'
        + '<span class="sp-cat-track"><span class="sp-cat-fill" style="width:'
        + Math.round((n / catMax) * 100) + '%"></span></span>'
        + '<span class="sp-cat-num">' + n + '</span>'
        + '</li>').join('');

      strip.hidden = false;
      panel.hidden = false;
      note.hidden = false;
      strip.classList.add('animate-in', 'd1');
      panel.classList.add('animate-in', 'd2');
      note.classList.add('animate-in', 'd3');
    } catch (e) {
      // 接口不可用：保持隐藏，绝不写死数字
    }
  }

  /* ============================================================
     八、演示模式（partner 现有能力，虚拟案例需二次确认）
     ============================================================ */

  function showDemoConfirm() {
    if (document.getElementById('demoOverlay')) return;
    const p = demoProfile();
    const rows = p.rows.map((r) => '<div class="dc-row"><span class="k">'
      + escapeHtml(r[0]) + '</span><span class="v">' + escapeHtml(r[1]) + '</span></div>').join('');
    const overlay = document.createElement('div');
    overlay.id = 'demoOverlay';
    overlay.className = 'demo-overlay';
    overlay.innerHTML = ''
      + '<div class="demo-confirm-card">'
      + '<div class="demo-confirm-head">'
      + '<span class="demo-confirm-badge">演示案例</span>'
      + '<span class="demo-confirm-title">虚拟案例信息</span>'
      + '</div>'
      + '<div class="demo-confirm-rows">' + rows + '</div>'
      + '<p class="demo-confirm-note">以下为虚拟案例，不代表真实个人情况。</p>'
      + '<p class="demo-confirm-desc">确认后将进入家庭协助页，每一步都由您手动操作体验。</p>'
      + '<div class="demo-confirm-actions">'
      + '<button type="button" class="btn ghost" id="demoCancelBtn">取消</button>'
      + '<button type="button" class="btn" id="demoConfirmBtn">确认案例并开始体验</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    $('demoCancelBtn').addEventListener('click', () => overlay.remove());
    $('demoConfirmBtn').addEventListener('click', () => {
      store.write({
        target: 'parents',
        operator: '女儿',
        beneficiary: p.who,
        confirmed: true,
        demo: true,
        demoBanner: true,
        profile: {},
        text: demoText(p.who),
      });
      location.href = 'family.html';
    });
  }

  /* ============================================================
     九、事件绑定与启动
     ============================================================ */

  function bindEvents() {
    const enter = $('hpEnter');
    if (enter) enter.addEventListener('click', goFamilyEntry);

    const selfLink = document.querySelector('.hp-self-link');
    if (selfLink) selfLink.addEventListener('click', goSelfEntry);

    const card = $('discoverCard');
    if (card) card.addEventListener('click', goDiscoverOrPrompt);

    const tileMatch = $('tileMatch');
    if (tileMatch) tileMatch.addEventListener('click', goDiscoverOrPrompt);

    // 解读 / 办理指引：送到发现页挑一条看详情（intent 只影响落地提示）
    document.querySelectorAll('.hg-tile[data-svc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        try { sessionStorage.setItem('pf_svc_intent', btn.dataset.svc); } catch (err) { /* 隐私模式忽略 */ }
        location.href = 'discover.html';
      });
    });

    const tileMine = $('tileMine');
    if (tileMine) tileMine.addEventListener('click', () => { location.href = 'mine.html'; });

    const demoEntry = $('demoEntry');
    if (demoEntry) {
      demoEntry.addEventListener('click', async () => {
        await loadSiteContext();
        showDemoConfirm();
      });
    }
  }

  function init() {
    // 底部导航：首页为当前页（其余页面各自由 app.js 的 mountTabbar 挂载）
    mountTabbar('home');

    renderHomeProfile();
    bindEvents();
    renderDiscoverCard();
    renderSaved();
    loadTrustStrip();

    // 与城市有关的静态文案，等站点上下文就绪后再落笔（接口不可用时保持占位文案）
    loadSiteContext().then(() => {
      const desc = $('demoEntryDesc');
      if (desc) desc.textContent = demoProfile().desc;
      const scope = $('footScope');
      if (scope) {
        scope.textContent = '数据范围：' + SITE.region + ' · ' + SITE.policyCount
          + ' 条政策，逐条标注责任部门与文号';
      }
      const source = $('footSource');
      if (source) {
        source.textContent = '政策来源：各主管部门官方公开文件；每条政策的「政策来源」区可查看文号与原文链接';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
