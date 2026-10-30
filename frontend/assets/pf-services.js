/* ==========================================================================
   pf-services.js —— 「政策找人」A/B 两版共用的业务核心（服务闭环 + 存储规则）
   设计原则：
   1. 这里只放业务规则与数据读写，不写任何一套皮肤的视觉结构；
      标记一律用中性的 pfv- 前缀，A 版用 partner 变量上色，B 版用 theme-cb 变量上色。
   2. A/B 共用同一份文件（字节一致），因此同一功能只有一套实现。
   3. 存储命名空间由 pf-ns.js 提供（A='a'、B='b'），两版浏览器存储互相隔离，
      测试数据不会串味；同时仍与 partner 原有键（policy_finder_session / pf_saved）共存。
   4. 依赖 app.js 已有的全局：store / escapeHtml / API / showToast。
   5. 存储不可用（隐私模式）或 JSON 损坏时，一律安全降级为空数据，不抛错。
   ========================================================================== */
(function (global) {
  'use strict';

  var NS = (global.PF_NS === 'b' ? 'b' : 'a');

  /* 真实存储键：A/B 各自独立命名空间 */
  var K = {
    records: 'pf_verify_records_v1_' + NS,
    prep: 'pf_prep_v1_' + NS,
    mark: 'pf_fs_' + NS + '_',          /* 详情页标记：pf_fs_<ns>_<policy_id> */
    savedNs: 'pf_saved_' + NS
  };

  var STATUS = {
    pending:  { label: '待核实', cls: 'is-pending' },
    checking: { label: '核实中', cls: 'is-checking' },
    needinfo: { label: '还需要补充信息', cls: 'is-needinfo' },
    ready:    { label: '已核实，准备办理', cls: 'is-ready' },
    done:     { label: '已核实，暂不办理或已处理', cls: 'is-done' }
  };
  var ORDER = ['pending', 'checking', 'needinfo', 'ready', 'done'];
  var VERIFIED = { ready: true, done: true };
  var HINT = {
    pending: '先确认政策条件，再通过官方渠道咨询核实。',
    checking: '已联系官方、等待答复期间无需重复咨询，有进展可随时更新。',
    needinfo: '还有信息待补充，补齐后再向官方渠道确认一次。',
    ready: '可按官方指引准备办理；出发前记得确认材料、时间与预约要求。',
    done: '已处理或暂不办理，历史记录会保留，可随时调整。'
  };

  /* ---------------- 存储层：一律安全降级 ---------------- */
  function readJSON(key, fallback) {
    try {
      var raw = sessionStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ---------------- 当前查询对象 ---------------- */
  function session() {
    try {
      var s = (typeof store !== 'undefined' && store.read) ? store.read() : {};
      return s && typeof s === 'object' ? s : {};
    } catch (e) { return {}; }
  }
  /* 受益人键：家庭模式用受益人名义；本人模式固定 self。
     家庭 / 本人两种模式因此天然隔离，不会互相覆盖记录。 */
  function benKey() {
    var s = session();
    var ben = s.beneficiary ? String(s.beneficiary).trim() : '';
    if (!ben) return 'self';
    var mode = s.lastQuery || '';
    if (mode === 'self') return 'self';
    return ben;
  }
  function benLabel() {
    var s = session();
    var ben = s.beneficiary ? String(s.beneficiary) : '';
    var key = benKey();
    if (key === 'self') return '本人';
    if (ben) return (s.operator ? s.operator + ' → ' + ben : ben);
    return '本人';
  }

  /* ---------------- 记录读写 ---------------- */
  function loadRecords() {
    var arr = readJSON(K.records, []);
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (r) { return r && r.pid && r.benKey; });
  }
  function saveRecords(arr) { writeJSON(K.records, arr); }
  function findRecord(arr, pid) {
    var ben = benKey();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].pid === pid && arr[i].benKey === ben) return arr[i];
    }
    return null;
  }
  /* 详情页的「打算去核实」标记：键里带查询对象，换人后不会串到别的受益人名下 */
  function markKey(pid) { return K.mark + pid + '@' + benKey(); }
  function selectedIds() {
    var ids = [];
    var suffix = '@' + benKey();
    try {
      for (var i = 0; i < sessionStorage.length; i++) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf(K.mark) === 0 && k.length > suffix.length
            && k.slice(k.length - suffix.length) === suffix
            && sessionStorage.getItem(k) === 'verify') {
          ids.push(k.slice(K.mark.length, k.length - suffix.length));
        }
      }
    } catch (e) { /* 隐私模式忽略 */ }
    return ids;
  }
  function isSelected(pid) {
    try { return sessionStorage.getItem(markKey(pid)) === 'verify'; } catch (e) { return false; }
  }
  function setSelected(pid, on) {
    try {
      if (on) sessionStorage.setItem(markKey(pid), 'verify');
      else sessionStorage.removeItem(markKey(pid));
      return true;
    } catch (e) { return false; }
  }
  /* 「打算去核实」开关：同一政策重复点击不会产生重复条目 */
  function toggleSelected(pid, pname, dept, url) {
    var on = !isSelected(pid);
    setSelected(pid, on);
    if (on) ensureRecord(pid, pname, dept, url);
    else removeFromList(pid);
    return on;
  }
  /* 清单条目：已标记 verify 且未被移出清单；没有记录的补占位条目 */
  function listRecords() {
    var arr = loadRecords();
    var out = [];
    selectedIds().forEach(function (pid) {
      var rec = findRecord(arr, pid);
      if (rec && rec.listRemoved) {
        /* 详情页又重新选择了「打算去核实」→ 恢复进清单，历史不动 */
        rec.listRemoved = false;
        rec.updatedAt = Date.now();
        saveRecords(arr);
      }
      out.push(rec || { pid: pid, benKey: benKey(), status: 'pending', note: '', next: '', noRecord: true });
    });
    return out;
  }
  function ensureRecord(pid, pname, dept, url) {
    var arr = loadRecords();
    var rec = findRecord(arr, pid);
    if (!rec) {
      rec = {
        rid: pid + '|' + benKey(), pid: pid, benKey: benKey(), ben: benLabel(),
        pname: pname || '', dept: dept || '', url: url || '',
        status: 'pending', note: '', next: '', listRemoved: false,
        createdAt: Date.now(), updatedAt: Date.now(),
        history: [{ ts: Date.now(), status: 'pending', note: '', next: '' }]
      };
      arr.push(rec);
      saveRecords(arr);
    } else {
      var changed = false;
      if (!rec.pname && pname) { rec.pname = pname; changed = true; }
      if (!rec.dept && dept) { rec.dept = dept; changed = true; }
      if (!rec.url && url) { rec.url = url; changed = true; }
      if (changed) { rec.updatedAt = Date.now(); saveRecords(arr); }
    }
    return rec;
  }
  /* 更新状态：写当前值 + 追加一条历史，历史永不覆盖 */
  function updateRecord(pid, pname, dept, url, status, note, next) {
    var arr = loadRecords();
    var rec = findRecord(arr, pid);
    if (!rec) {
      rec = {
        rid: pid + '|' + benKey(), pid: pid, benKey: benKey(), ben: benLabel(),
        pname: pname || '', dept: dept || '', url: url || '',
        status: 'pending', note: '', next: '', listRemoved: false,
        createdAt: Date.now(), updatedAt: Date.now(), history: []
      };
      arr.push(rec);
    }
    rec.pname = rec.pname || pname || '';
    rec.dept = rec.dept || dept || '';
    rec.url = rec.url || url || '';
    rec.status = STATUS[status] ? status : rec.status;
    rec.note = String(note || '').slice(0, 300);
    rec.next = String(next || '').slice(0, 120);
    rec.updatedAt = Date.now();
    rec.listRemoved = false;
    rec.history.push({ ts: rec.updatedAt, status: rec.status, note: rec.note, next: rec.next });
    saveRecords(arr);
    return rec;
  }
  /* 只从清单移除：清标记 + 打 listRemoved；核实历史保留 */
  function removeFromList(pid) {
    setSelected(pid, false);
    var arr = loadRecords();
    var rec = findRecord(arr, pid);
    if (rec) { rec.listRemoved = true; rec.updatedAt = Date.now(); saveRecords(arr); }
  }
  /* 删除记录：仅「核实记录」页两次确认后调用 */
  function deleteRecord(pid) {
    var ben = benKey();
    saveRecords(loadRecords().filter(function (r) { return !(r.pid === pid && r.benKey === ben); }));
  }
  /* 当前受益人的全部记录（含已移出清单的），按更新时间倒序 */
  function recordsOf(ben) {
    var key = ben || benKey();
    return loadRecords()
      .filter(function (r) { return r.benKey === key; })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  /* ---------------- 出发前准备 ---------------- */
  function loadPrep() {
    var o = readJSON(K.prep, {});
    if (!o || typeof o !== 'object') o = {};
    return { p1: !!o.p1, p2: !!o.p2, p3: !!o.p3, p4: !!o.p4 };
  }
  function savePrep(p) {
    var cur = loadPrep();
    var next = { p1: !!p.p1, p2: !!p.p2, p3: !!p.p3, p4: !!p.p4 };
    writeJSON(K.prep, next);
    return next;
  }
  function prepCount(p) {
    var o = p || loadPrep();
    var n = 0;
    ['p1', 'p2', 'p3', 'p4'].forEach(function (k) { if (o[k]) n++; });
    return n;
  }
  /* 是否已经真的开始计划：只认准备勾选、状态、备注或多次历史，不靠「已选政策」冒充进度 */
  function hasPlanProgress() {
    if (prepCount() > 0) return true;
    var arr = loadRecords();
    var ben = benKey();
    return selectedIds().some(function (pid) {
      var rec = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].pid === pid && arr[i].benKey === ben) { rec = arr[i]; break; }
      }
      return !!rec && (rec.status !== 'pending' || !!rec.note || !!rec.next
        || (Array.isArray(rec.history) && rec.history.length > 1));
    });
  }

  /* ---------------- 统计（我的服务 / 主页面共用口径） ---------------- */
  function serviceStats(ben) {
    var items = listRecords();
    var total = items.length;
    var verified = items.filter(function (it) { return VERIFIED[it.status]; }).length;
    var pending = total - verified;
    var recCount = recordsOf(ben).length;
    return {
      total: total, verified: verified, pending: pending,
      percent: total > 0 ? Math.round(verified / total * 100) : 0,
      recordCount: recCount,
      hasPlan: hasPlanProgress()
    };
  }

  /* ---------------- 少跑腿计划：按真实责任部门组织 ---------------- */
  var DEPT_MISSING = '责任部门未标注';
  function deptOf(item) {
    var d = String((item && item.dept) || '').trim();
    return d && d.indexOf(DEPT_MISSING) === -1 ? d : '';
  }
  /**
   * 主责部门：责任部门一栏常写「A局 B局 C委」多个单位，
   * 归组与「能否一次问清」只看第一家（主责），展示仍保留全量部门。
   */
  function primaryDept(raw) {
    var s = String(raw || '').replace(/[、，,;；/]+/g, ' ').trim();
    if (!s || s.indexOf(DEPT_MISSING) !== -1) return '';
    var parts = s.split(/\s+/).filter(Boolean);
    return parts.length ? parts[0] : '';
  }
  /**
   * 生成计划分组。
   * rules:
   *  - 只按正式政策库里的责任部门分组，部门缺失/占位一律不参与合并（不推断主管部门）
   *  - 同一部门 >= 2 项才提示「可尝试一并咨询」
   *  - 不同部门绝不合并
   */
  function planGroups(items) {
    var actionable = (items || []).filter(function (it) { return it.status !== 'done'; });
    var byDept = {};
    actionable.forEach(function (it) {
      var d = primaryDept(deptOf(it));
      if (!d) return;
      (byDept[d] = byDept[d] || []).push(it);
    });
    var merged = Object.keys(byDept).map(function (d) {
      return { dept: d, items: byDept[d] };
    }).filter(function (g) { return g.items.length >= 2; });
    var ungrouped = actionable.filter(function (it) { return !deptOf(it); });
    return {
      actionableCount: actionable.length,
      merged: merged,
      mergedCount: merged.reduce(function (n, g) { return n + g.items.length; }, 0),
      ungroupedDept: ungrouped,
      distinctDepts: Object.keys(byDept).length
    };
  }

  /* ---------------- 详情批量拉取（清单/计划/记录共用） ---------------- */
  function fetchDetails(pids) {
    var map = {};
    var list = (pids || []).filter(Boolean);
    return Promise.all(list.map(function (pid) {
      return Promise.resolve()
        .then(function () { return API.policy(pid); })
        .then(function (d) { if (d && !d.error && d.policy_id) map[pid] = d; })
        .catch(function () { /* 单条失败不影响其他 */ });
    })).then(function () { return map; });
  }
  /* 把接口详情合并进清单条目（政策名/部门/来源链接以正式政策库为准） */
  function mergeDetail(item, d) {
    var detail = d || {};
    var pname = detail.policy_name || item.pname || '';
    var dept = (detail.source && detail.source.department) || item.dept || '';
    var url = (detail.source && detail.source.official_url) || item.url || '';
    var rec = item.noRecord ? ensureRecord(item.pid, pname, dept, url) : item;
    return {
      pid: item.pid, pname: pname, dept: dept, url: url,
      region: detail.region || '',
      status: rec.status || 'pending', note: rec.note || '', next: rec.next || ''
    };
  }

  /* ---------------- 时间格式 ---------------- */
  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleString('zh-CN',
        { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  /* ---------------- 头像角色判定（A/B 同一套规则） ----------------
     只按「已选关系」白名单映射，不猜姓名、不按年龄推断。 */
  var AVATAR_SRC = {
    'elder-male': 'assets/avatars/elder-male.png',
    'elder-female': 'assets/avatars/elder-female.png',
    'adult-male': 'assets/avatars/adult-male.png',
    'adult-female': 'assets/avatars/adult-female.png',
    'couple': 'assets/avatars/couple.png',
    'self': 'assets/avatars/self.png',
    'worker': 'assets/avatars/worker.png',
    'other': 'assets/avatars/other.png',
    'neutral': 'assets/avatars/neutral.png'
  };
  var AVA_MALE = ['父亲', '爸爸', '爷爷', '外公', '姥爷'];
  var AVA_FEMALE = ['母亲', '妈妈', '奶奶', '外婆', '姥姥'];
  var AVA_COUPLE = ['配偶', '老伴'];
  var AVA_WORKER = ['社区工作人员', '工作人员'];
  function avatarRole(name, mode) {
    if (mode === 'self') return 'self';
    var n = String(name || '').trim();
    if (!n) return 'neutral';
    if (AVA_COUPLE.indexOf(n) !== -1) return 'couple';
    if (AVA_WORKER.indexOf(n) !== -1) return 'worker';
    if (AVA_MALE.indexOf(n) !== -1) return 'elder-male';
    if (AVA_FEMALE.indexOf(n) !== -1) return 'elder-female';
    return 'neutral';
  }

  /* ---------------- 状态更新弹层（中性标记 + 皮肤分别上色） ----------------
     三个服务页共用同一套逻辑：A/B 只换 CSS，不换行为。 */
  function q(id) { return document.getElementById(id); }
  function mountSheet() {
    if (q('pfvSheet')) return;
    var mask = document.createElement('div');
    mask.id = 'pfvMask'; mask.className = 'pfv-mask';
    var sheet = document.createElement('section');
    sheet.id = 'pfvSheet'; sheet.className = 'pfv-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'pfvTitle');
    sheet.tabIndex = -1;
    sheet.innerHTML =
      '<div class="pfv-sheet-head"><h2 id="pfvTitle">更新核实状态</h2>'
      + '<button type="button" class="pfv-x" data-pfv="close" aria-label="关闭">✕</button></div>'
      + '<div class="pfv-sheet-body">'
      + '<p class="pfv-sheet-policy" id="pfvPolicy"></p>'
      + '<div class="pfv-flabel" id="pfvStatusLb">当前状态</div>'
      + '<div class="pfv-opts" id="pfvOpts" role="radiogroup" aria-labelledby="pfvStatusLb"></div>'
      + '<label class="pfv-flabel" for="pfvNote">官方答复或核实备注 <span class="pfv-opt-tag">（选填）</span></label>'
      + '<textarea id="pfvNote" rows="3" maxlength="300" placeholder="例如：通过官方渠道了解到的情况，方便以后查看"></textarea>'
      + '<label class="pfv-flabel" for="pfvNext">接下来要做什么 <span class="pfv-opt-tag">（选填）</span></label>'
      + '<input type="text" id="pfvNext" maxlength="120" placeholder="例如：先确认需要带哪些材料">'
      + '<p class="pfv-sheet-note">您的记录只保存在本设备，不提交给任何部门；记录不构成官方确认。</p>'
      + '</div>'
      + '<div class="pfv-sheet-foot"><button type="button" class="pfv-save" data-pfv="save">保存</button></div>';
    document.body.appendChild(mask);
    document.body.appendChild(sheet);
    mask.addEventListener('click', closeSheet);
    sheet.querySelector('[data-pfv="close"]').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('is-open')) closeSheet();
    });
    sheet.querySelector('[data-pfv="save"]').addEventListener('click', function () {
      var ctx = sheet._pfvCtx;
      if (!ctx) return;
      var sel = sheet.querySelector('input[name="pfv-status"]:checked');
      var status = sel ? sel.value : ctx.status;
      updateRecord(ctx.pid, ctx.pname, ctx.dept, ctx.url, status,
        q('pfvNote').value, q('pfvNext').value);
      closeSheet();
      if (typeof showToast === 'function') showToast('已保存，相关页面已同步');
      if (typeof sheet._pfvOnSaved === 'function') sheet._pfvOnSaved();
    });
  }
  function openSheet(item, onSaved) {
    if (!item) return;
    mountSheet();
    var sheet = q('pfvSheet');
    sheet._pfvCtx = item;
    sheet._pfvOnSaved = onSaved || null;
    var pEl = q('pfvPolicy');
    pEl.innerHTML = '正在更新：<b></b>';
    pEl.querySelector('b').textContent = item.pname || item.pid;
    q('pfvOpts').innerHTML = ORDER.map(function (k) {
      var cur = item.status === k;
      return '<label class="pfv-opt"><input type="radio" name="pfv-status" value="' + k + '"'
        + (cur ? ' checked' : '') + '>'
        + '<span class="pfv-dot" aria-hidden="true"></span>'
        + '<span class="pfv-o">' + escapeHtml(STATUS[k].label) + '</span></label>';
    }).join('');
    q('pfvNote').value = item.note || '';
    q('pfvNext').value = item.next || '';
    q('pfvMask').classList.add('is-open');
    sheet.classList.add('is-open');
    document.body.classList.add('no-scroll');
    sheet.focus();
  }
  function closeSheet() {
    var mask = q('pfvMask');
    var sheet = q('pfvSheet');
    if (mask) mask.classList.remove('is-open');
    if (sheet) sheet.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
  }

  /* ---------------- 状态胶囊（中性类名，皮肤只改外观） ---------------- */
  function statusPill(status) {
    var m = STATUS[status] || STATUS.pending;
    return '<span class="pfv-pill ' + m.cls + '">' + escapeHtml(m.label) + '</span>';
  }

  global.PFServices = {
    NS: NS, K: K,
    STATUS: STATUS, ORDER: ORDER, VERIFIED: VERIFIED, HINT: HINT,
    benKey: benKey, benLabel: benLabel,
    loadRecords: loadRecords, saveRecords: saveRecords, findRecord: findRecord,
    recordsOf: recordsOf,
    selectedIds: selectedIds, isSelected: isSelected, setSelected: setSelected, markKey: markKey,
    toggleSelected: toggleSelected, listRecords: listRecords,
    ensureRecord: ensureRecord, updateRecord: updateRecord,
    removeFromList: removeFromList, deleteRecord: deleteRecord,
    loadPrep: loadPrep, savePrep: savePrep, prepCount: prepCount, hasPlanProgress: hasPlanProgress,
    serviceStats: serviceStats, planGroups: planGroups, deptOf: deptOf, primaryDept: primaryDept,
    fetchDetails: fetchDetails, mergeDetail: mergeDetail,
    fmtTime: fmtTime,
    AVATAR_SRC: AVATAR_SRC, avatarRole: avatarRole,
    mountSheet: mountSheet, openSheet: openSheet, closeSheet: closeSheet,
    statusPill: statusPill
  };

  /* 同时暴露扁平别名，页面脚本可直接调用（A/B 同一套名字） */
  global.VSTATUS = STATUS;
  global.VORDER = ORDER;
  global.VERIFIED_SET = VERIFIED;
  global.VHINT = HINT;
  global.vBenKey = benKey;
  global.vBenLabel = benLabel;
  global.vLoadRecords = loadRecords;
  global.vSaveRecords = saveRecords;
  global.vFindRecord = findRecord;
  global.vListRecords = listRecords;
  global.vSelectedIds = selectedIds;
  global.pfMarkKey = markKey;
  global.vEnsureRecord = ensureRecord;
  global.vUpdateRecord = updateRecord;
  global.vRemoveFromList = removeFromList;
  global.vDeleteRecord = deleteRecord;
  global.vLoadPrep = loadPrep;
  global.vSavePrep = savePrep;
  global.vHasPlanProgress = hasPlanProgress;
  global.vStatusPill = statusPill;
  global.vFetchDetails = fetchDetails;
  global.mergeDetail = mergeDetail;
  global.vDeptOf = deptOf;
  global.vPrimaryDept = primaryDept;
  global.vPlanGroups = planGroups;
  global.vPrepCount = prepCount;
  global.vServiceStats = serviceStats;
  global.vFmtTime = fmtTime;
  global.vAvatarRole = avatarRole;
  global.vHasPlanProgress = hasPlanProgress;
  global.mountVerifySheet = mountSheet;
  global.openVerifySheet = openSheet;
  global.closeVerifySheet = closeSheet;
  global.pfAvatarRole = avatarRole;
  global.PF_AVATAR_SRC = AVATAR_SRC;
})(typeof window !== 'undefined' ? window : this);
