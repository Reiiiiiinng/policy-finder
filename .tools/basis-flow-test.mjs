/**
 * 本地完整流程下验证「有效期依据」渲染：
 * family.html → 选关系 → discover.html → 描述 → 结果 → 进 gz_elderly_009 详情。
 *
 *     node .tools/basis-flow-test.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9264;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const p = (await r.json()).find((t) => t.type === 'page');
    if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise((res) => { ws.onopen = res; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const goto = async (url) => {
  await send('Page.navigate', { url });
  for (let i = 0; i < 150; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
  await sleep(700);
};
const clickText = async (js) => { await ev(`(() => { const el = ${js}; if (el) el.click(); return !!el; })()`); };

let PASS = 0, FAIL = 0;
const check = (n, c, d = '') => { if (c) { PASS++; console.log(`  ok   ${n}`); } else { FAIL++; console.log(`  FAIL ${n} ${d}`); } };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

console.log(`目标：${BASE}`);
await goto(`${BASE}/family.html`);
console.log('步骤1：选女儿 + 父亲 + 勾选确认');
await clickText(`document.querySelectorAll('#operatorGrid button.choice')[0]`);
await clickText(`document.querySelectorAll('#beneficiaryGrid button.choice')[0]`);
await ev("document.getElementById('confirmCheck').click()");
await sleep(300);
const ready = await ev("!document.getElementById('nextBtn').disabled");
check('下一步按钮已启用', ready);
await clickText(`document.getElementById('nextBtn')`);
await sleep(1500);
console.log('  -> 当前:', await ev('location.pathname'));

console.log('步骤2：描述情况');
await sleep(800);
await ev(`(() => { const b = document.getElementById('esStart'); if (b) b.click(); })()`);
await sleep(500);
await ev(`(() => {
  const t = document.getElementById('situation');
  if (t) { t.value = '父亲今年78岁，独居，行动不便，长期卧床，需要人照顾'; t.dispatchEvent(new Event('input', {bubbles:true})); }
})()`);
await sleep(300);
await clickText(`document.getElementById('discoverBtn')`);
await sleep(4000);
console.log('  -> 当前:', await ev('location.pathname'));
const found = await ev("document.body.innerText.includes('共找到')");
check('结果页已出', found);

console.log('步骤3：进入 gz_elderly_009 详情');
await goto(`${BASE}/policy.html?id=gz_elderly_009`);
await sleep(1500);

const info = await ev(`(() => {
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  const b = document.querySelector('.tc-basis');
  return {
    url: location.href,
    hasBasis: !!b,
    basisText: b ? b.innerText.replace(/\\s+/g, ' ').trim() : null,
    basisLinks: b ? [...b.querySelectorAll('a')].map((a) => a.href) : [],
    heading: (document.querySelector('#dblock-source h3') || {}).innerText || null,
    bodyHasDate: document.documentElement.outerHTML.includes('2026-09-14'),
    bodyHasNewUrl: document.documentElement.outerHTML.includes('post_11003372'),
    bodyHasOldUrl: document.documentElement.outerHTML.includes('9501123'),
    hasValidityRange: document.documentElement.outerHTML.includes('2027-12-31'),
  };
})()`);
console.log(JSON.stringify(info, null, 1));

console.log('\n--- 断言 ---');
check('详情页渲染了「有效期依据」块', info.hasBasis, '未渲染');
check('依据块显示延期文号 穗医保规字〔2026〕1号',
  (info.basisText || '').includes('穗医保规字〔2026〕1号'), info.basisText || '');
check('依据块显示延期发布日期 2026-09-14',
  (info.basisText || '').includes('2026-09-14'), info.basisText || '');
check('依据块带官方延期文链接（11003）',
  info.basisLinks.some((h) => h.includes('post_11003372')), JSON.stringify(info.basisLinks));
check('页面不残留旧 404 链接', !info.bodyHasOldUrl);

ws.close(); child.kill();
console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
