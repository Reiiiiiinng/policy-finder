/**
 * 详情页吸顶返回 + 官方原文链接检查（改动后回归）。
 *
 *     node .tools/policy-check.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9252;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

// 先进发现页建立会话，再打开 gz_elderly_009 详情
await send('Page.navigate', { url: `${BASE}/discover.html` });
for (let i = 0; i < 100; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
await sleep(600);

await send('Page.navigate', { url: `${BASE}/policy.html?id=gz_elderly_009` });
for (let i = 0; i < 120; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
await sleep(1500);

const info = await ev(`(() => {
  const back = document.querySelector('.back-link');
  if (!back) return { noBack: true };
  const rb = back.getBoundingClientRect();
  const tb = document.querySelector('.topbar').getBoundingClientRect();
  const body = document.body.innerText;
  return {
    back: { w: rb.width, h: rb.height, href: back.getAttribute('href') },
    topbarH: tb.height,
    hasTitle: body.includes('政策依据'),
    // 官方原文链接
    govLinks: [...document.querySelectorAll('a[href*="gz.gov.cn"]')].map(a => a.href),
    hasStepBar: !!document.querySelector('ol.flow-steps'),
    steps: [...document.querySelectorAll('ol.flow-steps li')].map(li => li.innerText.trim().split('\\n')[0]),
  };
})()`);
console.log(JSON.stringify(info, null, 2));

if (!info.noBack) {
  check('详情页返回键高度 ≥ 44', info.back.h >= 43.5, info.back.h.toFixed(1));
  check('详情页返回键宽度 ≥ 44', info.back.w >= 43.5, info.back.w.toFixed(1));
  check('详情页有官方原文链接', info.govLinks.length > 0, `${info.govLinks.length} 个`);
  check('详情页四步流程条存在', info.hasStepBar && info.steps.length === 4, JSON.stringify(info.steps));

  // 吸顶：滚到 800px 后返回键仍在视口顶部
  const stick = await ev(`(async () => {
    window.scrollTo(0, 800);
    await new Promise(r => setTimeout(r, 400));
    const b = document.querySelector('.back-link').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2);
    return { scrollY: window.scrollY, top: b.top, bottom: b.bottom, hit: el ? el.tagName : null };
  })()`);
  console.log('吸顶:', JSON.stringify(stick));
  check('滚到 800px 后返回键仍在视口内（吸顶生效）', stick.top >= 0 && stick.bottom <= 844, `top=${stick.top.toFixed(1)}`);
  check('吸顶后返回键仍可点击命中', stick.hit === 'A', `命中 ${stick.hit}`);
}

ws.close(); child.kill();
console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
