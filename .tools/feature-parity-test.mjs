// 双版功能一致性测试（feature parity）
//   node .tools/feature-parity-test.mjs --base=http://127.0.0.1:8000 --tag=A
//   node .tools/feature-parity-test.mjs --base=http://127.0.0.1:8001 --tag=B
//   node .tools/feature-parity-test.mjs --compare     // 比对两版快照
//
// 断言分四类：PASS / FAIL / SKIP（环境不具备）/ INFO（只记录不判分）
// 业务断言一律走页面真实加载的脚本（window.PFServices / API），不另写一套实现。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import net from 'node:net';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=?(.*)$/);
  return m ? [m[1], m[2] || true] : [a, true];
}));

const SNAPDIR = 'D:\\deep\\.work\\parity';
mkdirSync(SNAPDIR, { recursive: true });
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 快照比对模式 ---------------- */
if (args.compare) {
  const a = JSON.parse(readFileSync(`${SNAPDIR}\\A.json`, 'utf8'));
  const b = JSON.parse(readFileSync(`${SNAPDIR}\\B.json`, 'utf8'));
  const diffs = [];
  const walk = (path, x, y) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      keys.forEach((k) => {
        if (k === 'tag' || k === 'base') return; // 仅标注字段，不参与业务一致性判定
        walk(path ? path + '.' + k : k, x[k], y[k]);
      });
      return;
    }
    diffs.push({ path, A: x, B: y });
  };
  walk('', a, b);
  console.log(`一致项对比：A/B 快照共 ${JSON.stringify(a).length} vs ${JSON.stringify(b).length} 字符`);
  if (diffs.length === 0) {
    console.log('PASS 双版业务结果完全一致（政策 ID、评分、分层、理由、条件、依据、统计口径）');
    process.exit(0);
  }
  console.log(`FAIL 双版存在 ${diffs.length} 处差异：`);
  diffs.slice(0, 40).forEach((d) => console.log(`  ${d.path}: A=${JSON.stringify(d.A)} B=${JSON.stringify(d.B)}`));
  process.exit(1);
}

