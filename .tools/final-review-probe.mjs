/**
 * P1/P2 终审探针：在真实页面上核验——
 *   1) 家庭页父母/长辈双入口的提示差异与进度归一（无本地三步条、无演示进度）；
 *   2) 发现页分类计数与真实数据的口径一致（养6/健2/医1/保1）；
 *   3) 详情页分段编号（每页 1,2 连续）、有效期行隐藏逻辑、符合度口径文案、官方原文链接；
 * 探针只读，不修改任何状态。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:8000';
const PORT = 9349;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));
if (!EDGE) { console.error('未找到本机浏览器'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0; const pending = new Map();
function bind(ws) {
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); }
  });
}
const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id; pending.set(i, { resolve });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => reject(new Error('CDP timeout: ' + method)), 45000);
});
const evalp = async (ws, expr) => {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
  return r.result.value;
};
const waitFor = async (ws, expr, label) => {
  for (let i = 0; i < 160; i += 1) {
    try { if (await evalp(ws, '!!(' + expr + ')')) return; } catch { /* 导航中 */ }
    await sleep(150);
  }
  throw new Error('waitFor 超时：' + label);
};

let profileDir = '';
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--disable-crash-reporter', '--disable-breakpad',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore' });

async function gotoReal(ws, url, waitExpr, label) {
  await send(ws, 'Page.navigate', { url: BASE + url });
  await waitFor(ws, "document.readyState === 'complete'", url);
  if (waitExpr) await waitFor(ws, waitExpr, label);
  await sleep(650);
}

