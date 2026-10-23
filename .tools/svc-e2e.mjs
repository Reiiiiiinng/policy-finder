/**
 * 首页「服务入口」点击行为回归（政策匹配 / 政策解读 / 办理指引 / 我的收藏）
 *
 *   node .tools/svc-e2e.mjs                          # 打本地后端
 *   set PF_BASE=https://.../policy-finder  && node .tools/svc-e2e.mjs   # 打线上静态站
 *
 * 用 CDP 驱动本机 Edge：真的点、真的导航、真的数请求。
 * 覆盖四种会话状态（无会话 / 家庭查询进行中 / 本人模式 / 已有结果）与四个服务入口，
 * 桌面 1440×900 与手机 390×844 各跑一遍。
 *
 * 本地跑需要先启动后端： python backend/server.py  （127.0.0.1:8000）
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.env.PF_BASE || 'http://127.0.0.1:8000').replace(/\/+$/, '');
// 本地版走 /api/match 网络请求，能数「提交了几次」；
// 部署版是纯静态站（data/policies.js 本地适配），没有网络请求可数，
// 那条断言改成「结果确实回来了」。
const HAS_API = /^http:\/\/127\.0\.0\.1/.test(BASE);
const PORT = 9331;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));

const FAMILY_TEXT = '我父亲72岁，一个人在广州生活，最近行动不方便。';
const SELF_TEXT = '我今年63岁，一个人住在广州，最近下楼越来越费劲。';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('ok   ' + name);
  } else {
    fail += 1;
    failures.push(name + (detail ? '  [' + detail + ']' : ''));
    console.log('FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 极简 CDP 客户端 ---------------- */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.requests = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Network.requestWillBeSent') {
        this.requests.push(msg.params.request.url);
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
      }, 30000);
    });
  }

  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error('eval failed: ' + (r.exceptionDetails.text || '')
        + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    }
    return r.result.value;
  }

  async waitFor(expr, timeoutMs = 20000, label = expr) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.eval('!!(' + expr + ')')) return true;
      } catch { /* 导航中执行上下文会短暂失效 */ }
      await sleep(120);
    }
    throw new Error('waitFor 超时：' + label);
  }

  async goto(path) {
    await this.send('Page.navigate', { url: BASE + path });
    await this.waitFor("document.readyState === 'complete'", 20000, path);
    // index.html 的入场动画（translateY 10px）跑完再量位置
    await sleep(400);
  }

  async click(sel) {
    const hit = await this.eval('(() => { const el = document.querySelector('
      + JSON.stringify(sel) + '); if (!el) return false; el.click(); return true; })()');
    if (!hit) throw new Error('找不到元素：' + sel);
  }

  matches() {
    return this.requests.filter((u) => /\/api\/match(\?|$)/.test(u));
  }

  resetRequests() {
    this.requests.length = 0;
  }
}

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

let profileDir = '';

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

/* ---------------- 用例 ---------------- */

async function viewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
}

async function seed(cdp, data) {
  await cdp.eval('sessionStorage.setItem("policy_finder_session", '
    + JSON.stringify(JSON.stringify(data)) + ')');
}

/**
 * 「点一次只提交一次」的判定。
 * 本地版：数 /api/match 网络请求，必须恰好 1 次；
 * 部署版：静态站没有后端请求可数，退化为「结果确实渲染出来了」。
 */
function submitOnce(name, cdp, cards) {
  if (HAS_API) {
    ok(name + '：只提交一次匹配请求', cdp.matches().length === 1,
      'match requests=' + cdp.matches().length);
  } else {
    ok(name + '：结果已渲染（静态站无后端请求可数）', cards > 0, 'cards=' + cards);
  }
}

