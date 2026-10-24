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

/**
 * 确定性竞态闸门（注入到每个新文档，页面加载前执行）。
 * 仅当 sessionStorage 里 pf_race_hold='1' 时拦截 /api/match：
 * 把已发出的响应 Promise 扣进 window.__holds（按请求顺序），
 * 测试先放行哪个、后放行哪个，返回顺序就完全由测试决定，
 * 不依赖真实网络延迟。其余请求原样透传。
 */
const RACE_HOLD_SCRIPT = `
(function () {
  try {
    if (sessionStorage.getItem('pf_race_hold') !== '1') return;
    const orig = window.fetch ? window.fetch.bind(window) : null;
    if (!orig) return;
    window.__holds = [];
    window.fetch = function (input, init) {
      const p = orig.apply(this, arguments);
      let url = '';
      if (typeof input === 'string') url = input;
      else if (input && input.url) url = input.url;
      if (url.indexOf('/api/match') >= 0) {
        let release;
        const gate = new Promise(function (r) { release = r; });
        window.__holds.push(release);
        return gate.then(function () { return p; });
      }
      return p;
    };
  } catch (e) { /* 不影响正常加载 */ }
})();`

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

  // 本人查询后「我的」页必须认得这次查询：会话里存的是 selfText，
  // 只认 text 的话这里会显示「还没有查询过」（实测复现过）。
  await cdp.goto('/mine.html');
  await cdp.waitFor("document.querySelectorAll('#queryBox .q-who').length > 0", 12000, '我的页查询卡');
  const mine = await cdp.eval(`(() => {
    const q = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
    const back = document.querySelector('#queryBox .q-acts a');
    return {
      who: q('#queryBox .q-who'),
      text: q('#queryBox .q-text'),
      fam: q('#famGrid'),
      back: back ? back.getAttribute('href') : '',
    };
  })()`);
  ok(tag + ' 本人模式：我的页认得本次查询',
    mine.who === '本人模式' && mine.text === SELF_TEXT, JSON.stringify(mine));
  ok(tag + ' 本人模式：我的页家庭成员显示本人', mine.fam.indexOf('本人') >= 0, mine.fam);
  ok(tag + ' 本人模式：回到发现结果指向本人页', mine.back === 'self.html', mine.back);

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

/**
 * 双模式画像严格隔离（行为级）：
 *   1) 两份画像都在场时，「我的」页与详情页只认 lastQuery 指向的那份；
 *   2) 清空当前查询不得覆盖另一模式已保存的资料；
 *   3) lastQuery 指向的模式画像缺失时，页面走安全空状态，
 *      另一模式的年龄/文本/受益人不得冒充当前模式出现；
 *   4) 同一页连续两次匹配，最终界面必须是最后一次输入的结果。
 */
