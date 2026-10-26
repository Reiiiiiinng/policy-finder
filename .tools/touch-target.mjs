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

console.log('\n== 6. 全页面 × 多视口的真实可点击区域审计 ==');
// 目标尺寸口径（两套阈值，不是同一件事）：
//   移动端（<768）：项目要求主要操作 ≥ 44×44 CSS px。
//   桌面端（≥768）：WCAG 2.2 AA 2.5.8 要求 ≥ 24×24；但项目对关键操作仍按 44 卡。
// 例外（WCAG 2.2 明列的「inline」例外）：正文段落里的行内链接，display 是 inline、
// 其尺寸由文字流决定，不按 44/24 要求；这里单独统计，不算通过也不算违规。
const DESKTOP_MIN = 24;
const KEY_SELECTORS = '.back-link, .btn, .choice, .tb-item, #nextBtn, #discoverBtn, #demoEntry, #esStart, .tc-link, .dock-btn, .seg';
const PAGES = [
  'index.html', 'family.html', 'self.html', 'discover.html',
  'mine.html', 'consult.html', 'policy.html',
];
const AUDIT_VIEWPORTS = [
  [390, 844, true, '390 移动'],
  [768, 1024, true, '768 平板'],
  [1024, 800, false, '1024 桌面'],
  [1280, 800, false, '1280 桌面'],
  [1440, 900, false, '1440 桌面'],
  [1920, 1080, false, '1920 桌面'],
];

// policy.html 需要有会话才能渲染详情（否则停在加载态），所以这条页面单独走会话流程
async function ensureDetailSession() {
  await goto(`${BASE}/family.html`);
  const okSession = await evalJs(`(() => {
    const pick = (grid, label) => {
      const el = [...document.querySelectorAll(grid + ' button.choice')]
        .find((b) => b.textContent.trim().startsWith(label));
      if (el) el.click();
      return !!el;
    };
    const a = pick('#operatorGrid', '女儿');
    const b = pick('#beneficiaryGrid', '父亲');
    const chk = document.getElementById('confirmCheck');
    if (chk && !chk.checked) chk.click();
    return a && b && !!chk;
  })()`);
  await sleep(300);
  await evalJs("document.getElementById('nextBtn').click()");
  await sleep(1200);
  await evalJs("document.getElementById('esStart') && document.getElementById('esStart').click()");
  await sleep(400);
  await evalJs(`(() => {
    const t = document.getElementById('situation');
    if (t) { t.value = '父亲 72 岁，独居，最近行动不便，吃饭也困难'; t.dispatchEvent(new Event('input', { bubbles: true })); }
    const b = document.getElementById('discoverBtn');
    if (b) b.click();
  })()`);
  await sleep(2500);
  return okSession;
}

const auditJs = (threshold, isMobile) => `(() => {
  const TH = ${threshold};
  const KEY = ${JSON.stringify(KEY_SELECTORS)};
  const sel = 'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
  // 只认同一个元素或它的后代：祖先容器包含该元素，点祖先并不等于点中它，
  // 把祖先算进来会把所有小控件的命中区虚增成父容器的尺寸。
  const contains = (owner, hit) => !!(hit && (hit === owner || owner.contains(hit)));
  // 有些控件的视觉盒子小于命中区（例如 .ph-back 用 ::after{inset:-4px} 把命中区补到
  // 48px）。只量 getBoundingClientRect 会误判成「不达标」，所以盒子不足门槛时
  // 用 elementFromPoint 向外探，量出**真实**命中范围再判定。
  function probe(owner, r) {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const step = (dx, dy) => {
      let k = 0;
      for (let d = 1; d <= 12; d++) {
        const h = document.elementFromPoint(cx + dx * (r.width / 2 + d), cy + dy * (r.height / 2 + d));
        if (!contains(owner, h)) break;
        k = d;
      }
      return k;
    };
    const l = step(-1, 0), rr = step(1, 0), t = step(0, -1), b = step(0, 1);
    return { w: r.width + l + rr, h: r.height + t + b, pad: [l, rr, t, b] };
  }
  const out = { total: 0, violations: [], inlineExempt: 0, smallest: null, keyViolations: [], probed: [] };
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (el.disabled) continue;
    let r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) continue;
    // 「真实可点击区域」：input 被 label 包着时整行都是热区，取 label 的盒子
    let owner = el;
    if (el.tagName === 'INPUT') {
      const lab = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]'));
      if (lab) { owner = lab; r = lab.getBoundingClientRect(); }
    }
    // WCAG 2.2 的 inline 例外：正文里的行内链接不按目标尺寸卡
    const inlineInText = cs.display === 'inline' && el.tagName === 'A'
      && el.parentElement && /^(P|LI|SPAN|DIV|TD|DD)$/.test(el.parentElement.tagName)
      && (el.parentElement.textContent || '').trim().length > (el.textContent || '').trim().length;
    if (inlineInText) { out.inlineExempt++; continue; }
    out.total++;
    const label = (el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')).slice(0, 48);
    let ew = r.width, eh = r.height;
    if (ew < TH - 0.5 || eh < TH - 0.5) {
      owner.scrollIntoView({ block: 'center' });
      r = owner.getBoundingClientRect();
      const p = probe(owner, r);
      if (p.w > ew || p.h > eh) out.probed.push({ label, box: [+ew.toFixed(1), +eh.toFixed(1)], hit: [+p.w.toFixed(1), +p.h.toFixed(1)], pad: p.pad });
      ew = Math.max(ew, p.w);
      eh = Math.max(eh, p.h);
    }
    const ok = ew >= TH - 0.5 && eh >= TH - 0.5;
    if (!out.smallest || r.width * r.height < out.smallest.area) {
      out.smallest = { label, w: +r.width.toFixed(1), h: +r.height.toFixed(1), area: r.width * r.height };
    }
    if (!ok) {
      const isKey = el.matches(KEY) || (owner !== el && owner.matches(KEY));
      const rec = { label, w: +ew.toFixed(1), h: +eh.toFixed(1) };
      out.violations.push(rec);
      if (isKey) out.keyViolations.push(rec);
    }
  }
  // 关键操作单独卡 44：即便桌面阈值是 24，主要按钮也不许缩水
  out.keySmall = [];
  for (const el of document.querySelectorAll(KEY)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 0.5) continue;
    if (r.width < 43.5 || r.height < 43.5) {
      el.scrollIntoView({ block: 'center' });
      const p = probe(el, el.getBoundingClientRect());
      if (Math.max(p.w, r.width) < 43.5 || Math.max(p.h, r.height) < 43.5) {
        out.keySmall.push({ label: (el.tagName + '.' + String(el.className).split(' ')[0]).slice(0, 40), w: +Math.max(p.w, r.width).toFixed(1), h: +Math.max(p.h, r.height).toFixed(1) });
      }
    }
  }
  return out;
})()`;

