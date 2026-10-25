/**
 * 触控目标实测：真实渲染 + 真实鼠标点击，验证可点击区域与行为。
 *
 *     node .tools/touch-target.mjs [baseUrl]
 *
 * 默认打开本地后端（http://127.0.0.1:8000）；传入线上地址则测线上。
 *
 * 为什么要「真实鼠标点击」而不是只看 CSS：
 *   上一轮兼容性扫描只读了 getBoundingClientRect，得出返回键 68×31、
 *   复选框 18×18。但「盒子多大」不等于「点哪里有效」——label 包裹的
 *   checkbox 点文字也能勾选。这里对每个目标都用 Input.dispatchMouseEvent
 *   在盒子边缘/外侧真实点击，用结果证明可点击范围，而不是改测试来凑数。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9241;
const MIN = 44; // WCAG 2.1 AA 目标尺寸

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PASS = 0;
let FAIL = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    PASS++;
    console.log(`  ok   ${name}`);
  } else {
    FAIL++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
const child = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('无法连接浏览器调试端口');
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function goto(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) {
    const st = await evalJs('document.readyState');
    if (st === 'complete') break;
    await sleep(100);
  }
  await sleep(400);
}

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: mobile ? 3 : 1, mobile,
  });
  await send('Emulation.setTouchEmulationEnabled', {
    enabled: mobile, maxTouchPoints: mobile ? 5 : 1,
  });
}

async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

const box = (sel) => evalJs(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
})()`);

// 产品口径：顶栏「← 返回」只出现在二级页（family / self / policy）。
// discover.html 是一级页，renderTopbar(title, null) 不渲染返回键——
// 所以下面所有返回键测量都去二级页，不能拿一级页当失败。
const SECONDARY = ['family.html', 'self.html'];

console.log(`目标：${BASE}`);
await send('Page.enable');
await send('Runtime.enable');

console.log('\n== 1. 返回链接「← 返回」的盒子尺寸（二级页）==');
const viewports = [
  [430, 932, true, '430 移动'],
  [390, 844, true, '390 移动'],
  [360, 800, true, '360 移动'],
  [320, 720, true, '320 移动'],
  [1280, 800, false, '1280 桌面'],
];
for (const [w, h, mobile, label] of viewports) {
  await setViewport(w, h, mobile);
  for (const page of SECONDARY) {
    await goto(`${BASE}/${page}`);
    const b = await box('.back-link');
    if (!b) { FAIL++; console.log(`  FAIL ${label} ${page} 没找到 .back-link`); continue; }
    console.log(`  ${label.padEnd(10)} ${page.padEnd(12)} 返回键 ${b.w.toFixed(1)}×${b.h.toFixed(1)} px`);
    check(`${label} ${page} 返回键宽 ≥ ${MIN}`, b.w >= MIN - 0.5, `${b.w.toFixed(1)}`);
    check(`${label} ${page} 返回键高 ≥ ${MIN}`, b.h >= MIN - 0.5, `${b.h.toFixed(1)}`);
  }
}

console.log('\n== 1b. 一级页不渲染返回键（产品口径，不是缺陷）==');
await setViewport(390, 844, true);
for (const page of ['index.html', 'discover.html', 'consult.html', 'mine.html']) {
  await goto(`${BASE}/${page}`);
  const has = await evalJs("!!document.querySelector('.back-link')");
  check(`${page} 一级页无返回键`, !has);
}

console.log('\n== 2. 返回键真实鼠标点击（贴近盒子边缘的内侧点，最考验可点范围）==');
await setViewport(390, 844, true);
for (const page of SECONDARY) {
  await goto(`${BASE}/${page}`);
  const b = await box('.back-link');
  // 胶囊是 border-radius 圆角：左上角 4px 处落在圆弧之外，不属于按钮本身，
  // 拿它做断言等于要求「圆角矩形的角也算命中」，不合理。取内缩 10px 的四个点，
  // 都能验证 44px 高的可点区域真实生效。
  const pts = [
    ['左上+10', b.x + 10, b.y + 10],
    ['上中', b.x + b.w / 2, b.y + 6],
    ['下中', b.x + b.w / 2, b.y + b.h - 6],
    ['左下+10', b.x + 10, b.y + b.h - 10],
  ];
  let clicked = false;
  for (const [name, px, py] of pts) {
    await goto(`${BASE}/${page}`);
    const hit = await evalJs(`(() => {
      const el = document.elementFromPoint(${px}, ${py});
      return el ? el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') : null;
    })()`);
    check(`${page} 返回键 ${name} 命中按钮本身`, hit === 'A.back-link', `命中 ${hit}`);
    if (hit !== 'A.back-link') continue;
    await clickAt(px, py);
    await sleep(1200);
    const after = await evalJs('location.pathname.split("/").pop() || "index.html"');
    check(`${page} 点 ${name} 能跳转（现在到 ${after}）`, after !== page);
    clicked = true;
    break; // 跳转后页面已变，用第一个可用点验证即可
  }
  if (!clicked) { FAIL++; console.log(`  FAIL ${page} 四个点都没能跳出`); }
}

console.log('\n== 3. 返回键不能挤坏顶栏：标题仍在同一行且不被裁切 ==');
for (const [w, h, mobile, label] of viewports) {
  await setViewport(w, h, mobile);
  for (const page of SECONDARY) {
    await goto(`${BASE}/${page}`);
    const info = await evalJs(`(() => {
      const back = document.querySelector('.back-link');
      const row = back && back.closest('.brand-row');
      const h1 = row ? row.querySelector('h1, .brand-heading') : null;
      if (!back || !row) return null;
      const rb = back.getBoundingClientRect();
      const rh = row.getBoundingClientRect();
      const hb = h1 ? h1.getBoundingClientRect() : null;
      return {
        overlap: hb ? !!(rb.right > hb.left + 0.5 && rb.left < hb.right - 0.5 && rb.top < hb.bottom && rb.bottom > hb.top) : false,
        backInsideRow: rb.top >= rh.top - 1 && rb.bottom <= rh.bottom + 1,
        backClipped: rb.left < -0.5 || rb.right > document.documentElement.clientWidth + 0.5,
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        h1Lines: h1 ? Math.round(hb.height / parseFloat(getComputedStyle(h1).lineHeight || '20')) : 0,
      };
    })()`);
    if (!info) { FAIL++; console.log(`  FAIL ${label} ${page} 顶栏结构异常`); continue; }
    check(`${label} ${page} 返回键与标题不重叠`, !info.overlap);
    check(`${label} ${page} 返回键未溢出视口`, !info.backClipped);
    check(`${label} ${page} 页面无横向滚动`, !info.docOverflow);
    check(`${label} ${page} 返回键未撑高顶栏（仍在 brand-row 内）`, info.backInsideRow);
  }
}

console.log('\n== 4. 确认复选框的可点击区域（label 是否把整行变成点击区）==');
await setViewport(390, 844, true);
await goto(`${BASE}/family.html`);
{
  const lb = await evalJs(`(() => {
    const el = document.getElementById('confirmCheck');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const lab = el.closest('label');
    const rb = el.getBoundingClientRect();
    const rl = lab ? lab.getBoundingClientRect() : null;
    return {
      box: { x: rb.left, y: rb.top, w: rb.width, h: rb.height },
      label: rl ? { x: rl.left, y: rl.top, w: rl.width, h: rl.height } : null,
      wrapped: !!lab,
    };
  })()`);
  if (!lb) { FAIL++; console.log('  FAIL 没找到 #confirmCheck'); }
  else {
    console.log(`  复选框本体 ${lb.box.w.toFixed(1)}×${lb.box.h.toFixed(1)} px`);
    console.log(`  外层 label  ${lb.label ? lb.label.w.toFixed(1) + '×' + lb.label.h.toFixed(0) : '（无）'} px`);
    check('复选框在 label 内（点文字也能勾选）', lb.wrapped);

    // 真实点击：label 的最左内侧与最右内侧各点一次，看 checked 是否翻转
    const state0 = await evalJs("document.getElementById('confirmCheck').checked");
    await clickAt(lb.label.x + 2, lb.label.y + lb.label.h - 2);
    await sleep(150);
    const state1 = await evalJs("document.getElementById('confirmCheck').checked");
    check('点 label 左下角（远离子控件）能勾选', state1 !== state0, `之前 ${state0} 之后 ${state1}`);

    await clickAt(lb.label.x + lb.label.w - 6, lb.label.y + 4);
    await sleep(150);
    const state2 = await evalJs("document.getElementById('confirmCheck').checked");
    check('点 label 右上角能再次切换', state2 !== state1, `之前 ${state1} 之后 ${state2}`);

    await clickAt(lb.box.x + lb.box.w / 2, lb.box.y + lb.box.h / 2);
    await sleep(150);
    const state3 = await evalJs("document.getElementById('confirmCheck').checked");
    check('点复选框本体本身也能切换', state3 !== state2, `之前 ${state2} 之后 ${state3}`);

    check('label 高度 ≥ 44（整行都是热区）', lb.label.h >= MIN - 0.5, lb.label.h.toFixed(1));

    // 键盘：聚焦后空格切换
    await evalJs("document.getElementById('confirmCheck').focus()");
    const before = await evalJs("document.getElementById('confirmCheck').checked");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
    await sleep(150);
    const afterKey = await evalJs("document.getElementById('confirmCheck').checked");
    check('键盘空格能切换（原生键盘操作保留）', afterKey !== before, `之前 ${before} 之后 ${afterKey}`);

    const focusable = await evalJs(`(() => {
      const el = document.getElementById('confirmCheck');
      el.focus();
      return document.activeElement === el;
    })()`);
    check('复选框可获得键盘焦点', focusable);
  }
}

console.log('\n== 5. 焦点指示可见（:focus-visible 有实际样式）==');
await setViewport(390, 844, true);
await goto(`${BASE}/family.html`);
{
  await evalJs("document.querySelector('.back-link').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(200);
  const hasRule = await evalJs(`(() => {
    for (const ss of document.styleSheets) {
      let rules;
      try { rules = ss.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.selectorText && r.selectorText.includes('focus-visible')) return true;
      }
    }
    return false;
  })()`);
  check('样式表里存在 focus-visible 规则', hasRule);

  // 键盘 Tab 能走到返回键，且聚焦时有可见外框（outline 非 none）
  const tabInfo = await evalJs(`(() => {
    const back = document.querySelector('.back-link');
    back.focus();
    const cs = getComputedStyle(back);
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, focused: document.activeElement === back };
  })()`);
  check('返回键可获得键盘焦点', tabInfo.focused);
  check('返回键聚焦时有 outline（不是 none）',
    tabInfo.outlineStyle !== 'none' || parseFloat(tabInfo.outlineWidth) > 0,
    `outline=${tabInfo.outlineStyle} ${tabInfo.outlineWidth}`);
}

ws.close();
child.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略占用 */ }

console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