async function case1_noSession(cdp, tag) {
  await cdp.goto('/index.html');
  await cdp.eval('sessionStorage.clear(); localStorage.clear();');
  await cdp.goto('/index.html');
  await cdp.click('.svc[data-svc="match"]');
  await sleep(900); // 平滑滚动

  const s = await cdp.eval(`(() => {
    const box = document.getElementById('entry');
    const tip = document.getElementById('entryPrompt');
    const r = box.getBoundingClientRect();
    const toast = document.getElementById('pfToast');
    return {
      path: location.pathname,
      y: window.scrollY,
      top: Math.round(r.top),
      prompt: tip ? tip.textContent : '',
      role: tip ? tip.getAttribute('role') : '',
      prompted: box.classList.contains('is-prompted'),
      toast: toast ? toast.textContent : '',
      choices: document.querySelectorAll('.choice.entry').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);

  ok(tag + ' 无会话点击后仍停在首页', s.path.endsWith('/index.html'), s.path);
  ok(tag + ' 无会话点击后滚到对象选择区', s.y > 200 && s.top > -60 && s.top < 240,
    'scrollY=' + s.y + ' top=' + s.top);
  ok(tag + ' 无会话点击后出现「请先选择」提示', /请先选择/.test(s.prompt), s.prompt);
  ok(tag + ' 提示对读屏可见（role=status）', s.role === 'status', s.role);
  ok(tag + ' 三张对象卡被高亮', s.prompted === true);
  ok(tag + ' Toast 说明下一步', /请先选择/.test(s.toast), s.toast);
  ok(tag + ' 三种查询对象入口都在', s.choices === 3, 'count=' + s.choices);
  ok(tag + ' 无横向溢出', s.overflow <= 0, 'overflow=' + s.overflow);

  // 选完对象后提示立即消失，并进入家庭协助流程
  await cdp.click('.choice.entry[data-target="parents"]');
  await sleep(90);
  const tipRemoved = await cdp.eval('!document.getElementById("entryPrompt")');
  await cdp.waitFor("location.pathname.endsWith('/family.html')", 12000, 'family.html');
  const after = await cdp.eval('(() => ({ path: location.pathname }))()');
  ok(tag + ' 选过对象后「请先选择」提示立即消失', tipRemoved === true);
  ok(tag + ' 选「我的父母」后进入家庭协助流程', after.path.endsWith('/family.html'), after.path);
}

async function case2_familyInProgress(cdp, tag) {
  await cdp.goto('/index.html');
  await seed(cdp, {
    target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
    demo: false, demoBanner: false, profile: {}, text: FAMILY_TEXT,
  });
  cdp.resetRequests();
  await cdp.click('.svc[data-svc="match"]');
  await cdp.waitFor("location.pathname.endsWith('/discover.html')", 12000, 'discover.html');
  await cdp.waitFor("document.querySelectorAll('.result-card').length > 0", 25000, '结果卡');

  const s = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    const input = document.getElementById('situation');
    return {
      path: location.pathname,
      cards: document.querySelectorAll('.result-card').length,
      text: saved.text || '',
      beneficiary: saved.beneficiary || '',
      input: input ? input.value : '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);

  ok(tag + ' 家庭查询进行中：进入发现页', s.path.endsWith('/discover.html'), s.path);
  ok(tag + ' 家庭查询进行中：结果已恢复', s.cards > 0, 'cards=' + s.cards);
  ok(tag + ' 家庭查询进行中：查询内容保留', s.text === FAMILY_TEXT && s.input.trim() === FAMILY_TEXT,
    'store=' + s.text.slice(0, 12) + ' input=' + s.input.slice(0, 12));
  ok(tag + ' 家庭查询进行中：帮助对象保留', s.beneficiary === '父亲', s.beneficiary);
  submitOnce(tag + ' 家庭查询进行中', cdp, s.cards);
  ok(tag + ' 发现页无横向溢出', s.overflow <= 0, 'overflow=' + s.overflow);
}

async function case3_selfMode(cdp, tag) {
  await cdp.goto('/index.html');
  await seed(cdp, {
    target: 'self', operator: '本人', confirmed: true,
    demo: false, demoBanner: false, selfText: SELF_TEXT, selfProfile: {},
  });
  cdp.resetRequests();
  await cdp.click('.svc[data-svc="match"]');
  await cdp.waitFor("location.pathname.endsWith('/self.html')", 12000, 'self.html');
  await cdp.waitFor("document.querySelectorAll('.result-card').length > 0", 25000, '本人模式结果');

  const s = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    const input = document.getElementById('situation');
    return {
      path: location.pathname,
      cards: document.querySelectorAll('.result-card').length,
      selfText: saved.selfText || '',
      input: input ? input.value : '',
    };
  })()`);

  ok(tag + ' 本人模式：进入本人页而不是家庭协助', s.path.endsWith('/self.html'), s.path);
  ok(tag + ' 本人模式：结果已恢复', s.cards > 0, 'cards=' + s.cards);
  ok(tag + ' 本人模式：查询内容保留', s.selfText === SELF_TEXT && s.input.trim() === SELF_TEXT);
  submitOnce(tag + ' 本人模式', cdp, s.cards);
}

async function case4_existingResults(cdp, tag) {
  await cdp.goto('/index.html');
  await seed(cdp, {
    target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
    demo: false, demoBanner: false, profile: {}, text: FAMILY_TEXT,
  });
  await cdp.click('.svc[data-svc="match"]');
  await cdp.waitFor("location.pathname.endsWith('/discover.html')", 12000, 'discover.html');
  await cdp.waitFor("document.querySelectorAll('.result-card').length > 0", 25000, '首次结果');
  const first = await cdp.eval(`(() => ({
    cards: document.querySelectorAll('.result-card').length,
    ids: [...document.querySelectorAll('.result-card')].map((c) => c.dataset.id).join(','),
  }))()`);

  // 已有结果后回到首页，再点一次「政策匹配」
  await cdp.goto('/index.html');
  cdp.resetRequests();
  await cdp.click('.svc[data-svc="match"]');
  await cdp.waitFor("location.pathname.endsWith('/discover.html')", 12000, 'discover.html 第二次');
  await cdp.waitFor("document.querySelectorAll('.result-card').length > 0", 25000, '第二次结果');

  const second = await cdp.eval(`(() => {
    const input = document.getElementById('situation');
    return {
      cards: document.querySelectorAll('.result-card').length,
      ids: [...document.querySelectorAll('.result-card')].map((c) => c.dataset.id).join(','),
      input: input ? input.value : '',
    };
  })()`);

  ok(tag + ' 已有结果：结果条数不丢失', second.cards === first.cards,
    first.cards + ' -> ' + second.cards);
  ok(tag + ' 已有结果：命中的条目一致', second.ids === first.ids);
  ok(tag + ' 已有结果：输入内容没有被清空', second.input.trim() === FAMILY_TEXT);
  submitOnce(tag + ' 已有结果（不重复提交）', cdp, second.cards);
}

