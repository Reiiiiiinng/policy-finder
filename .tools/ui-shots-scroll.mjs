/**
 * 滚动状态专项截图：验证吸顶顶栏、结果卡来源行（有/无文号两种）。
 *   node .tools/ui-shots-scroll.mjs   # 需先启动 python backend/server.py
 * 产出 .ui-shots/ui-v2/s-*.png，用完即删不影响常规交付物。
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
const PORT = 9339;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
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
      setTimeout(() => reject(new Error('CDP timeout: ' + method)), 45000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
    return r.result.value;
  }
  async waitFor(expr, label) {
    for (let i = 0; i < 160; i += 1) {
      try { if (await this.eval('!!(' + expr + ')')) return; } catch { /* 导航中 */ }
      await sleep(150);
    }
    throw new Error('waitFor 超时：' + label);
  }
  async viewport(w, h) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  }
  async snap(name) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
    console.log('ok   ' + name);
  }
  async scrollSel(sel, offset = 0) {
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (el) { const y = el.getBoundingClientRect().top + window.scrollY + (${offset});
        window.scrollTo(0, Math.max(0, y)); } return true; })()`);
  }
}

const FAMILY = `sessionStorage.setItem("policy_finder_session", JSON.stringify({
  target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
  text: '我父亲72岁，一个人住在广州，最近行动越来越不方便，洗澡做饭都有困难。',
  lastQuery: 'family', demo: false, demoBanner: false,
  profile: { raw_text: '我父亲72岁，一个人住在广州，最近行动越来越不方便，洗澡做饭都有困难。',
    relation: '父亲', operator: '女儿', basic: { age: 72, region: '广州市' },
    scenes: ['行动不便', '独居', '年龄增长'], mode: 'family' } }));`;

let profileDir = '';
async function main() {
  mkdirSync(OUT, { recursive: true });
  profileDir = await mkdtemp(join(tmpdir(), 'uishots2_'));
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-crash-reporter', '--disable-breakpad',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let wsUrl = null;
    for (let i = 0; i < 100 && !wsUrl; i += 1) {
      try {
        const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
        const list = await r.json();
        wsUrl = (list.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
      } catch { /* 起动中 */ }
      if (!wsUrl) await sleep(200);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');

    // 手机：结果卡（含来源行：有文号 / 无文号）
    // 先落到同源页面再播种：about:blank 上没有 sessionStorage。
    await cdp.viewport(390, 844);
    await cdp.send('Page.navigate', { url: BASE + '/index.html' });
    await cdp.waitFor("document.readyState === 'complete'", '首页');
    await cdp.eval('sessionStorage.clear(); localStorage.clear(); ' + FAMILY);
    await cdp.send('Page.navigate', { url: BASE + '/discover.html' });
    await cdp.waitFor("document.readyState === 'complete'", '发现页');
    await cdp.waitFor("document.querySelector('.result-card')", '结果卡');
    await sleep(800);
    await cdp.scrollSel('.result-card', -70);
    await sleep(500);
    await cdp.snap('s-m-result-card');
    await cdp.eval('window.scrollBy(0, 1500)');
    await sleep(400);
    await cdp.snap('s-m-result-card2');

    // 手机：详情页滚动后（吸顶返回 + 政策来源卡）
    await cdp.send('Page.navigate', { url: BASE + '/policy.html?id=gz_elderly_001' });
    await cdp.waitFor("document.querySelector('.dhead')", '详情页');
    await sleep(700);
    await cdp.eval('window.scrollTo(0, 1500)');
    await sleep(500);
    await cdp.snap('s-m-policy-scrolled');
    await cdp.scrollSel('#dblock-source', -66);
    await sleep(400);
    await cdp.snap('s-m-source-card');

    // 桌面：结果两栏 + 结果卡来源行
    await cdp.viewport(1440, 900);
    await cdp.send('Page.navigate', { url: BASE + '/discover.html' });
    await cdp.waitFor("document.querySelector('.result-card')", '结果卡(桌面)');
    await sleep(900);
    await cdp.scrollSel('.result-card', -80);
    await sleep(500);
    await cdp.snap('s-d-result-card');
    console.log('\n完成，输出目录 ' + OUT);
  } finally {
    proc.kill();
    await sleep(1200);
    try { await rm(profileDir, { recursive: true, force: true }); } catch { /* 下次清理 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
