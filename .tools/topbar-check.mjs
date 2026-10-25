/**
 * 顶栏高度与吸顶行为检查：返回键撑到 44px 后，顶栏不能被撑高、吸顶不能被破坏。
 *
 *     node .tools/topbar-check.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9246;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-'));
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

// 基准：topbar 高度在 390 宽下，任何页应约 89.75（改前实测值）
const BASELINE_TOPBAR_H = 89.75;
const TOL = 1.5;

for (const [w, h, mobile, label] of [[390, 844, true, '390 移动'], [320, 720, true, '320 移动'], [1280, 800, false, '1280 桌面']]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile });
  for (const page of ['family.html', 'self.html']) {
    await send('Page.navigate', { url: `${BASE}/${page}` });
    for (let i = 0; i < 100; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
    await sleep(500);
    const m = await ev(`(() => {
      const tb = document.querySelector('.topbar');
      const row = document.querySelector('.brand-row');
      const rb = tb.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      return { topbarH: rb.height, rowH: rr.height };
    })()`);
    if (label === '390 移动') {
      console.log(`  ${page} topbar=${m.topbarH.toFixed(2)} row=${m.rowH.toFixed(2)}`);
      check(`${page} 顶栏高度未被撑高（≤ ${BASELINE_TOPBAR_H + TOL}）`, m.topbarH <= BASELINE_TOPBAR_H + TOL, m.topbarH.toFixed(2));
    }
    // 返回键必须完整落在 topbar 内（topbar 有 overflow:hidden，超出会被裁掉）
    const inside = await ev(`(() => {
      const tb = document.querySelector('.topbar').getBoundingClientRect();
      const b = document.querySelector('.back-link').getBoundingClientRect();
      return { ok: b.top >= tb.top - 0.5 && b.bottom <= tb.bottom + 0.5 && b.left >= tb.left - 0.5, bt: b.top, bb: b.bottom, tbt: tb.top, tbb: tb.bottom };
    })()`);
    check(`${label} ${page} 44px 返回键完整在顶栏内（未被裁切）`, inside.ok, JSON.stringify(inside));

    // 吸顶：滚到页面中部后，返回键仍在视口顶部可见且可点
    const stick = await ev(`(async () => {
      window.scrollTo(0, Math.min(600, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 300));
      const b = document.querySelector('.back-link').getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2);
      return { scrollY: window.scrollY, top: b.top, visible: b.top >= 0 && b.bottom <= innerHeight, hit: el ? el.tagName : null };
    })()`);
    if (stick.scrollY > 50) {
      check(`${label} ${page} 吸顶后返回键仍在视口内`, stick.visible, `top=${stick.top.toFixed(1)}`);
      check(`${label} ${page} 吸顶后返回键仍可点击命中`, stick.hit === 'A', `命中 ${stick.hit}`);
    } else {
      console.log(`  （${label} ${page} 页面不够高，跳过吸顶检查）`);
    }
  }
}

ws.close(); child.kill();
console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