async function case5_otherEntries(cdp, tag) {
  // 政策解读 / 办理指引：进入发现页并给出对应指路提示
  for (const [svc, expect] of [['detail', /这是什么/], ['guide', /怎么办理/]]) {
    await cdp.goto('/index.html');
    await seed(cdp, {
      target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
      demo: false, demoBanner: false, profile: {}, text: FAMILY_TEXT,
    });
    await cdp.click('.svc[data-svc="' + svc + '"]');
    await cdp.waitFor("location.pathname.endsWith('/discover.html')", 12000, svc + ' -> discover');
    let toastText = '';
    try {
      await cdp.waitFor("(document.getElementById('pfToast') || {}).textContent", 25000, svc + ' toast');
      toastText = await cdp.eval("(document.getElementById('pfToast') || {}).textContent || ''");
    } catch { toastText = ''; }
    const consumed = await cdp.eval('sessionStorage.getItem("pf_svc_intent")');
    const landed = await cdp.eval('location.pathname');
    ok(tag + ' ' + svc + ' 入口进入发现页', landed.endsWith('/discover.html'), landed);
    ok(tag + ' ' + svc + ' 入口给出对应指路提示', expect.test(toastText), toastText);
    ok(tag + ' ' + svc + ' 入口的 intent 读完即清', consumed === null, String(consumed));
  }

  // 我的收藏：有收藏时留在首页并滚到收藏区
  await cdp.goto('/index.html');
  await cdp.eval('localStorage.setItem("pf_saved", JSON.stringify([{id:"gz_elderly_001", name:"老年人照护需求综合评估"}]))');
  await cdp.goto('/index.html');
  const savedVisible = await cdp.eval('(() => { const s = document.getElementById("savedSec"); return !!s && !s.hidden; })()');
  ok(tag + ' 有收藏时首页收藏区出现', savedVisible === true);
  await cdp.click('.svc[data-svc="saved"]');
  await sleep(900);
  const savedState = await cdp.eval(`(() => {
    const s = document.getElementById('savedSec');
    const r = s.getBoundingClientRect();
    return { path: location.pathname, y: window.scrollY, top: Math.round(r.top) };
  })()`);
  ok(tag + ' 有收藏时点「我的收藏」留在首页并滚到收藏区',
    savedState.path.endsWith('/index.html') && savedState.y > 0 && savedState.top > -80 && savedState.top < 400,
    'y=' + savedState.y + ' top=' + savedState.top);

  // 我的收藏：没有收藏时送到「我的」页，而不是点了没反应
  await cdp.eval('localStorage.removeItem("pf_saved")');
  await cdp.goto('/index.html');
  await cdp.click('.svc[data-svc="saved"]');
  await cdp.waitFor("location.pathname.endsWith('/mine.html')", 12000, 'mine.html');
  ok(tag + ' 没有收藏时点「我的收藏」进入我的页', true);
}

async function main() {
  if (!EDGE) {
    console.log('未找到本机浏览器（msedge.exe / chrome.exe），无法实测。');
    return 1;
  }
  try {
    const health = await fetch(BASE + '/api/health');
    if (!health.ok) throw new Error('health ' + health.status);
  } catch {
    console.log('后端未启动，请先运行： python backend/server.py');
    return 1;
  }

  profileDir = await mkdtemp(join(tmpdir(), 'svc-e2e-'));
  const edge = launch();
  let cdp;
  try {
    const wsUrl = await connect();
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    // 桌面
    await viewport(cdp, 1440, 900);
    console.log('\n== 1440×900 桌面 ==');
    await case1_noSession(cdp, '[1440]');
    await case2_familyInProgress(cdp, '[1440]');
    await case3_selfMode(cdp, '[1440]');
    await case4_existingResults(cdp, '[1440]');
    await case5_otherEntries(cdp, '[1440]');

    // 手机
    await viewport(cdp, 390, 844);
    console.log('\n== 390×844 手机 ==');
    await case1_noSession(cdp, '[390]');
    await case2_familyInProgress(cdp, '[390]');
    await case4_existingResults(cdp, '[390]');
    await case5_otherEntries(cdp, '[390]');
  } catch (e) {
    ok('用例执行未中断', false, String(e && e.message || e));
  } finally {
    try { edge.kill(); } catch { /* 已退出 */ }
    await sleep(300);
    await rm(profileDir, { recursive: true, force: true });
  }

  console.log('\n结果：通过 ' + pass + '，失败 ' + fail);
  if (failures.length) console.log('失败项：\n  - ' + failures.join('\n  - '));
  return fail ? 1 : 0;
}

main().then((code) => process.exit(code));
