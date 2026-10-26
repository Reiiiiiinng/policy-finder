/**
 * 详情页吸顶返回 + 官方原文链接 + 「有效期依据」检查（改动后回归）。
 *
 *     node .tools/policy-check.mjs [baseUrl]
 *
 * 两段，各自一个全新浏览器会话（脚本每次都用 mkdtemp 的新 profile）：
 *
 *   A. 无会话直开 —— 直接打开 policy.html?id=gz_elderly_009，不先进任何页。
 *      断言「有效期依据」块存在、文号/发布日期/链接对得上，且**不出现**
 *      匹配结论（.tier-strip）——回退读取只补数据，不伪造匹配状态。
 *      同时用 gz_elderly_001（没有 validity.basis）验证不渲染空白依据块。
 *
 *   B. 有会话流程 —— 原来的检查：先进 discover.html 建立的常规访问路径，
 *      再打开同一条政策，断言返回键尺寸、官方原文链接、四步流程条、吸顶。
 *
 * 为什么 A 单独一个会话：会话存在与否是这两条路径的唯一差别，混在同一个
 * 标签页里跑会互相污染（B 段的 sessionStorage 会带进 A 段）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9252;
const BASIS_DOC_NO = '穗医保规字〔2026〕1号';
const BASIS_DATE = '2026-09-14';
const BASIS_URL = 'https://www.gz.gov.cn/gzybj/gkmlpt/content/11/11003/post_11003372.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PASS = 0;
let FAIL = 0;
const check = (n, c, d = '') => {
  if (c) { PASS++; console.log(`  ok   ${n}`); } else { FAIL++; console.log(`  FAIL ${n} ${d}`); }
};

async function withBrowser(fn) {
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
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (x) => (await send('Runtime.evaluate',
    { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const goto = async (url, waitMs = 1500) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 120; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
    await sleep(waitMs);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  try {
    await fn({ send, ev, goto });
  } finally {
    ws.close();
    child.kill();
  }
}

/* ============================ A. 无会话直开 ============================ */
console.log('== A. 无会话直开 policy.html?id=gz_elderly_009（全新会话）==');
await withBrowser(async ({ ev, goto }) => {
  await goto(`${BASE}/policy.html?id=gz_elderly_009`, 1800);

  const a = await ev(`(() => {
    const sess = sessionStorage.getItem('policy_finder_session');
    const row = document.querySelector('.tc-basis');
    const link = row ? row.querySelector('a.tc-link') : null;
    const txt = row ? row.innerText : '';
    return {
      sess,
      hasRow: !!row,
      text: txt,
      href: link ? link.getAttribute('href') : null,
      tier: !!document.querySelector('.tier-strip'),
      h1: (document.querySelector('h1') || {}).innerText || '',
      stepbar: !!document.querySelector('ol.flow-steps'),
      bodyLen: document.body.innerText.length,
    };
  })()`);
  console.log('  无会话直开:', JSON.stringify(a));

  check('A0 会话为空（确认是「无会话」场景）', !a.sess, String(a.sess));
  check('A1 页面已渲染（不是白屏）', a.bodyLen > 500, `正文 ${a.bodyLen} 字`);
  check('A2 「有效期依据」块存在', a.hasRow === true);
  check(`A3 依据文号为 ${BASIS_DOC_NO}`, a.text.includes(BASIS_DOC_NO), a.text.slice(0, 80));
  check(`A4 依据发布日期为 ${BASIS_DATE}`, a.text.includes(BASIS_DATE), a.text.slice(0, 80));
  check('A5 延期原文链接指向官方延期文件', a.href === BASIS_URL, String(a.href));
  check('A6 不伪造匹配结论（无 .tier-strip）', a.tier === false);
  check('A7 四步流程条仍在', a.stepbar === true);

  // 没有 validity.basis 的政策，不应渲染空白依据块
  await goto(`${BASE}/policy.html?id=gz_elderly_001`, 1600);
  const b = await ev(`(() => ({
    hasRow: !!document.querySelector('.tc-basis'),
    bodyLen: document.body.innerText.length,
  }))()`);
  check('A8 无 basis 的政策不渲染空白依据块（gz_elderly_001）', b.hasRow === false, JSON.stringify(b));

  // 清一次会话存储，确保 B 段从干净状态开始
  await ev('sessionStorage.clear()');
});

/* ========================== B. 有会话流程（原检查） ========================== */
console.log('\n== B. 常规访问路径（先进发现页，再打开详情）==');
await withBrowser(async ({ send, ev, goto }) => {
  await goto(`${BASE}/discover.html`, 600);
  await goto(`${BASE}/policy.html?id=gz_elderly_009`, 1800);

  const info = await ev(`(() => {
    const back = document.querySelector('.back-link');
    if (!back) return { noBack: true };
    const rb = back.getBoundingClientRect();
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    const body = document.body.innerText;
    const row = document.querySelector('.tc-basis');
    return {
      back: { w: rb.width, h: rb.height, href: back.getAttribute('href') },
      topbarH: tb.height,
      hasTitle: body.includes('政策依据'),
      govLinks: [...document.querySelectorAll('a[href*="gz.gov.cn"]')].map(a => a.href),
      hasStepBar: !!document.querySelector('ol.flow-steps'),
      steps: [...document.querySelectorAll('ol.flow-steps li')].map(li => li.innerText.trim().split('\\n')[0]),
      basisText: row ? row.innerText : '',
      basisHref: row && row.querySelector('a.tc-link') ? row.querySelector('a.tc-link').getAttribute('href') : null,
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));

  if (!info.noBack) {
    check('详情页返回键高度 ≥ 44', info.back.h >= 43.5, info.back.h.toFixed(1));
    check('详情页返回键宽度 ≥ 44', info.back.w >= 43.5, info.back.w.toFixed(1));
    check('详情页有官方原文链接', info.govLinks.length > 0, `${info.govLinks.length} 个`);
    check('详情页四步流程条存在', info.hasStepBar && info.steps.length === 4, JSON.stringify(info.steps));
    check('B-补 有会话时依据块仍在且有链接',
      info.basisText.includes(BASIS_DOC_NO) && info.basisHref === BASIS_URL,
      info.basisText.slice(0, 60));

    // 吸顶：滚到 800px 后返回键仍在视口顶部
    const stick = await ev(`(async () => {
      window.scrollTo(0, 800);
      await new Promise(r => setTimeout(r, 400));
      const b = document.querySelector('.back-link').getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2);
      return { scrollY: window.scrollY, top: b.top, bottom: b.bottom, hit: el ? el.tagName : null };
    })()`);
    console.log('吸顶:', JSON.stringify(stick));
    check('滚到 800px 后返回键仍在视口内（吸顶生效）',
      stick.top >= 0 && stick.bottom <= 844, `top=${stick.top.toFixed(1)}`);
    check('吸顶后返回键仍可点击命中', stick.hit === 'A', `命中 ${stick.hit}`);
  }
});

console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
