/**
 * 线上 gz_elderly_009 详情页字段核对：发布日期 / 文号 / 有效期 / 官方链接。
 *
 *     node .tools/live-verify.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'https://zhaohan94s666.github.io/policy-finder').replace(/\/+$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9260;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-'));
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

let PASS = 0, FAIL = 0;
const check = (n, c, d = '') => { if (c) { PASS++; console.log(`  ok   ${n}`); } else { FAIL++; console.log(`  FAIL ${n} ${d}`); } };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

console.log(`目标：${BASE}`);

// 必须先走一遍真实匹配流程，详情页才有 savedProfile。
// 原因：policy.html 的「页面上看到的匹配上下文」（tier/status）与「有效期依据」
// 都读自 matchRow —— 它由 API.match(POLICY_DB, savedProfile) 重跑得到。
// 没有会话时 matchRow 为 null，这些字段渲染不出来，但这不是数据缺陷：
// 直接打开详情页本来就只能展示与画像无关的静态字段。
await send('Page.navigate', { url: `${BASE}/family.html` });
for (let i = 0; i < 150; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
await sleep(1200);
await ev(`(() => {
  const op = document.querySelectorAll('#operatorGrid button.choice')[0];
  const bn = document.querySelectorAll('#beneficiaryGrid button.choice')[0];
  if (op) op.click();
  if (bn) bn.click();
  const ck = document.getElementById('confirmCheck');
  if (ck && !ck.checked) ck.click();
  const nx = document.getElementById('nextBtn');
  if (nx && !nx.disabled) nx.click();
})()`);
await sleep(1500);

await send('Page.navigate', { url: `${BASE}/discover.html` });
for (let i = 0; i < 150; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
await sleep(1200);
await ev(`(() => { const s = document.getElementById('esStart'); if (s) s.click(); })()`);
await sleep(800);
await ev(`(() => {
  const t = document.getElementById('situation');
  if (t) { t.value = '爸爸72岁，独居，行动不便，退休在家'; t.dispatchEvent(new Event('input', { bubbles: true })); }
  const b = document.getElementById('discoverBtn');
  if (b) b.click();
})()`);
await sleep(3500);

console.log('已建立匹配会话，进入详情页');
await send('Page.navigate', { url: `${BASE}/policy.html?id=gz_elderly_009` });
for (let i = 0; i < 150; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
await sleep(2500);

const info = await ev(`(() => {
  // innerText 只包含可见文本；折叠区（<details> 未展开、隐藏 tab）里的内容读不到。
  // 先把所有 details 展开，再取整页文本，才能真实反映「页面上有没有这个值」。
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  const txt = document.body.innerText;
  const html = document.documentElement.outerHTML;
  return {
    url: location.href,
    text: txt.slice(0, 4000),
    // 也保留原始 HTML 里的链接（折叠区内可能渲染了但不可见）
    allGovHrefs: [...document.querySelectorAll('a[href*="gz.gov.cn"]')].map((a) => a.href),
    htmlHasNewUrl: html.includes('post_11003372'),
    htmlHasOldUrl: html.includes('9501123'),
    htmlHasPublishDate: html.includes('2026-09-14'),
    htmlHasExpires: html.includes('2027-12-31'),
    govLinks: [...document.querySelectorAll('a[href*="gz.gov.cn"]')].map(a => ({href: a.href, text: (a.innerText||'').trim()})),
    backLink: !!document.querySelector('.back-link'),
    backH: document.querySelector('.back-link') ? document.querySelector('.back-link').getBoundingClientRect().height : null,
    hasSteps: !!document.querySelector('ol.flow-steps'),
    // 「有效期依据」块：延期文不是政策本体，要单独一行、带自己的官方链接
    hasBasisBlock: !!document.querySelector('.tc-basis'),
    basisText: document.querySelector('.tc-basis') ? document.querySelector('.tc-basis').innerText.replace(/\s+/g, ' ').trim() : '',
    basisHref: document.querySelector('.tc-basis a') ? document.querySelector('.tc-basis a').href : null,
  };
})()`);
console.log('URL:', info.url);
console.log('--- 页面文本片段 ---');
console.log(info.text.split('\n').filter((s) => s.trim()).slice(0, 40).join('\n'));
console.log('\n--- 官方链接 ---');
info.govLinks.forEach((l) => console.log(`  ${l.text} -> ${l.href}`));

console.log('\n--- 断言 ---');
const t = info.text;
check('页面渲染了发布日期 2026-09-14', info.htmlHasPublishDate, 'DOM 未出现');
check('不渲染旧错误日期 2026-10-12', !info.htmlHasOldUrl && !t.includes('2026-10-12'), '仍显示旧值');
check('显示文号 穗医保规字〔2024〕1号', t.includes('穗医保规字〔2024〕1号'), '未找到');
check('显示延期文号 穗医保规字〔2026〕1号', t.includes('穗医保规字〔2026〕1号'), '未找到');
check('页面渲染有效期 2027-12-31', info.htmlHasExpires, 'DOM 未出现');
// 官方原文链接的口径：页面「查看官方原文」指向 source.official_url = 政策原文（2024 版试行办法），
// 这是设计如此——原文入口给的是政策本体；延期文（11003）出现在「有效期」说明里。
check('官方原文链接指向政策本体（9425/9425447）',
  info.govLinks.some((l) => l.href.includes('post_9425447.html')), JSON.stringify(info.govLinks));
check('页面不残留旧 404 链接（9501123）', !info.htmlHasOldUrl, '仍含旧链接');
check('延期文 URL（11003）已在页面中呈现', info.htmlHasNewUrl, '未出现');
check('返回键高度 44px（本轮触控优化已上线）', info.backH !== null && info.backH >= 43.5, `h=${info.backH}`);
check('四步流程条存在', info.hasSteps);
check('页面渲染「有效期依据」块', info.hasBasisBlock, '未找到 .tc-basis');
check('依据块显示延期文号 穗医保规字〔2026〕1号', info.basisText.includes('穗医保规字〔2026〕1号'), info.basisText);
check('依据块显示延期发布日期 2026-09-14', info.basisText.includes('2026-09-14'), info.basisText);
check('依据块带延期原文链接（11003）', !!info.basisHref && info.basisHref.includes('post_11003372.html'), String(info.basisHref));

ws.close(); child.kill();
console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