for (const [w, h, mobile, label] of AUDIT_VIEWPORTS) {
  // 触控设备（模拟 mobile）一律按项目的 44px 卡，包括 768 平板；只有桌面视口
  // 退到 WCAG 2.2 AA 的 24px。比「到 768 就放宽」更严，避免平板被当成桌面。
  const threshold = mobile ? MIN : DESKTOP_MIN;
  console.log(`\n  视口 ${label}（门槛 ${threshold}px${threshold === MIN ? '，项目要求 44' : '，WCAG 2.2 AA 2.5.8 为 24'}）`);
  await setViewport(w, h, mobile);
  for (const page of PAGES) {
    if (page === 'policy.html') {
      await ensureDetailSession();
      await goto(`${BASE}/policy.html?id=gz_elderly_009`);
      await sleep(800);
    } else {
      await goto(`${BASE}/${page}`);
    }
    const r = await evalJs(auditJs(threshold, mobile));
    const detail = r.violations.slice(0, 3).map((v) => `${v.label} ${v.w}×${v.h}`).join('；');
    check(`${label} ${page} 可点击目标全部 ≥ ${threshold}px（测 ${r.total} 个，行内链接豁免 ${r.inlineExempt} 个）`,
      r.violations.length === 0, r.violations.length ? `不足：${detail}` : '');
    check(`${label} ${page} 关键操作 ≥ 44px`, r.keySmall.length === 0,
      r.keySmall.slice(0, 3).map((v) => `${v.label} ${v.w}×${v.h}`).join('；'));
    if (r.probed.length) {
      for (const p of r.probed.slice(0, 3)) {
        console.log(`      盒子 ${p.box[0]}×${p.box[1]} → 实际命中 ${p.hit[0]}×${p.hit[1]}（${p.label}，向外补 ${p.pad.join('/')}px）`);
      }
    }
    if (r.smallest) {
      console.log(`      最小目标 ${r.smallest.label} ${r.smallest.w}×${r.smallest.h}`);
    }
  }
}

console.log('\n== 7. 最小目标的真实点击命中测试（不看 CSS，看 elementFromPoint 与点击结果）==');
// 只挑「最可能出错」的两类：顶栏返回键、确认复选框所在整行。
{
  await setViewport(390, 844, true);
  await goto(`${BASE}/family.html`);
  const probe = await evalJs(`(() => {
    const back = document.querySelector('.back-link');
    const chk = document.getElementById('confirmCheck');
    const lab = chk && chk.closest('label');
    const pick = (el) => {
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      // 命中点取盒子中「离中心最远的可用点」——边缘最能暴露 padding 假热区
      const pts = { center: [r.left + r.width / 2, r.top + r.height / 2],
                    topEdge: [r.left + r.width / 2, r.top + 1.5],
                    bottomEdge: [r.left + r.width / 2, r.top + r.height - 1.5] };
      const hits = {};
      for (const [k, [x, y]] of Object.entries(pts)) {
        const hit = document.elementFromPoint(x, y);
        hits[k] = hit ? (hit.tagName + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(' ')[0] : '')) : null;
      }
      return { box: [r.width.toFixed(1), r.height.toFixed(1)], hits };
    };
    return { back: pick(back), label: pick(lab) };
  })()`);
  if (probe.back) {
    console.log(`  返回键 ${probe.back.box[0]}×${probe.back.box[1]}，命中：${JSON.stringify(probe.back.hits)}`);
    check('返回键上下边缘都命中的是按钮本身（热区真实覆盖 44px，不是 padding 假象）',
      Object.values(probe.back.hits).every((v) => v === 'A.back-link'));
  } else { FAIL++; console.log('  FAIL 没找到 .back-link'); }
  if (probe.label) {
    console.log(`  确认行 ${probe.label.box[0]}×${probe.label.box[1]}，命中：${JSON.stringify(probe.label.hits)}`);
    // 命中 label 自身或它内部的 span 都算命中整行（span 是 label 的子元素，
    // 点它一样触发 label 的勾选行为）。断言「不是裸的 18px 方块」即可。
    check('确认行上下边缘都落在 label 内（整行可点，不只是 18px 小方块）',
      Object.values(probe.label.hits).every((v) => v && (v === 'LABEL.confirm-line' || v === 'SPAN' || v === 'INPUT')));
  } else { FAIL++; console.log('  FAIL 没找到 #confirmCheck 外层 label'); }
}

console.log('\n注意：以上视口由 CDP Emulation.setDeviceMetricsOverride 模拟，');
console.log('不等同于真实 iOS Safari / Android / 微信内置浏览器的实测结论。');

ws.close();
child.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略占用 */ }

console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
