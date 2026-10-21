/*
 * 生活事件连续点击竞态回归（无截图、无项目临时文件）。
 *
 * 运行前提：本地服务已启动（http://127.0.0.1:8000）。
 *   node .tools/scene-race-test.js
 *
 * 覆盖家庭/本人两种模式：
 *   - 50 / 150 / 300ms 连续添加两个事件
 *   - 连续添加两个后立即取消其中一个
 *   - 请求乱序返回
 *   - 最新请求失败
 *   - A4 单次点击定位
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BASE = 'http://127.0.0.1:8000';
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(method, url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null });
        } catch (e) {
          reject(new Error('JSON 响应解析失败: ' + body.slice(0, 200)));
        }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('请求超时: ' + url)));
    req.on('error', reject);
    req.end();
  });
}

function sameSet(a, b) {
  const x = Array.from(new Set(a || [])).sort();
  const y = Array.from(new Set(b || [])).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function assertScenes(name, state, expected) {
  const dom = state.aria || [];
  const stored = state.stored || [];
  check(name + '：DOM 场景集合正确', sameSet(dom, expected), JSON.stringify(state));
  check(name + '：存储场景集合正确', sameSet(stored, expected), JSON.stringify(state));
}

class CdpPage {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.pending = new Map();
    this.seq = 0;
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'));
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const task = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) task.reject(new Error(msg.error.message));
      else task.resolve(msg.result);
    };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 375,
      screenHeight: 812,
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error('CDP 超时: ' + method));
      }, 20000);
    });
  }

  async eval(expression) {
    const out = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (out.exceptionDetails) {
      throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    }
    return out.result ? out.result.value : undefined;
  }

  async waitFor(expression, timeout = 20000) {
    const deadline = Date.now() + timeout;
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        if (await this.eval(expression)) return true;
      } catch (e) {
        lastError = e.message;
      }
      await sleep(100);
    }
    throw new Error('等待条件超时: ' + expression + (lastError ? ' (' + lastError + ')' : ''));
  }

  async nav(page) {
    await this.send('Page.navigate', { url: BASE + '/' + page });
    await sleep(250);
    await this.waitFor("document.readyState === 'complete'");
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function openTab(port, page) {
  const target = encodeURIComponent(BASE + '/' + page);
  const result = await request('PUT', `http://127.0.0.1:${port}/json/new?${target}`);
  if (result.status !== 200 || !result.body || !result.body.webSocketDebuggerUrl) {
    throw new Error('无法创建浏览器标签页');
  }
  return result.body.webSocketDebuggerUrl;
}

async function waitForEndpoint(url, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const out = await request('GET', url, 1000);
      if (out.status === 200) return out;
    } catch (e) { /* retry */ }
    await sleep(200);
  }
  throw new Error('浏览器调试端口未就绪');
}

