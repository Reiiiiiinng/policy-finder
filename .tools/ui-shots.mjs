/**
 * UI 截图（对比/交付用）：CDP 驱动本机 Edge，按精确视口截真实页面。
 *
 *   node .tools/ui-shots.mjs            # 需先启动 python backend/server.py
 *
 * 为什么不用 --screenshot 一把梭：无头窗口宽度有下限，
 * --window-size=390 会被钳到约 500px 再裁切，390px 视口失真。
 * 这里与 svc-e2e.mjs 同一方式：Emulation.setDeviceMetricsOverride
 * 设出准确的 390×844 / 1440×900，再 Page.captureScreenshot。
 *
 * 产出 .ui-shots/ui-v2/*.png。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8000';
const OUT = join(ROOT, '.ui-shots', 'ui-v2');
const PORT = 9337;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 极简 CDP 客户端（与 svc-e2e.mjs 同一结构） ---------------- */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 45000);
    });
  }

  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error('eval failed: ' + (r.exceptionDetails.text || ''));
    }
    return r.result.value;
  }

  async waitFor(expr, timeoutMs = 25000, label = expr) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.eval('!!(' + expr + ')')) return true;
      } catch { /* 导航中执行上下文会短暂失效 */ }
      await sleep(150);
    }
    throw new Error('waitFor 超时：' + label);
  }

  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
  }

  async clearSession() {
    await this.eval('try { sessionStorage.clear(); localStorage.clear(); } catch (e) {}');
  }

  async seedFamily() {
    const TEXT = '我父亲72岁，一个人住在广州，最近行动越来越不方便，洗澡做饭都有困难。';
    await this.eval(`sessionStorage.setItem("policy_finder_session", JSON.stringify({
      target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
      text: ${JSON.stringify(TEXT)}, lastQuery: 'family',
      demo: false, demoBanner: false,
      profile: { raw_text: ${JSON.stringify(TEXT)}, relation: '父亲', operator: '女儿',
        basic: { age: 72, region: '广州市' },
        scenes: ['行动不便', '独居', '年龄增长'], mode: 'family' },
    }));`);
  }

  async shot(name, { width, height, setup, url, wait }) {
    await this.viewport(width, height);
    await this.clearSession();
    if (setup) await setup(this);
    await this.send('Page.navigate', { url: BASE + url });
    await this.waitFor("document.readyState === 'complete'", 25000, url);
    if (wait) await this.waitFor(wait.expr, 25000, wait.label);
    await sleep(900); // 平滑滚动与入场动画收尾
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
    console.log('ok   ' + name);
  }
}

let profileDir = '';

function launch() {
  return spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profileDir,
    'about:blank',
  ], { stdio: 'ignore' });
}

async function connect() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 浏览器还没起来 */ }
    await sleep(200);
  }
  throw new Error('连不上无头浏览器（端口 ' + PORT + '）');
}

async function main() {
  if (!EDGE) throw new Error('未找到本机浏览器（msedge.exe / chrome.exe）');
  mkdirSync(OUT, { recursive: true });
  profileDir = await mkdtemp(join(tmpdir(), 'uishots_'));
  const proc = launch();
  try {
    const wsUrl = await connect();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');

    const MOBILE = { width: 390, height: 844 };
    const DESK = { width: 1440, height: 900 };

    await cdp.shot('m-index', { ...MOBILE, url: '/index.html' });
    await cdp.shot('m-family', { ...MOBILE, url: '/family.html', setup: (c) => c.seedFamily() });
    await cdp.shot('m-self', { ...MOBILE, url: '/self.html' });
    await cdp.shot('m-discover', {
      ...MOBILE, url: '/discover.html',
      setup: (c) => c.seedFamily(),
      wait: { expr: "document.querySelector('.result-card')", label: '结果卡渲染' },
    });
    await cdp.shot('m-policy', {
      ...MOBILE, url: '/policy.html?id=gz_elderly_001',
      setup: (c) => c.seedFamily(),
      wait: { expr: "document.querySelector('.dhead')", label: '详情页头渲染' },
    });
    await cdp.shot('m-mine', { ...MOBILE, url: '/mine.html', setup: (c) => c.seedFamily() });
    await cdp.shot('d-index', { ...DESK, url: '/index.html' });
    await cdp.shot('d-family', { ...DESK, url: '/family.html', setup: (c) => c.seedFamily() });
    await cdp.shot('d-discover', {
      ...DESK, url: '/discover.html',
      setup: (c) => c.seedFamily(),
      wait: { expr: "document.querySelector('.result-card')", label: '结果卡渲染' },
    });
    await cdp.shot('d-policy', {
      ...DESK, url: '/policy.html?id=gz_elderly_001',
      setup: (c) => c.seedFamily(),
      wait: { expr: "document.querySelector('.dhead')", label: '详情页头渲染' },
    });
    await cdp.shot('d-mine', { ...DESK, url: '/mine.html', setup: (c) => c.seedFamily() });
    console.log('\n完成，输出目录 ' + OUT);
  } finally {
    // 先等 Edge 退出再删临时目录：Windows 上进程未退出时文件被锁，
    // rm 会 EBUSY（svc-e2e.mjs 修过的同一问题）；清理失败也不阻断交付。
    proc.kill();
    await sleep(1200);
    try { await rm(profileDir, { recursive: true, force: true }); } catch { /* 下次启动会新建 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