async function case6_mixedModeIsolation(cdp, tag) {
  // —— 两份画像都在场，lastQuery=family ——
  await cdp.goto('/index.html');
  await seed(cdp, {
    target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
    demo: false, demoBanner: false, lastQuery: 'family',
    text: FAMILY_TEXT,
    profile: { mode: 'family', age: 72, region: '广州市', scenes: ['独居', '行动不便'], who: '父亲' },
    selfText: SELF_TEXT,
    selfProfile: { mode: 'self', age: 63, region: '广州市', scenes: ['行动不便'] },
  });
  await cdp.goto('/mine.html');
  await cdp.waitFor("document.querySelectorAll('#queryBox').length > 0", 12000, '我的页');
  const mixed = await cdp.eval(`(() => {
    const q = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
    const back = document.querySelector('#queryBox .q-acts a');
    return {
      who: q('#queryBox .q-who'),
      text: q('#queryBox .q-text'),
      fam: q('#famGrid'),
      back: back ? back.getAttribute('href') : '',
    };
  })()`);
  ok(tag + ' 混合会话：我的页显示当前（家庭）查询卡',
    mixed.who === '帮父亲' && mixed.text === FAMILY_TEXT, JSON.stringify(mixed));
  ok(tag + ' 混合会话：本人内容不冒充家庭查询', mixed.text.indexOf('63') < 0, mixed.text);
  ok(tag + ' 混合会话：家庭成员格显示当前受益人', mixed.fam.indexOf('父亲') >= 0, mixed.fam);

  await cdp.goto('/policy.html?id=gz_elderly_002');
  await cdp.waitFor("document.querySelectorAll('.dhead').length > 0", 15000, '家庭模式详情页');
  const polFam = await cdp.eval(`(() => {
    const back = document.querySelector('.topbar .back-link');
    const v = document.querySelector('.ds-v');
    return { back: back ? back.getAttribute('href') : '', matchTo: v ? v.textContent.trim() : '' };
  })()`);
  ok(tag + ' 混合会话：家庭模式详情返回发现页', polFam.back === 'discover.html', polFam.back);
  ok(tag + ' 混合会话：详情页匹配给家人而非「您本人」',
    polFam.matchTo.indexOf('父亲') >= 0 && polFam.matchTo.indexOf('您本人') < 0, polFam.matchTo);

  // —— 清空家庭查询：本人那组资料必须原样保留 ——
  await cdp.goto('/mine.html');
  await cdp.waitFor("document.querySelectorAll('#qClear').length > 0", 12000, '清空按钮');
  await cdp.click('#qClear');
  await cdp.waitFor("document.querySelectorAll('#queryBox .q-who').length > 0", 12000, '清空后重绘');
  const afterClear = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    const q = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
    return {
      lastQuery: saved.lastQuery || '', selfText: saved.selfText || '', text: saved.text || '',
      selfAge: saved.selfProfile ? saved.selfProfile.age : null,
      who: q('#queryBox .q-who'), text: q('#queryBox .q-text'),
    };
  })()`);
  ok(tag + ' 清空后 lastQuery 切到留有资料的模式', afterClear.lastQuery === 'self', afterClear.lastQuery);
  ok(tag + ' 清空家庭不覆盖本人资料',
    afterClear.selfText === SELF_TEXT && afterClear.selfAge === 63, JSON.stringify(afterClear));
  ok(tag + ' 清空后我的页显示本人查询卡',
    afterClear.who === '本人模式' && afterClear.text === SELF_TEXT,
    afterClear.who + '/' + afterClear.text);

  // —— 「管理」重绘零新增监听器（修复重复绑定），且交互不被破坏 ——
  const bindProbe = await cdp.eval(`(() => {
    let added = 0;
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (this && this.id === 'famManage' && type === 'click') added += 1;
      return orig.call(this, type, fn, opts);
    };
    window.paintFamily();
    window.paintFamily();
    window.paintFamily();
    EventTarget.prototype.addEventListener = orig;
    return { added };
  })()`);
  ok(tag + ' 多次重绘家庭区不再向「管理」累加监听器', bindProbe.added === 0, JSON.stringify(bindProbe));
  await cdp.click('#famManage');
  await cdp.waitFor("location.pathname.endsWith('/family.html')", 12000, '管理跳转');
  ok(tag + ' 重绘多次后点「管理」仍正常进入家庭协助页', true);

  // —— lastQuery=self 但本人画像缺失：家庭旧数据不得顶替当前模式 ——
  await seed(cdp, {
    target: 'self', operator: '女儿', beneficiary: '父亲',
    demo: false, demoBanner: false, lastQuery: 'self',
    text: FAMILY_TEXT,
    profile: { mode: 'family', age: 72, region: '广州市', scenes: ['独居'], who: '父亲' },
    selfProfile: {}, selfText: '',
  });
  await cdp.goto('/mine.html');
  await cdp.waitFor("document.querySelectorAll('#queryBox').length > 0", 12000, '我的页（缺失态）');
  const stale = await cdp.eval(`(() => {
    const q = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
    return {
      who: q('#queryBox .q-who'),
      text: q('#queryBox .q-text'),
      empty: document.querySelectorAll('#queryBox .empty-mini').length,
      fam: q('#famGrid'),
    };
  })()`);
  ok(tag + ' 画像缺失：我的页走空状态而非家庭旧查询',
    stale.empty >= 1 && stale.who === '' && stale.text.indexOf('72') < 0, JSON.stringify(stale));
  ok(tag + ' 画像缺失：家庭成员格不显示家庭受益人', stale.fam.indexOf('父亲') < 0, stale.fam);

  await cdp.goto('/policy.html?id=gz_elderly_002');
  await cdp.waitFor("document.querySelectorAll('.dhead').length > 0", 15000, '详情页（缺失态）');
  const polStale = await cdp.eval(`(() => {
    const back = document.querySelector('.topbar .back-link');
    const v = document.querySelector('.ds-v');
    const generic = document.body.textContent.indexOf('通用权益提示') >= 0;
    return { back: back ? back.getAttribute('href') : '', matchTo: v ? v.textContent.trim() : '', generic };
  })()`);
  ok(tag + ' 画像缺失：详情页仍按本人模式返回', polStale.back === 'self.html', polStale.back);
  ok(tag + ' 画像缺失：详情页走通用提示而非家庭画像',
    polStale.generic && polStale.matchTo === '您本人', JSON.stringify(polStale));

  // —— 同一页连续两次匹配：以最后一次输入为准 ——
  await seed(cdp, {
    target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
    demo: false, demoBanner: false,
  });
  await cdp.goto('/discover.html');
  await cdp.waitFor("document.querySelectorAll('#esStart').length > 0", 12000, '空态开始按钮');
  await cdp.click('#esStart');
  await cdp.eval("document.getElementById('situation').value = '我父亲72岁，一个人在广州生活，最近行动不方便。'");
  await cdp.click('#discoverBtn');
  await cdp.eval("document.getElementById('situation').value = '我母亲75岁，一个人在广州生活，最近走路越来越困难。'");
  await cdp.click('#discoverBtn');
  await cdp.waitFor("document.querySelectorAll('.result-card').length > 0", 25000, '连点后结果');
  const rapid = await cdp.eval(`(() => {
    const vals = [...document.querySelectorAll('.board-fact .bf-v')].map((x) => x.textContent.trim());
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    return {
      vals: vals.join('|'),
      age: saved.profile ? saved.profile.age : null,
      input: document.getElementById('situation').value,
    };
  })()`);
  ok(tag + ' 连续两次匹配以最后一次输入为准',
    rapid.age === 75 && rapid.input.indexOf('75') >= 0, JSON.stringify(rapid));
  ok(tag + ' 确认台不残留上一次的年龄', rapid.vals.indexOf('72 岁') < 0, rapid.vals);
}

/**
 * 场景 4（行为级）：lastQuery='family'，家庭画像缺失（空占位），仅本人资料在场。
 * 验证：我的页不把本人内容当家庭当前查询、家庭缺画像显示空状态、
 * 详情/发现页不借 selfProfile 匹配、返回按 lastQuery、本人资料不被覆盖、
 * 刷新后隔离规则不变。全部断言读真实页面内容与会话状态。
 */
async function case7_familyMissingProfile(cdp, tag) {
  await cdp.goto('/index.html');
  await seed(cdp, {
    target: 'parents', confirmed: true,
    demo: false, demoBanner: false, lastQuery: 'family',
    text: '', profile: {},
    selfText: SELF_TEXT,
    selfProfile: { mode: 'self', age: 63, region: '广州市', scenes: ['行动不便'] },
  });

  // 我的页：空状态 + 引导回家庭发现页 + 本人内容零泄漏 + 资料原样保留
  await cdp.goto('/mine.html');
  await cdp.waitFor("document.querySelectorAll('#queryBox').length > 0", 12000, '我的页（场景4）');
  const mine = await cdp.eval(`(() => {
    const q = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
    const go = document.querySelector('#queryBox #qGo');
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    return {
      who: q('#queryBox .q-who'),
      text: q('#queryBox .q-text'),
      empty: document.querySelectorAll('#queryBox .empty-mini').length,
      hasGo: !!go,
      fam: q('#famGrid'),
      bodyNoSelf: document.body.textContent.indexOf('63') < 0,
      selfTextKept: saved.selfText === ${JSON.stringify(SELF_TEXT)},
      selfAgeKept: saved.selfProfile ? saved.selfProfile.age : null,
      lastQuery: saved.lastQuery || '',
    };
  })()`);
  ok(tag + ' 场景4：我的页走空状态而非查询卡',
    mine.empty >= 1 && mine.who === '' && mine.text === '', JSON.stringify(mine));
  ok(tag + ' 场景4：本人文本/年龄不冒充家庭当前查询', mine.bodyNoSelf, '页面出现本人数据');
  ok(tag + ' 场景4：家庭成员格不显示本人', mine.fam.indexOf('本人') < 0, mine.fam);
  ok(tag + ' 场景4：本人资料原样保留',
    mine.selfTextKept && mine.selfAgeKept === 63, JSON.stringify(mine));
  ok(tag + ' 场景4：lastQuery 保持 family', mine.lastQuery === 'family', mine.lastQuery);
  // 空状态的「去发现」必须把家庭模式的用户送去家庭发现页（真实点击验证路由）
  ok(tag + ' 场景4：空状态提供重新查询入口', mine.hasGo, '');
  await cdp.click('#qGo');
  await cdp.waitFor("location.pathname.endsWith('/discover.html')", 12000, '空状态路由到家庭发现页');
  ok(tag + ' 场景4：空状态点击后进入家庭发现页', true);

  // 详情页：无家庭画像可复现 → 不重跑匹配；返回仍按 lastQuery=family
  cdp.resetRequests();
  await cdp.goto('/policy.html?id=gz_elderly_002');
  await cdp.waitFor("document.querySelectorAll('.dhead').length > 0", 15000, '场景4详情页');
  const pol = await cdp.eval(`(() => {
    const back = document.querySelector('.topbar .back-link');
    const v = document.querySelector('.ds-v');
    return {
      back: back ? back.getAttribute('href') : '',
      matchTo: v ? v.textContent.trim() : '',
      hasFit: !!document.querySelector('.ds-fit'),
      generic: document.body.textContent.indexOf('通用权益提示') >= 0,
      noSelfText: document.body.textContent.indexOf('下楼越来越费劲') < 0,
      noSelfAge: document.body.textContent.indexOf('63 岁') < 0,
    };
  })()`);
  ok(tag + ' 场景4：详情页不借本人画像重跑匹配',
    cdp.matches().length === 0, 'match urls=' + cdp.matches().join(' ; '));
  ok(tag + ' 场景4：详情页返回目标仍按 lastQuery=family', pol.back === 'discover.html', pol.back);
  ok(tag + ' 场景4：详情页走通用提示（无符合度小卡）',
    pol.generic && !pol.hasFit, JSON.stringify(pol));
  ok(tag + ' 场景4：匹配给不显示「您本人」', pol.matchTo !== '您本人', pol.matchTo);
  ok(tag + ' 场景4：详情页不含本人文本/年龄',
    pol.noSelfText && pol.noSelfAge, '');

  // 恢复页面：家庭发现页不得用本人资料自动匹配
  cdp.resetRequests();
  await cdp.goto('/discover.html');
  await cdp.waitFor("document.querySelectorAll('#esStart').length > 0", 12000, '发现页空态（场景4）');
  const disc = await cdp.eval(`(() => ({
    cards: document.querySelectorAll('.result-card').length,
    input: (document.getElementById('situation') || {}).value || '',
  }))()`);
  ok(tag + ' 场景4：发现页恢复时不自动用本人资料匹配',
    cdp.matches().length === 0 && disc.cards === 0 && disc.input.indexOf('63') < 0,
    JSON.stringify(disc));

  // 刷新隔离：再次进入我的页，隔离与资料保留规则不变
  await cdp.goto('/mine.html');
  await cdp.waitFor("document.querySelectorAll('#queryBox').length > 0", 12000, '我的页刷新（场景4）');
  const again = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    const q = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
    return {
      empty: document.querySelectorAll('#queryBox .empty-mini').length,
      who: q('#queryBox .q-who'),
      selfTextKept: saved.selfText === ${JSON.stringify(SELF_TEXT)},
      selfAgeKept: saved.selfProfile ? saved.selfProfile.age : null,
      lastQuery: saved.lastQuery || '',
    };
  })()`);
  ok(tag + ' 场景4：刷新后仍走空状态隔离',
    again.empty >= 1 && again.who === '', JSON.stringify(again));
  ok(tag + ' 场景4：刷新后本人资料与 lastQuery 均保持',
    again.selfTextKept && again.selfAgeKept === 63 && again.lastQuery === 'family',
    JSON.stringify(again));
}

