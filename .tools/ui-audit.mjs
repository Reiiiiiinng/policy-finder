/**
 * P0 渲染审计：CDP 驱动本机 Edge，在真实页面上测量——
 *   1) 实际渲染的字号分布（getComputedStyle，非 CSS 源码）；
 *   2) 关键文字的实际前景/背景对比度（沿祖先链解析有效背景色）；
 *   3) 横向溢出。
 *
 *   node .tools/ui-audit.mjs            # 需先启动 python backend/server.py
 *
 * 输出各页审计结果，FAIL 项需修复后复跑。只读页面，不改动任何状态。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:8000';
const PORT = 9343;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 极简 CDP 客户端（与 svc-e2e.mjs 同一结构） ---- */
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
      setTimeout(() => reject(new Error('CDP timeout: ' + method)), 60000);
    });
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  async waitFor(expr, label, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await this.eval('!!(' + expr + ')')) return; } catch { /* 导航中 */ }
      await sleep(150);
    }
    throw new Error('waitFor 超时：' + label);
  }
  async seedFamily() {
    const TEXT = '我父亲72岁，一个人住在广州，最近行动越来越不方便，洗澡做饭都有困难。';
    await this.eval(`sessionStorage.setItem("policy_finder_session", JSON.stringify({
      target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
      text: ${JSON.stringify(TEXT)}, lastQuery: 'family', demo: false, demoBanner: false,
      profile: { raw_text: ${JSON.stringify(TEXT)}, relation: '父亲', operator: '女儿',
        basic: { age: 72, region: '广州市' },
        scenes: ['行动不便', '独居', '年龄增长'], mode: 'family' } }));`);
  }
}

let profileDir = '';

function launch() {
  return spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-crash-reporter', '--disable-breakpad',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir, 'about:blank',
  ], { stdio: 'ignore' });
}

async function connect() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 起动中 */ }
    await sleep(200);
  }
  throw new Error('连不上无头浏览器');
}

/* ---- 页内审计函数（字符串注入） ---- */
const AUDIT_FN = `
(() => {
  const parseC = (c) => {
    const m = c.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = ({r, g, b}) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (f, b) => {
    const a = lum(f), c = lum(b);
    return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
  };
  const effBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parseC(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.9) return c;
      n = n.parentElement;
    }
    return parseC(getComputedStyle(document.body).backgroundColor) || {r:252,g:250,b:245,a:1};
  };
  const sizes = new Map();
  const fails = [];
  const seen = new Set();
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    // 字号分布（含伪元素粗略略过：只统计真实元素）
    const fs = cs.fontSize;
    sizes.set(fs, (sizes.get(fs) || 0) + 1);
    // 对比度：元素直接持有非空文本
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!text) return;
    const fg = parseC(cs.color);
    if (!fg) return;
    const bg = effBg(el);
    const r = ratio(fg, bg);
    const px = parseFloat(fs);
    const key = el.tagName + '|' + text.slice(0, 18) + '|' + fs;
    if (seen.has(key)) return;
    seen.add(key);
    if (r < 4.5) {
      fails.push({ text: text.slice(0, 26), fs, ratio: Math.round(r * 100) / 100,
        cls: String(el.className).slice(0, 40) });
    }
  });
  return {
    sizes: Object.fromEntries([...sizes.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))),
    hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    contrastFails: fails.slice(0, 24),
    contrastFailCount: fails.length,
  };
})()`;

async function audit(cdp, name, { width, height, url, setup, wait }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.eval('try { sessionStorage.clear(); localStorage.clear(); } catch (e) {}');
  await cdp.send('Page.navigate', { url: BASE + '/index.html' });
  await cdp.waitFor("document.readyState === 'complete'", 'index');
  await cdp.eval('try { sessionStorage.clear(); localStorage.clear(); } catch (e) {}');
  if (setup) await setup(cdp);
  await cdp.send('Page.navigate', { url: BASE + url });
  await cdp.waitFor("document.readyState === 'complete'", url);
  if (wait) await cdp.waitFor(wait.expr, wait.label);
  await sleep(700);
  const res = await cdp.eval(AUDIT_FN);
  const sizeCount = Object.keys(res.sizes).length;
  const flag = (!res.hOverflow && sizeCount <= 8 && res.contrastFailCount === 0) ? 'PASS' : 'CHECK';
  console.log(`\n== ${name} [${width}×${height}] ${flag}`);
  console.log('   字号档(' + sizeCount + '):', JSON.stringify(res.sizes));
  console.log('   横向溢出:', res.hOverflow);
  console.log('   对比度不足(<4.5):', res.contrastFailCount);
  res.contrastFails.forEach((f) =>
    console.log(`   FAIL ${f.ratio}:1  ${f.fs}  "${f.text}"  .${f.cls}`));
  return { name, flag, res };
}

async function main() {
  if (!EDGE) throw new Error('未找到本机浏览器');
  profileDir = await mkdtemp(join(tmpdir(), 'uiaudit_'));
  const proc = launch();
  const results = [];
  try {
    const wsUrl = await connect();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');

    const M = { width: 390, height: 844 };
    const D = { width: 1440, height: 900 };

    results.push(await audit(cdp, '首页', { ...M, url: '/index.html' }));
    results.push(await audit(cdp, '家庭协助', { ...M, url: '/family.html', setup: (c) => c.seedFamily() }));
    results.push(await audit(cdp, '发现结果', {
      ...M, url: '/discover.html', setup: (c) => c.seedFamily(),
      wait: { expr: "document.querySelector('.result-card')", label: '结果卡' },
    }));
    results.push(await audit(cdp, '政策详情', {
      ...M, url: '/policy.html?id=gz_elderly_001', setup: (c) => c.seedFamily(),
      wait: { expr: "document.querySelector('.dhead')", label: '详情页头' },
    }));
    results.push(await audit(cdp, '咨询页', { ...M, url: '/consult.html' }));
    results.push(await audit(cdp, '我的', { ...M, url: '/mine.html', setup: (c) => c.seedFamily() }));
    results.push(await audit(cdp, '首页-桌面', { ...D, url: '/index.html' }));
    results.push(await audit(cdp, '发现结果-桌面', {
      ...D, url: '/discover.html', setup: (c) => c.seedFamily(),
      wait: { expr: "document.querySelector('.result-card')", label: '结果卡' },
    }));
    results.push(await audit(cdp, '政策详情-桌面', {
      ...D, url: '/policy.html?id=gz_elderly_001', setup: (c) => c.seedFamily(),
      wait: { expr: "document.querySelector('.dhead')", label: '详情页头' },
    }));
    const bad = results.filter((r) => r.flag !== 'PASS');
    console.log('\n===== 汇总 =====');
    results.forEach((r) => console.log(`${r.flag}  ${r.name}  档位=${Object.keys(r.res.sizes).length}  溢出=${r.res.hOverflow}  对比度不足=${r.res.contrastFailCount}`));
    process.exitCode = bad.length ? 2 : 0;
  } finally {
    proc.kill();
    await sleep(1200);
    try { await rm(profileDir, { recursive: true, force: true }); } catch { /* 下次清理 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