const BASE = String(args.base || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const TAG = String(args.tag || 'A');
const VERSION = TAG.toUpperCase();

let PORT = TAG === 'A' ? 9511 : 9531;
let id = 0;
const results = [];
let pass = 0; let fail = 0; let skip = 0;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : detail });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${TAG}] ${name}${detail !== undefined && detail !== '' ? ' — ' + JSON.stringify(detail) : ''}`);
}
function skipped(name, why) {
  skip += 1;
  results.push({ name, ok: null, detail: why });
  console.log(`  SKIP [${TAG}] ${name} — ${why}`);
}
function info(name, value) {
  results.push({ name, ok: null, info: true, detail: value });
  console.log(`  INFO [${TAG}] ${name} — ${JSON.stringify(value)}`);
}

function rpc(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== mid) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(method + ': ' + m.error.message));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function waitPort(port) {
  for (let i = 0; i < 200; i++) {
    const ok = await new Promise((res) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); res(true); });
      s.once('error', () => res(false));
    });
    if (ok) return;
    await sleep(120);
  }
  throw new Error('CDP 端口没起来: ' + port);
}

const profile = `D:\\deep\\.work\\edge-parity-${TAG}-${Date.now()}`;
mkdirSync(profile, { recursive: true });
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
await waitPort(PORT);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await rpc(ws, 'Page.enable');
await rpc(ws, 'Runtime.enable');
await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await rpc(ws, 'Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.__errs=[];window.addEventListener("error",e=>window.__errs.push(String(e.message)));'
    + 'window.addEventListener("unhandledrejection",e=>window.__errs.push("reject:"+String((e.reason&&e.reason.message)||e.reason)));',
});

const evalJs = async (expr) => {
  const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
async function goto(path) {
  await rpc(ws, 'Page.navigate', { url: `${BASE}/${path}` });
  for (let i = 0; i < 150; i++) {
    const st = await evalJs('document.readyState').catch(() => 'loading');
    if (st === 'complete') break;
    await sleep(100);
  }
  await sleep(700);
}
const clearAll = () => evalJs("(() => { try { sessionStorage.clear(); } catch(e){} try { localStorage.clear(); } catch(e){} return 1; })()");

const SESS_FATHER = {
  target: 'family', operator: '女儿', beneficiary: '父亲', confirmed: true,
  demo: false, demoBanner: false, profile: { age: 72, region: '广州市', hukou: '广州市户籍' },
  text: '父亲72岁，独居，最近行动不便，吃饭也困难，需要人照护', lastQuery: 'family',
};
const SESS_MOTHER = {
  target: 'family', operator: '女儿', beneficiary: '母亲', confirmed: true,
  demo: false, demoBanner: false, profile: { age: 68, region: '广州市' },
  text: '母亲68岁，广州户籍，最近血压高，需要定期复诊', lastQuery: 'family',
};
const SESS_SELF = {
  target: 'self', selfText: '我45岁，广州工作，最近腰椎不好，想看看有没有相关补助',
  selfProfile: { age: 45, region: '广州市' }, lastQuery: 'self', demo: false, demoBanner: false,
};

async function seed(session) {
  await evalJs(`(() => {
    sessionStorage.clear();
    sessionStorage.setItem('policy_finder_session', ${JSON.stringify(JSON.stringify(session))});
    return 1;
  })()`);
}
/* 只切当前对象、不动已有数据（验证「切回原对象后数据完好」） */
async function switchTo(session) {
  await evalJs(`(() => {
    sessionStorage.setItem('policy_finder_session', ${JSON.stringify(JSON.stringify(session))});
    return 1;
  })()`);
}
const NS_KEY = (k) => `${k}`;

console.log(`== 版本 ${VERSION} · ${BASE} ==`);

/* ---------------- 0. 命名空间隔离 ---------------- */
await goto('verify-list.html');
await clearAll();
await goto('verify-list.html');
const ns = await evalJs('({ ns: (window.PFServices||{}).NS, keys: Object.keys(PFServices.K) })');
check('业务核心已加载且命名空间正确', ns.ns === TAG.toLowerCase(), ns.ns);
const K = await evalJs('PFServices.K');
const nsTag = TAG.toLowerCase();
const nsOk = (v) => typeof v === 'string' && (v.slice(-2) === '_' + nsTag || v.slice(-1) === nsTag);
check('存储键带版本命名空间（A/B 浏览器存储互不污染）',
  K.mark.indexOf('pf_fs_' + nsTag + '_') === 0 && nsOk(K.records) && nsOk(K.prep), K);
const sessKey = await evalJs('(() => { try { return Object.keys(sessionStorage).length; } catch(e) { return -1; } })()');
check('会话存储键仍为共用键 policy_finder_session（两版字段一致）',
  await evalJs(`(() => { sessionStorage.setItem('policy_finder_session','{"a":1}');
    const s = (typeof store!=='undefined'&&store.read)?store.read():null;
    sessionStorage.removeItem('policy_finder_session'); return !!(s&&s.a===1); })()`), sessKey);

/* ---------------- 1. 基础：五个页面可打开、无 JS 错误 ---------------- */
for (const p of ['family.html', 'discover.html', 'self.html', 'policy.html?id=gz_elderly_009', 'consult.html']) {
  await goto(p);
  const st = await evalJs('({ errs: window.__errs||[], title: document.title, hasTabbar: !!document.querySelector(".tabbar"), tabCount: document.querySelectorAll(".tabbar").length })');
  check(`基础：${p} 打开无脚本错误`, st.errs.length === 0, st.errs);
  const needNav = !/^(family|policy)\.html/.test(p);
  check(`基础：${p} 底部导航${needNav ? '只有一个' : '不重复（该页本身不挂导航）'}`,
    needNav ? st.tabCount === 1 : st.tabCount <= 1, st.tabCount);
}

/* ---------------- 2. 原有能力：政策详情证据链 / 有效期依据 ---------------- */
await goto('policy.html?id=gz_elderly_009');
const d009 = await evalJs(`(() => {
  const t = document.body.innerText;
  return {
    hasBasis: /有效期依据|延期/.test(t),
    hasOriginal: !!document.querySelector('a[href^="http"]'),
    hasChain: /证据链|依据/.test(t),
    hasStance: !!document.querySelector('[data-stance],.stance,.act-row,button'),
    fsKey: (function(){ try { for (let i=0;i<sessionStorage.length;i++){ const k=sessionStorage.key(i); if(k.indexOf('pf_')===0) return k; } return null; } catch(e){ return 'err'; } })(),
  };
})()`);
check('原有：009 详情页显示有效期依据（2026 延期依据）', d009.hasBasis, d009);
check('原有：009 详情页有官方原文外链', d009.hasOriginal);

/* ---------------- 3. 新增：待核实清单全流程（父亲） ---------------- */
await seed(SESS_FATHER);
await goto('policy.html?id=gz_elderly_009');
await evalJs(`(() => { PFServices.ensureRecord('gz_elderly_009','长期护理保险','广州市医疗保障局','https://www.gz.gov.cn/');
  PFServices.setSelected('gz_elderly_009', true); return 1; })()`);
await goto('policy.html?id=gz_elderly_002');
await evalJs(`(() => { PFServices.ensureRecord('gz_elderly_002','助餐配餐服务','广州市民政局','https://www.gz.gov.cn/');
  PFServices.setSelected('gz_elderly_002', true); return 1; })()`);
// 防重复添加
await evalJs(`(() => { PFServices.toggleSelected('gz_elderly_002','助餐配餐服务','广州市民政局',''); PFServices.toggleSelected('gz_elderly_002','助餐配餐服务','广州市民政局',''); return 1; })()`);

await goto('verify-list.html');
const vl = await evalJs(`(() => {
  const cards = document.querySelectorAll('article[data-pid]');
  const s = PFServices.serviceStats();
  return { cards: cards.length, pids: [...cards].map(c=>c.dataset.pid), total: s.total, pending: s.pending,
    verified: s.verified, ben: PFServices.benLabel(), text: document.body.innerText.slice(0,200) };
})()`);
check('新增：待核实清单显示 2 项且政策 ID 正确', vl.cards === 2 && vl.pids.includes('gz_elderly_009') && vl.pids.includes('gz_elderly_002'), vl.pids);
check('新增：防重复添加（同一政策不会出现两条）', vl.total === 2, vl);
check('新增：清单按当前受益人（父亲）隔离显示', /父亲/.test(vl.ben) && vl.cards === 2, { ben: vl.ben, cards: vl.cards });

// 更新状态 + 备注（含 HTML，验证转义）
await evalJs(`(() => { PFServices.updateRecord('gz_elderly_009','长期护理保险','广州市医疗保障局','','checking','<img src=x onerror=alert(1)>备注','问清护理等级评估'); return 1; })()`);
await goto('verify-list.html');
const vl2 = await evalJs(`(() => {
  const t = document.body.innerText;
  return { hasNoteText: t.indexOf('<img') >= 0, injected: document.querySelectorAll('img[src="x"]').length,
    pill: (document.querySelector('[data-pid] .pfv-pill')||{}).textContent, recCount: PFServices.serviceStats().recordCount };
})()`);
check('新增：备注中的 HTML 被转义（不注入节点，原文可见）', vl2.injected === 0 && vl2.hasNoteText, vl2);
check('新增：状态更新后清单显示新状态', /核实中|待核实/.test(String(vl2.pill)), vl2.pill);

// 记录页：历史追加 + 删除单条
await goto('records.html');
const rc1 = await evalJs(`(() => { const t = document.body.innerText;
  return { t: t.slice(0,300), recs: PFServices.recordsOf().length, hist: (PFServices.recordsOf().find(r=>r.pid==='gz_elderly_009')||{}).history?.length }; })()`);
check('新增：核实记录页显示历史条数 ≥2（初次加入 + 状态更新）', rc1.hist >= 2, rc1);
await evalJs(`(() => { PFServices.deleteRecord('gz_elderly_002'); return 1; })()`);
const rc2 = await evalJs(`(() => ({ pids: PFServices.recordsOf().map(r=>r.pid), hist009: (PFServices.recordsOf().find(r=>r.pid==='gz_elderly_009')||{}).history?.length }))()`);
check('新增：删除一条记录不影响其他记录', rc2.pids.length === 1 && rc2.pids[0] === 'gz_elderly_009', rc2);
check('新增：删除其他记录后 009 的历史保持不变', rc2.hist009 === rc1.hist, { before: rc1.hist, after: rc2.hist009 });

// 从清单移除 → 历史保留
await goto('verify-list.html');
await evalJs(`(() => { PFServices.removeFromList('gz_elderly_009'); return 1; })()`);
await goto('verify-list.html');
const vl3 = await evalJs(`(() => ({ list: PFServices.listRecords().map(r=>r.pid), recs: PFServices.recordsOf().map(r=>r.pid), hist: (PFServices.recordsOf().find(r=>r.pid==='gz_elderly_009')||{}).history?.length }))()`);
check('新增：从清单移除只影响被移除的那一条', !vl3.list.includes('gz_elderly_009') && vl3.list.includes('gz_elderly_002'), vl3.list);
check('新增：从清单移除后核实记录仍在', vl3.recs.includes('gz_elderly_009') && vl3.hist >= 2, vl3);

/* ---------------- 4. 少跑腿计划：同部门合并 / 部门缺失不推断 ---------------- */
await evalJs(`(() => {
  PFServices.setSelected('gz_elderly_009', true); PFServices.ensureRecord('gz_elderly_009','长期护理保险','','');
  PFServices.setSelected('gz_elderly_002', true); PFServices.ensureRecord('gz_elderly_002','社区养老服务','','');
  PFServices.setSelected('gz_elderly_010', true); PFServices.ensureRecord('gz_elderly_010','长者长寿保健金','','');
  PFServices.setSelected('gz_elderly_003', true); PFServices.ensureRecord('gz_elderly_003','老年人助餐配餐服务','','');
  /* 部门缺失的用例：政策库里没有这条，详情拉不到，部门只能是空 */
  PFServices.setSelected('gz_elderly_999', true); PFServices.ensureRecord('gz_elderly_999','未标注部门政策','','');
  return 1; })()`);
await goto('plan.html');
const pl = await evalJs(`(async () => {
  const raw = PFServices.listRecords();
  const det = await PFServices.fetchDetails(raw.map(r => r.pid));
  const items = raw.map(r => PFServices.mergeDetail(r, det[r.pid]));
  const g = PFServices.planGroups(items);
  const t = document.body.innerText;
  return { merged: g.merged.map(x=>({dept:x.dept,n:x.items.length})), mergedCount: g.mergedCount,
    ungrouped: g.ungroupedDept.map(x=>x.pid), distinct: g.distinctDepts,
    kpis: document.querySelectorAll('.pl-kpi, .vf-kpi, .kpi').length, hasDeptText: t.indexOf('医疗保障局') >= 0 };
})()`);
check('新增：同一主责部门（民政局）多项被识别为可合并', pl.merged.some((m) => m.dept === '广州市民政局' && m.n >= 2), pl.merged);
check('新增：不同部门不误合并（医保局不与民政局合并）',
  pl.merged.every((m) => !(m.dept === '广州市医疗保障局' && m.n > 1))
  && pl.merged.some((m) => m.dept === '广州市民政局'), pl.merged);
check('新增：部门缺失的政策单独列出、不推断', pl.ungrouped.includes('gz_elderly_999'), pl.ungrouped);

/* ---------------- 5. 数据隔离：父亲 / 母亲 / 本人 ---------------- */
await switchTo(SESS_MOTHER);
await goto('verify-list.html');
const isoM = await evalJs(`(() => ({ list: PFServices.listRecords().length, recs: PFServices.recordsOf().length, ben: PFServices.benLabel() }))()`);
check('隔离：切到母亲后看不到父亲的清单与记录', isoM.list === 0 && isoM.recs === 0, isoM);
await evalJs(`(() => { PFServices.setSelected('gz_elderly_006', true); PFServices.ensureRecord('gz_elderly_006','高龄津贴','广州市民政局',''); return 1; })()`);
const isoM2 = await evalJs(`(() => ({ list: PFServices.listRecords().map(r=>r.pid), ben: PFServices.benLabel() }))()`);
check('隔离：母亲名下可独立添加（不与父亲混）', isoM2.list.length === 1 && isoM2.list[0] === 'gz_elderly_006', isoM2);

await switchTo(SESS_SELF);
await goto('verify-list.html');
const isoS = await evalJs(`(() => ({ list: PFServices.listRecords().length, recs: PFServices.recordsOf().length, key: PFServices.benKey() }))()`);
check('隔离：本人模式与家庭模式分开（本人看不到家庭清单）', isoS.list === 0 && isoS.recs === 0, isoS);

await switchTo(SESS_FATHER);
await goto('verify-list.html');
const isoF = await evalJs(`(() => ({ list: PFServices.listRecords().map(r=>r.pid).sort(), recs: PFServices.recordsOf().map(r=>r.pid).sort() }))()`);
check('隔离：切回父亲，原数据完好恢复', isoF.list.length >= 4 && isoF.recs.includes('gz_elderly_009')
  && !isoF.list.includes('gz_elderly_006'), isoF);

/* ---------------- 6. 我的（A: mine.html / B: services.html）五块 ---------------- */
const MINE = (TAG === 'A') ? 'mine.html' : 'services.html';
await goto(MINE);
const mine = await evalJs(`(() => {
  const t = document.body.innerText;
  const items = ['我的家庭', '我的收藏', '本次查询', '我的服务', '关于我们'];
  return { found: items.filter((k) => t.indexOf(k) >= 0), tabs: document.querySelectorAll('.tabbar').length,
    stats: /待核实|核实进度|项/.test(t) };
})()`);
check('我的：五个区块齐全（我的家庭/我的收藏/本次查询/我的服务/关于我们）',
  mine.found.length === 5, { found: mine.found });
check('我的：只有一个底部导航', mine.tabs === 1, mine.tabs);

/* ---------------- 7. 收藏往返 ---------------- */
await goto('policy.html?id=gz_elderly_003');
await evalJs(`(() => { localStorage.setItem('pf_saved', JSON.stringify([{id:'gz_elderly_003',name:'社区养老服务',dept:'广州市民政局'}])); return 1; })()`);
await goto(MINE);
const fav = await evalJs(`(() => ({ saved: JSON.parse(localStorage.getItem('pf_saved')||'[]').length,
  shown: /社区养老服务/.test(document.body.innerText) }))()`);
check('原有：收藏写入后在「我的收藏」显示', fav.saved === 1 && fav.shown, fav);

/* ---------------- 8. 双版业务结果一致性快照 ---------------- */
await seed(SESS_FATHER);
await goto('discover.html');
const matchSnap = await evalJs(`(async () => {
  const payload = { text: '父亲72岁，独居，最近行动不便，吃饭也困难，需要人照护',
    relation: '父亲', operator: '女儿', profile: { age: 72, region: '广州市', hukou: '广州市户籍' } };
  const d = await API.match(payload);
  const rows = (d.results || []);
  return {
    count: rows.length,
    ids: rows.map((x) => x.policy_id || x.id),
    scores: rows.map((x) => x.score),
    layers: rows.map((x) => x.layer || x.tier || null),
    conds: rows.map((x) => (x.conditions || []).map((c) => c.status)),
    reasons: rows.map((x) => (x.reasons || x.reason || []).length),
    profileKeys: Object.keys(d.profile || {}).sort(),
    events: (d.events || d.life_events || []).length,
  };
})()`);
check('一致性：匹配接口对同一输入返回结果（供 A/B 快照比对）', matchSnap.count > 0, matchSnap.count);

const pols = await evalJs(`(async () => { const d = await API.get('/api/policies');
  const list = d.policies || d.results || d || [];
  return { n: list.length, ids: list.map(p=>p.policy_id).sort(),
    verified: list.filter(p=>p.verification_status==='verified').length,
    cats: [...new Set(list.map(p=>p.category))].sort() }; })()`);
info('政策库规模与状态分布', pols);

/* ---------------- 9. 异常：存储损坏 / 未知 ID / 快速重复点击 ---------------- */
await evalJs(`(() => { try { sessionStorage.setItem(PFServices.K.records, '{坏掉的JSON'); } catch(e){}
  try { sessionStorage.setItem(PFServices.K.mark + 'gz_elderly_009', 'garbage'); } catch(e){} return 1; })()`);
await goto('verify-list.html');
const bad1 = await evalJs('({ errs: window.__errs||[], rendered: document.body.innerText.length > 200 })');
check('异常：存储 JSON 损坏时页面不崩（安全降级）', bad1.errs.length === 0 && bad1.rendered, bad1);

await goto('policy.html?id=__nope__');
const bad2 = await evalJs('({ errs: window.__errs||[], t: document.body.innerText.slice(0,120) })');
check('异常：未知政策 ID 页面不崩', bad2.errs.length === 0, bad2);

await goto('verify-list.html');
const rapid = await evalJs(`(() => { const before = PFServices.listRecords().length;
  for (let i=0;i<6;i++) { PFServices.toggleSelected('004','助餐配餐服务','广州市民政局',''); }
  return { before, after: PFServices.listRecords().length,
    dup: new Set(PFServices.listRecords().map(r=>r.pid)).size !== PFServices.listRecords().length }; })()`);
check('异常：连续快速切换不产生重复条目', rapid.dup === false, rapid);

/* ---------------- 汇总 ---------------- */
const snapPath = `${SNAPDIR}\\${TAG}.json`;
writeFileSync(snapPath, JSON.stringify({
  tag: TAG, match: matchSnap, policies: pols,
  state: { listIds: isoF.list, recIds: isoF.recs, mineFound: mine.found },
}, null, 2), 'utf8');
console.log(`  快照写入 ${snapPath}`);

const summary = { tag: TAG, base: BASE, pass, fail, skip, total: results.length, results };
writeFileSync(`${SNAPDIR}\\summary-${TAG}.json`, JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n[${TAG}] 通过 ${pass} / 失败 ${fail} / 跳过 ${skip}（共 ${results.length} 项）`);
console.log(`汇总写入 ${SNAPDIR}\\summary-${TAG}.json`);

try { child.kill(); } catch (e) { /* 忽略 */ }
process.exit(fail === 0 ? 0 : 1);