function cleanupTempDir(dir) {
  const resolved = path.resolve(dir);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  const leaf = path.basename(resolved);
  if (!resolved.startsWith(tempRoot) || !leaf.startsWith('pf-scene-race-')) {
    throw new Error('拒绝清理非测试临时目录: ' + resolved);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function textFor(mode) {
  return mode === 'self'
    ? '我今年68岁，有高血压，最近记性变差，住在广州越秀区。'
    : '我父亲72岁，一个人在广州生活，最近行动不方便。';
}

async function resetPage(page, mode) {
  const file = mode === 'self' ? 'self.html' : 'discover.html';
  await page.nav(file);
  await page.eval('sessionStorage.clear()');
  await page.nav(file);
  await page.eval(`(() => {
    const input = document.getElementById('situation');
    input.value = ${JSON.stringify(textFor(mode))};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('discoverBtn').click();
  })()`);
  await page.waitFor(
    "document.querySelectorAll('.result-card').length > 0 && !document.getElementById('pfRefreshBar')",
    25000,
  );
}

async function sceneState(page, mode) {
  return page.eval(`(() => {
    const profile = store.read();
    const p = ${mode === 'self' ? 'profile.selfProfile' : 'profile.profile'} || {};
    return {
      aria: [...document.querySelectorAll('.scene-chip[aria-pressed="true"]')]
        .map((el) => el.dataset.scene),
      dataset: [...document.querySelectorAll('.scene-chip[data-on="1"]')]
        .map((el) => el.dataset.scene),
      stored: p.scenes || [],
      refresh: !!document.getElementById('pfRefreshBar'),
      cards: document.querySelectorAll('.result-card').length,
    };
  })()`);
}

async function selectableNames(page, count) {
  return page.eval(`(() => [...document.querySelectorAll('.scene-chip[data-on="0"]')]
    .filter((el) => el.getBoundingClientRect().height > 0)
    .slice(0, ${count})
    .map((el) => el.dataset.scene))()`);
}

async function addTwoWithDelay(page, mode, delay) {
  await resetPage(page, mode);
  const before = await sceneState(page, mode);
  const targets = await selectableNames(page, 2);
  if (targets.length !== 2) throw new Error(mode + ' 可选场景不足两个');
  await page.eval(`(() => {
    const original = API.match;
    API.match = async function (payload) {
      const result = await original.call(API, payload);
      await new Promise((resolve) => setTimeout(resolve, 900));
      return result;
    };
    window.__restoreSceneTimingMatcher = () => { API.match = original; };
    const names = ${JSON.stringify(targets)};
    const first = [...document.querySelectorAll('.scene-chip')]
      .find((el) => el.dataset.scene === names[0]);
    first.click();
    setTimeout(() => {
      const second = [...document.querySelectorAll('.scene-chip[data-on="0"]')]
        .find((el) => el.dataset.scene === names[1]);
      if (second) second.click();
    }, ${delay});
  })()`);
  await sleep(Math.max(1700, delay + 1300));
  const after = await sceneState(page, mode);
  const expected = before.stored.concat(targets);
  assertScenes(`${mode} ${delay}ms 连续添加`, after, expected);
  check(`${mode} ${delay}ms 后界面已稳定`, !after.refresh && after.cards > 0, JSON.stringify(after));
  await page.eval('window.__restoreSceneTimingMatcher()');
}

async function addThenCancel(page, mode) {
  await resetPage(page, mode);
  const before = await sceneState(page, mode);
  const targets = await selectableNames(page, 2);
  if (targets.length !== 2) throw new Error(mode + ' 可选场景不足两个');
  await page.eval(`(() => {
    const original = API.match;
    API.match = async function (payload) {
      const result = await original.call(API, payload);
      await new Promise((resolve) => setTimeout(resolve, 900));
      return result;
    };
    window.__restoreSceneCancelMatcher = () => { API.match = original; };
    const names = ${JSON.stringify(targets)};
    const find = (name) => [...document.querySelectorAll('.scene-chip')]
      .find((el) => el.dataset.scene === name);
    find(names[0]).click();
    setTimeout(() => {
      const second = [...document.querySelectorAll('.scene-chip[data-on="0"]')]
        .find((el) => el.dataset.scene === names[1]);
      if (second) second.click();
    }, 100);
    setTimeout(() => {
      const first = find(names[0]);
      if (first) first.click();
    }, 220);
  })()`);
  await sleep(1800);
  const after = await sceneState(page, mode);
  assertScenes(`${mode} 连续添加后取消`, after, before.stored.concat(targets[1]));
  await page.eval('window.__restoreSceneCancelMatcher()');
}

async function outOfOrder(page, mode) {
  await resetPage(page, mode);
  const before = await sceneState(page, mode);
  const targets = await selectableNames(page, 2);
  await page.eval(`(() => {
    const original = API.match;
    let call = 0;
    API.match = async function (payload) {
      const index = ++call;
      const result = await original.call(API, payload);
      await new Promise((resolve) => setTimeout(resolve, index === 1 ? 850 : 80));
      return result;
    };
    window.__restoreSceneRaceMatcher = () => { API.match = original; };
    const names = ${JSON.stringify(targets)};
    [...document.querySelectorAll('.scene-chip')]
      .find((el) => el.dataset.scene === names[0]).click();
    setTimeout(() => {
      const second = [...document.querySelectorAll('.scene-chip[data-on="0"]')]
        .find((el) => el.dataset.scene === names[1]);
      if (second) second.click();
    }, 120);
  })()`);
  await sleep(1400);
  const after = await sceneState(page, mode);
  assertScenes(`${mode} 请求乱序`, after, before.stored.concat(targets));
  await page.eval('window.__restoreSceneRaceMatcher()');
}

async function latestRequestFailure(page, mode) {
  await resetPage(page, mode);
  const before = await sceneState(page, mode);
  const targets = await selectableNames(page, 2);
  await page.eval(`(() => {
    const original = API.match;
    let call = 0;
    API.match = async function (payload) {
      const index = ++call;
      if (index === 1) {
        const result = await original.call(API, payload);
        await new Promise((resolve) => setTimeout(resolve, 900));
        return result;
      }
      throw new Error('injected latest request failure');
    };
    window.__restoreSceneFailureMatcher = () => {
      API.match = original;
    };
    const names = ${JSON.stringify(targets)};
    [...document.querySelectorAll('.scene-chip')]
      .find((el) => el.dataset.scene === names[0]).click();
    setTimeout(() => {
      const second = [...document.querySelectorAll('.scene-chip[data-on="0"]')]
        .find((el) => el.dataset.scene === names[1]);
      if (second) second.click();
    }, 120);
  })()`);
  await sleep(250);
  const during = await sceneState(page, mode);
  await sleep(1200);
  const after = await sceneState(page, mode);
  const toast = await page.eval("document.getElementById('pfToast')?.textContent || ''");
  assertScenes(`${mode} 最新请求失败`, after, before.stored.concat(targets));
  check(`${mode} 最新请求失败期间状态保持`,
    sameSet(during.stored, before.stored.concat(targets)), JSON.stringify(during));
  check(`${mode} 最新请求失败有可见提示`, /失败/.test(toast), toast);
  await page.eval('window.__restoreSceneFailureMatcher()');
}

async function a4SingleClick(page, mode) {
  await resetPage(page, mode);
  const before = await page.eval(`(() => {
    const chip = [...document.querySelectorAll('.scene-chip[data-on="0"]')]
      .find((el) => el.getBoundingClientRect().height > 0);
    chip.scrollIntoView({ block: 'center' });
    scrollTo(0, scrollY + chip.getBoundingClientRect().top - 300);
    return { scene: chip.dataset.scene, top: chip.getBoundingClientRect().top };
  })()`);
  await page.eval(`(() => {
    const chip = [...document.querySelectorAll('.scene-chip')]
      .find((el) => el.dataset.scene === ${JSON.stringify(before.scene)});
    chip.click();
  })()`);
  await page.waitFor(`(() => {
    const chip = [...document.querySelectorAll('.scene-chip')]
      .find((el) => el.dataset.scene === ${JSON.stringify(before.scene)});
    return chip && chip.dataset.on === '1'
      && !document.getElementById('pfRefreshBar')
      && document.getElementById('resultArea').style.minHeight === '';
  })()`, 25000);
  await sleep(300);
  let previousTop = null;
  let stable = 0;
  for (let i = 0; i < 30; i++) {
    const currentTop = await page.eval(`(() => [...document.querySelectorAll('.scene-chip')]
      .find((el) => el.dataset.scene === ${JSON.stringify(before.scene)})
      .getBoundingClientRect().top)()`);
    if (currentTop === previousTop) stable++;
    else stable = 0;
    previousTop = currentTop;
    if (stable >= 4) break;
    await sleep(100);
  }
  const top = await page.eval(`(() => [...document.querySelectorAll('.scene-chip')]
    .find((el) => el.dataset.scene === ${JSON.stringify(before.scene)})
    .getBoundingClientRect().top)()`);
  check(`${mode} A4 单次定位`, Math.abs(top - before.top) < 2,
    `before=${before.top} after=${top}`);
}

async function main() {
  const health = await request('GET', BASE + '/api/health').catch(() => null);
  if (!health || health.status !== 200 || !health.body?.ok) {
    console.error('后端未启动或不可用。请先运行 python backend/server.py');
    process.exit(1);
  }

  const edge = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!edge) {
    console.error('未找到 Edge/Chrome，无法运行浏览器回归。');
    process.exit(1);
  }

  const port = 9400 + Math.floor(Math.random() * 400);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-scene-race-'));
  const browser = spawn(edge, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + tempDir,
    'about:blank',
  ], { stdio: 'ignore' });

  let page = null;
  try {
    await waitForEndpoint(`http://127.0.0.1:${port}/json/version`);
    page = new CdpPage(await openTab(port, 'discover.html'));
    await page.open();

    for (const mode of ['family', 'self']) {
      for (const delay of [50, 150, 300]) {
        await addTwoWithDelay(page, mode, delay);
      }
      await addThenCancel(page, mode);
      await outOfOrder(page, mode);
      await latestRequestFailure(page, mode);
      await a4SingleClick(page, mode);
    }
  } finally {
    if (page) page.close();
    browser.kill();
    await sleep(300);
    cleanupTempDir(tempDir);
  }

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error('测试执行异常:', error && error.stack ? error.stack : error);
  process.exit(2);
});
