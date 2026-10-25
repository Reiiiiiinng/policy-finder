/**
 * 顶栏视觉截图：改前改后各截一张，用于目视确认「视觉权重不变」。
 *
 *     node .tools/topbar-shot.mjs <输出目录> [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = process.argv[2] || 'D:\\deep\\.work\\shots-touch';
const BASE = (process.argv[3] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9248;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
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
await send('Page.enable'); await send('Runtime.enable');

const shots = [
  [390, 844, true, 'm390'],
  [320, 720, true, 'm320'],
  [1280, 800, false, 'd1280'],
];
for (const [w, h, mobile, tag] of shots) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
  for (const page of ['family.html', 'self.html']) {
    await send('Page.navigate', { url: `${BASE}/${page}` });
    for (let i = 0; i < 100; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
    await sleep(700);
    // 只截顶栏区域（高度取 topbar 实际高度 + 一点余量）
    const tb = await ev("(() => { const r = document.querySelector('.topbar').getBoundingClientRect(); return {h: r.height}; })()");
    const res = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: w, height: Math.ceil(tb.h) + 6, scale: 2 },
      captureBeyondViewport: false,
    });
    const file = path.join(OUT, `${tag}-${page.replace('.html', '')}-topbar.png`);
    fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
    console.log('wrote', file);

    // family 页额外截确认行区域
    if (page === 'family.html') {
      const rect = await ev(`(() => {
        const el = document.querySelector('.confirm-line');
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: 0, y: Math.max(0, r.top - 20), w: innerWidth, h: r.height + 40 };
      })()`);
      const res2 = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 },
        captureBeyondViewport: false,
      });
      const f2 = path.join(OUT, `${tag}-family-confirm.png`);
      fs.writeFileSync(f2, Buffer.from(res2.result.data, 'base64'));
      console.log('wrote', f2);
    }
  }
}
ws.close(); child.kill();
console.log('done ->', OUT);