async function main() {
  profileDir = await mkdtemp(join(tmpdir(), 'finalprobe_'));
  // 目录路径先建，spawn 的 --user-data-dir 才有效
  proc.kill();
  const proc2 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-crash-reporter', '--disable-breakpad',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore' });
  try {
    let wsUrl = null;
    for (let i = 0; i < 100 && !wsUrl; i += 1) {
      try {
        const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
        const l = await r.json();
        wsUrl = (l.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
      } catch { /* 起动中 */ }
      if (!wsUrl) await sleep(200);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    bind(ws);
    await send(ws, 'Page.enable');
    await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });

    const out = { pass: 0, fail: 0 };
    const ck = (name, cond, detail) => {
      out[cond ? 'pass' : 'fail'] += 1;
      console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
    };

    // ---- 1) 家庭页双入口 ----
    await gotoReal(ws, '/index.html');
    await evalp(ws, 'sessionStorage.clear()');
    for (const [target, expectTip, tag] of [
      ['parents', '先选父亲或母亲', '父母入口'],
      ['family', '选择祖辈、配偶', '长辈入口'],
    ]) {
      await evalp(ws, `sessionStorage.setItem("policy_finder_session", JSON.stringify({ target: '${target}', demo: false, demoBanner: false }))`);
      await gotoReal(ws, '/family.html');
      const st = await evalp(ws, `(() => ({
        tip: (document.getElementById('beneficiaryTip')||{}).textContent || '',
        hasStepsBar: !!document.getElementById('stepsBar'),
        hasDemoProgress: !!document.querySelector('.demo-progress'),
        flowSteps: document.querySelectorAll('.flow-step').length,
        flowActive: (document.querySelector('.flow-step.is-active .flow-label')||{}).textContent || '',
        opRows: document.querySelectorAll('#operatorGrid .choice').length,
        benRows: document.querySelectorAll('#beneficiaryBox .choice').length,
        nextBtn: !!document.getElementById('nextBtn'),
        confirmLine: !!document.getElementById('confirmCheck'),
      }))()`);
      ck(tag + '：提示按入口区分', st.tip.includes(expectTip), st.tip.slice(0, 24));
      ck(tag + '：无本地三步条', !st.hasStepsBar);
      ck(tag + '：非演示态无演示进度条', !st.hasDemoProgress);
      ck(tag + '：全局流程条为唯一进度系统且步1激活', st.flowSteps === 4 && st.flowActive === '确认情况', st.flowActive);
      ck(tag + '：操作者5项/受益人8项完整', st.opRows === 5 && st.benRows === 8, st.opRows + '/' + st.benRows);
      ck(tag + '：关系确认与下一步在位', st.nextBtn && st.confirmLine);
    }

    // ---- 2) 发现页分类计数口径 ----
    await evalp(ws, 'sessionStorage.clear()');
    const api = await evalp(ws, `fetch('/api/policies').then(r => r.json()).then(d => {
      const c = {};
      (d.policies || []).forEach(p => { c[p.category] = (c[p.category] || 0) + 1; });
      return { counts: c, total: d.policies.length };
    })`);
    await gotoReal(ws, '/discover.html');
    await evalp(ws, `sessionStorage.setItem("policy_finder_session", JSON.stringify({
      target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
      text: '我父亲72岁，一个人住在广州，最近行动越来越不方便，洗澡做饭都有困难。',
      lastQuery: 'family', demo: false, demoBanner: false,
      profile: { raw_text: 'x', relation: '父亲', operator: '女儿',
        basic: { age: 72, region: '广州市' }, scenes: ['行动不便'], mode: 'family' } }))`);
    await gotoReal(ws, '/discover.html', "document.querySelector('.result-card')", '结果卡');
    const disc = await evalp(ws, `(() => {
      const rows = [...document.querySelectorAll('.disc-count')].map((d) => ({
        n: Number(d.querySelector('strong').textContent),
        name: d.querySelector('span').textContent,
        hasIcon: !!d.querySelector('svg.cat-ic'),
      }));
      const cards = [...document.querySelectorAll('.result-card')];
      const cardCats = cards.map((c) => (c.querySelector('.result-meta') || {}).textContent || '');
      return { rows, sum: rows.reduce((a, b) => a + b.n, 0), allIcon: rows.every(r => r.hasIcon),
        cardCount: cards.length, cardCatIcon: cards.every(c => c.querySelector('.result-meta svg.cat-ic-meta')),
        lead: document.querySelector('.result-card.is-lead') ? {
          tier: (document.querySelector('.rc-tier') || {}).textContent || '',
          hasLeaf: !!document.querySelector('.rc-tier svg'),
          footPrimary: getComputedStyle(document.querySelector('.result-foot')).color,
        } : null };
    })()`);
    ck('分类计数=真实数据口径', JSON.stringify(disc.rows.map(r => [r.name, r.n]).sort()) === JSON.stringify(Object.entries(api.counts).sort()),
      JSON.stringify(disc.rows) + ' vs ' + JSON.stringify(api.counts));
    ck('分类计数之和=结果卡总数', disc.sum === api.total && disc.sum === disc.cardCount, disc.sum + '/' + api.total + '/' + disc.cardCount);
    ck('四类计数均带线性图标', disc.allIcon);
    ck('结果卡 meta 均带分类图标', disc.cardCatIcon);
    if (disc.lead) {
      ck('首卡角标带叶形且文字完整', disc.lead.hasLeaf && disc.lead.tier.includes('建议先看这一项'), disc.lead.tier);
      ck('首卡卡尾主操作为品牌深色', disc.lead.footPrimary === 'rgb(22, 58, 50)', disc.lead.footPrimary);
    } else { ck('首卡存在', false, 'is-lead 未渲染'); }

    // ---- 3) 详情页 ----
    await gotoReal(ws, '/policy.html?id=gz_elderly_001', "document.querySelector('.dhead')", '详情页头');
    const det = await evalp(ws, `(() => {
      const nums = [...document.querySelectorAll('.dpane')].map((p) => ({
        pane: p.dataset.dpane,
        nums: [...p.querySelectorAll('.q-num')].map((q) => q.textContent.trim()),
        hidden: p.hidden,
      }));
      const meta = (document.querySelector('.dhead-meta') || {}).textContent || '';
      const tcLinkEl = document.querySelector('.tc-link');
      return {
        nums,
        validityRow: meta.includes('有 效 期'),
        fitNote: (document.querySelector('.ds-fit-note') || {}).textContent || '',
        tcHref: tcLinkEl ? tcLinkEl.getAttribute('href') : '',
        tcUrl: (document.querySelector('.tc-link-url') || {}).textContent || '',
        docDock: !!document.querySelector('.dock'),
        saveBtn: !!document.querySelector('[data-save]'),
        loadingGone: !document.querySelector('.loading'),
      };
    })()`);
    const readPane = det.nums.find((n) => n.pane === 'read');
    const condPane = det.nums.find((n) => n.pane === 'cond');
    const procPane = det.nums.find((n) => n.pane === 'proc');
    ck('解读段编号 1,2 连续', JSON.stringify(readPane.nums) === '["1","2"]', JSON.stringify(readPane.nums));
    ck('条件段编号 1,2 连续', JSON.stringify(condPane.nums) === '["1","2"]', JSON.stringify(condPane.nums));
    ck('办理段编号 1,2 连续', JSON.stringify(procPane.nums) === '["1","2"]', JSON.stringify(procPane.nums));
    const hasDates = await evalp(ws, `fetch('/api/policy/gz_elderly_001').then(r => r.json()).then(d => {
      const v = d.validity || {};
      return !!(v.effective_from || v.expires_at);
    })`);
    ck('有效期行显隐与数据一致', det.validityRow === hasDates, '行=' + det.validityRow + ' 数据有日期=' + hasDates);
    ck('符合度口径文案在位', det.fitNote.includes('相对参考分') && det.fitNote.includes('不是资格概率'), det.fitNote);
    ck('官方原文链接为域名截断形态', (det.tcHref || '').includes('mzj.gz.gov.cn') && det.tcUrl.length < 40 && det.tcUrl.length > 5, det.tcUrl);
    // 骨架屏为加载期元素：内容渲染完成后被真实内容替换（loadingGone）才是正确状态
    ck('收藏/底栏在位且骨架已被内容替换', det.saveBtn && det.docDock && det.loadingGone);
    console.log('\n结论: pass=' + out.pass + ' fail=' + out.fail);
    process.exitCode = out.fail ? 2 : 0;
  } finally {
    proc2.kill();
    await sleep(1000);
    try { await rm(profileDir, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