/**
 * 确定性异步竞态（行为级）：用 RACE_HOLD_SCRIPT 闸门把 /api/match 响应扣住，
 * 由测试决定返回顺序——旧请求 A 最后返回，必须被序号守卫丢弃。
 * 仅本地后端模式执行（静态站匹配走本地引擎，没有网络请求可扣）。
 */
async function case8_raceDeterministic(cdp, tag) {
  await seed(cdp, {
    target: 'parents', operator: '女儿', beneficiary: '父亲', confirmed: true,
    demo: false, demoBanner: false,
  });
  await cdp.goto('/index.html');
  await cdp.eval("sessionStorage.setItem('pf_race_hold', '1')");
  await cdp.goto('/discover.html');
  await cdp.waitFor("document.querySelectorAll('#esStart').length > 0", 12000, '空态开始按钮（竞态）');
  await cdp.click('#esStart');
  await cdp.eval("document.getElementById('situation').value = '我父亲72岁，一个人在广州生活，最近行动不方便。'");
  cdp.resetRequests();
  await cdp.click('#discoverBtn');   // A：发出后被闸门扣住
  await cdp.eval("document.getElementById('situation').value = '我母亲75岁，一个人在广州生活，最近走路越来越困难。'");
  await cdp.click('#discoverBtn');   // B：发出后被闸门扣住
  await cdp.waitFor('window.__holds && window.__holds.length === 2', 15000, '两个匹配请求均已扣住');
  const held = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    return { text: saved.text || '', age: saved.profile ? saved.profile.age : null };
  })()`);
  ok(tag + ' 竞态：两个请求都未返回时不得写会话',
    held.text === '' && held.age === null, JSON.stringify(held));

  // 先放行 B（新请求）：B 完成并渲染
  await cdp.eval('window.__holds[1]()');
  await cdp.waitFor("document.querySelectorAll('.result-card').length > 0", 25000, 'B 结果渲染');
  const afterB = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    const vals = [...document.querySelectorAll('.board-fact .bf-v')].map((x) => x.textContent.trim());
    return {
      age: saved.profile ? saved.profile.age : null,
      text: saved.text || '',
      lastQuery: saved.lastQuery || '',
      cards: document.querySelectorAll('.result-card').length,
      vals: vals.join('|'),
    };
  })()`);
  ok(tag + ' 竞态：B 先完成，界面与会话都是 B',
    afterB.age === 75 && afterB.text.indexOf('75') >= 0 && afterB.lastQuery === 'family',
    JSON.stringify(afterB));

  // 再放行 A（旧请求）：A 最后返回，必须被丢弃——结果、画像、文本、lastQuery 全都不许变
  await cdp.eval('window.__holds[0]()');
  await sleep(1000);
  const afterA = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    const vals = [...document.querySelectorAll('.board-fact .bf-v')].map((x) => x.textContent.trim());
    return {
      age: saved.profile ? saved.profile.age : null,
      text: saved.text || '',
      lastQuery: saved.lastQuery || '',
      cards: document.querySelectorAll('.result-card').length,
      vals: vals.join('|'),
    };
  })()`);
  ok(tag + ' 竞态：A 迟到不得覆盖 B 的画像/文本/lastQuery',
    afterA.age === 75 && afterA.text === afterB.text && afterA.lastQuery === 'family',
    JSON.stringify(afterA));
  ok(tag + ' 竞态：A 迟到不得改写 B 的页面结果',
    afterA.cards === afterB.cards && afterA.vals === afterB.vals, afterA.vals);

  // —— 确认按钮连点：先答户籍再答医保（第一次匹配仍被扣住时），两次作答都必须保留 ——
  // 此刻 B 的确认台在页面上：点户籍=是（match 被扣住）→ 点医保=否（match 被扣住）
  const beforeConfirms = await cdp.eval('window.__holds.length');
  await cdp.eval(`(() => {
    const btn = document.querySelector('[data-confirm="hukou"][data-value="true"]');
    btn.click();
  })()`);
  await cdp.waitFor('window.__holds.length === ' + (beforeConfirms + 1), 15000, '户籍确认的匹配已扣住');
  const probe1 = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    return { hukou: saved.profile ? saved.profile.hukou : 'no-profile' };
  })()`);
  ok(tag + ' 竞态：户籍作答立即落库（不等匹配返回）', probe1.hukou === true, JSON.stringify(probe1));
  await cdp.eval(`(() => {
    const btn = document.querySelector('[data-confirm="insurance"][data-value="false"]');
    btn.click();
  })()`);
  await cdp.waitFor('window.__holds.length === ' + (beforeConfirms + 2), 15000, '医保确认的匹配已扣住');
  const probe2 = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    return { hukou: saved.profile ? saved.profile.hukou : 'no-profile',
             insurance: saved.profile ? saved.profile.insurance : 'none' };
  })()`);
  ok(tag + ' 竞态：医保作答落库时户籍作答仍在', probe2.hukou === true && probe2.insurance === false, JSON.stringify(probe2));
  // 放行顺序与请求顺序相同：先旧后新，最后返回的必须是最新的那次
  await cdp.eval('window.__holds[' + (beforeConfirms + 1) + ']()');
  await cdp.eval('window.__holds[' + beforeConfirms + ']()');
  await cdp.waitFor("document.querySelectorAll('.board-cond').length > 0", 25000, '确认后重绘');
  await sleep(800);
  const confirms = await cdp.eval(`(() => {
    const saved = JSON.parse(sessionStorage.getItem('policy_finder_session') || '{}');
    const picked = [...document.querySelectorAll('.board-cond .is-picked')]
      .map((b) => b.textContent.trim()).join('|');
    return { hukou: saved.profile ? saved.profile.hukou : null,
             insurance: saved.profile ? saved.profile.insurance : null, picked };
  })()`);
  ok(tag + ' 竞态：连点两个确认项，两次作答都保留',
    confirms.hukou === true && confirms.insurance === false, JSON.stringify(confirms));
  ok(tag + ' 竞态：确认台选中态与两次作答一致',
    confirms.picked.indexOf('是') >= 0 && confirms.picked.indexOf('否') >= 0, confirms.picked);
  await cdp.eval("sessionStorage.removeItem('pf_race_hold')");
}

async function main() {
  if (!EDGE) {
    console.log('未找到本机浏览器（msedge.exe / chrome.exe），无法实测。');
    return 1;
  }
  // 线上静态站（PF_BASE 指向 GitHub Pages）没有后端：匹配走 data/policies.js 的本地实现，
  // 此时不检查 /api/health，也不统计网络请求（由 HAS_API 决定断言强度）。
  if (HAS_API) {
    try {
      const health = await fetch(BASE + '/api/health');
      if (!health.ok) throw new Error('health ' + health.status);
    } catch {
      console.log('后端未启动，请先运行： python backend/server.py');
      return 1;
    }
  } else {
    console.log('静态站模式：' + BASE + '（匹配走本地实现，跳过 /api 请求计数）');
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
    // 确定性竞态闸门：仅在 sessionStorage 置了 pf_race_hold 的页面上生效——
    // /api/match 的响应被扣住，直到测试按任意顺序调用 window.__holds[i]() 释放。
    // 其余页面不受影响；静态站模式没有 /api 网络请求，该脚本天然是空操作。
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RACE_HOLD_SCRIPT });

    // 桌面
    await viewport(cdp, 1440, 900);
    console.log('\n== 1440×900 桌面 ==');
    await case1_noSession(cdp, '[1440]');
    await case2_familyInProgress(cdp, '[1440]');
    await case3_selfMode(cdp, '[1440]');
    await case4_existingResults(cdp, '[1440]');
    await case5_otherEntries(cdp, '[1440]');
    await case6_mixedModeIsolation(cdp, '[1440]');
    await case7_familyMissingProfile(cdp, '[1440]');
    if (HAS_API) await case8_raceDeterministic(cdp, '[1440]');
    else console.log('（静态站无 /api 请求，确定性竞态用例仅本地后端模式执行）');

    // 手机
    await viewport(cdp, 390, 844);
    console.log('\n== 390×844 手机 ==');
    await case1_noSession(cdp, '[390]');
    await case2_familyInProgress(cdp, '[390]');
    await case4_existingResults(cdp, '[390]');
    await case5_otherEntries(cdp, '[390]');
    await case6_mixedModeIsolation(cdp, '[390]');
    await case7_familyMissingProfile(cdp, '[390]');
  } catch (e) {
    ok('用例执行未中断', false, String(e && e.message || e));
  } finally {
    try { edge.kill(); } catch { /* 已退出 */ }
    // Windows 上 Edge 退出有延迟：进程没退干净时 first_party_sets.db 等文件仍被
    // 占用，直接 rm 会 EBUSY——断言全过也会在收尾时把进程崩掉，退出码变成 1。
    // 所以先等 exit 事件（最多 3 秒），仍删不掉就放弃清理，临时目录交给系统回收。
    await new Promise((resolve) => {
      if (edge.exitCode !== null) return resolve();
      edge.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    await sleep(200);
    try {
      await rm(profileDir, { recursive: true, force: true });
    } catch { /* 个别文件仍被占用：放弃清理，不影响测试结论 */ }
  }

  console.log('\n结果：通过 ' + pass + '，失败 ' + fail);
  if (failures.length) console.log('失败项：\n  - ' + failures.join('\n  - '));
  return fail ? 1 : 0;
}

main().then((code) => process.exit(code));
