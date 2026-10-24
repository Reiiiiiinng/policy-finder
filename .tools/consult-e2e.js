/*
 * P4 正式咨询页浏览器回归（无截图、无项目临时文件）。
 *
 * 运行前提：本地服务已启动（http://127.0.0.1:8000）。
 *   node .tools/consult-e2e.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

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
    pass += 1;
    console.log('  ok   ' + name);
  } else {
    fail += 1;
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
    await this.send('Network.enable');
    await this.setViewport(375, 812);
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

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
      screenWidth: width,
      screenHeight: height,
    });
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
  if (!resolved.startsWith(tempRoot) || !leaf.startsWith('pf-consult-e2e-')) {
    throw new Error('拒绝清理非测试临时目录: ' + resolved);
  }
  fs.rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
}

function stopBrowserProcesses(browser, tempDir) {
  if (process.platform !== 'win32') {
    browser.kill();
    return;
  }
  const leaf = path.basename(tempDir);
  if (!/^pf-consult-e2e-[\w-]+$/.test(leaf)) {
    throw new Error('拒绝按非测试 profile 名称清理浏览器进程');
  }
  const ps = [
    "$needle='" + leaf + "'",
    "$procs=Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like \"*$needle*\" }",
    "foreach($p in @($procs)){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join(';');
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
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

  const port = 9800 + Math.floor(Math.random() * 100);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-consult-e2e-'));
  const browser = spawn(edge, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
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
    page = new CdpPage(await openTab(port, 'index.html'));
    await page.open();

    await page.nav('index.html');
    await page.eval("document.querySelector('.tab-item[data-tab=\"consult\"]').click()");
    await page.waitFor("location.pathname.endsWith('/consult.html')");
    await page.waitFor("document.querySelectorAll('.consult-policy').length > 0");

    check('首页咨询入口进入正式页面', await page.eval("location.pathname.endsWith('/consult.html')"));
    const navState = await page.eval(`(() => ({
      count: document.querySelectorAll('.tabbar .tab-item').length,
      active: document.querySelector('.tab-item[data-tab="consult"]').classList.contains('is-active'),
      current: document.querySelector('.tab-item[data-tab="consult"]').getAttribute('aria-current'),
      disabled: document.querySelector('.tab-item[data-tab="consult"]').getAttribute('aria-disabled'),
    }))()`);
    check('咨询页底部导航四项存在',
      navState.count === 4, JSON.stringify(navState));
    check('咨询导航为当前项且未禁用',
      navState.active && navState.current === 'page' && !navState.disabled, JSON.stringify(navState));

    const apiData = await page.eval(`(async () => {
      const brief = await (await fetch('/api/policies')).json();
      const details = await Promise.all((brief.policies || []).map(async (p) => {
        const r = await fetch('/api/policy/' + encodeURIComponent(p.policy_id));
        return r.json();
      }));
      return {
        total: details.length,
        departments: [...new Set(details.map((p) => p.source.department))].length,
        policies: details.map((p) => ({
          id: p.policy_id,
          name: p.policy_name,
          department: p.source.department,
          url: p.source.official_url,
          status: p.verification.status,
        })),
      };
    })()`);
    const domData = await page.eval(`(() => ({
      policies: [...document.querySelectorAll('.consult-policy')].map((li) => ({
        id: li.dataset.policyId,
        name: li.querySelector('.consult-policy-name').textContent,
        badge: li.querySelector('.badge').textContent,
        status: li.dataset.sourceStatus,
        href: li.querySelector('.consult-official-link')?.href || '',
        target: li.querySelector('.consult-official-link')?.target || '',
        rel: li.querySelector('.consult-official-link')?.rel || '',
      })),
      departments: document.querySelectorAll('.consult-dept').length,
      summary: document.querySelector('.consult-summary')?.textContent || '',
    }))()`);

    check('真实接口政策全部渲染',
      domData.policies.length === apiData.total && apiData.total > 0,
      `dom=${domData.policies.length} api=${apiData.total}`);
    check('真实接口部门数一致',
      domData.departments === apiData.departments,
      `dom=${domData.departments} api=${apiData.departments}`);
    const expectedById = Object.fromEntries(apiData.policies.map((p) => [p.id, p]));
    const dataMismatch = domData.policies.filter((p) => {
      const expected = expectedById[p.id];
      return !expected || expected.name !== p.name || expected.url !== p.href;
    });
    check('政策名与官方链接逐项来自真实详情',
      dataMismatch.length === 0, JSON.stringify(dataMismatch));
    const statusMismatch = domData.policies.filter((p) => {
      const expected = expectedById[p.id];
      if (!expected) return true;
      if (expected.status === 'verified') return p.badge !== '来源已核验';
      if (expected.status === 'to_verify') return p.badge !== '国家依据已核验 · 本地待确认';
      return false;
    });
    check('三态核验状态未被夸大',
      statusMismatch.length === 0, JSON.stringify(statusMismatch));
    check('所有真实外链带安全属性',
      domData.policies.every((p) => p.target === '_blank'
        && /(^|\s)noopener(\s|$)/.test(p.rel) && /(^|\s)noreferrer(\s|$)/.test(p.rel)),
      JSON.stringify(domData.policies.map((p) => ({ id: p.id, target: p.target, rel: p.rel }))));

    await page.eval("document.querySelector('.tab-item[data-tab=\"mine\"]').click()");
    await page.waitFor("!!document.getElementById('mineOverlay')");
    check('咨询页可打开“我的”弹层',
      await page.eval("document.querySelector('#mineOverlay .mine-sheet').getAttribute('role') === 'dialog'"));
    await page.eval("document.querySelector('#mineOverlay .ms-close').click()");
    check('关闭“我的”后仍停留在咨询页',
      await page.eval("!document.getElementById('mineOverlay') && location.pathname.endsWith('/consult.html')"));

    await page.nav('consult.html');
    await page.waitFor("document.querySelectorAll('.consult-policy').length > 0");
    await page.setViewport(375, 812);
    await sleep(150);
    const layout375 = await page.eval(`(() => {
      scrollTo(0, document.documentElement.scrollHeight);
      const footer = document.querySelector('.footnote').getBoundingClientRect();
      const tab = document.querySelector('.tabbar').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        footerBottom: Math.round(footer.bottom),
        tabTop: Math.round(tab.top),
      };
    })()`);
    check('375px 无横向溢出', layout375.overflow <= 1, JSON.stringify(layout375));
    check('375px 底部导航不遮挡页脚',
      layout375.footerBottom <= layout375.tabTop + 1, JSON.stringify(layout375));

    await page.setViewport(768, 1024);
    await page.nav('consult.html');
    await page.waitFor("document.querySelectorAll('.consult-policy').length > 0");
    await sleep(150);
    const layout768 = await page.eval(`(() => {
      scrollTo(0, document.documentElement.scrollHeight);
      const footer = document.querySelector('.footnote').getBoundingClientRect();
      const tab = document.querySelector('.tabbar').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        footerBottom: Math.round(footer.bottom),
        tabTop: Math.round(tab.top),
      };
    })()`);
    check('768px 无横向溢出', layout768.overflow <= 1, JSON.stringify(layout768));
    check('768px 底部导航不遮挡页脚',
      layout768.footerBottom <= layout768.tabTop + 1, JSON.stringify(layout768));

    await page.setViewport(375, 812);
    await page.nav('consult.html');
    await page.eval("document.querySelector('.back-link').click()");
    await page.waitFor("location.pathname.endsWith('/index.html')");
    check('咨询页默认返回首页', true);

    await page.nav('consult.html?from=self.html');
    await page.eval("document.querySelector('.back-link').click()");
    await page.waitFor("location.pathname.endsWith('/self.html')");
    check('咨询页来源参数返回本人页', true);

    await page.send('Network.setBlockedURLs', { urls: ['*api/policies*'] });
    await page.nav('consult.html?blocked=1');
    await page.waitFor("!!document.querySelector('.consult-empty')");
    const blocked = await page.eval(`(() => ({
      text: document.querySelector('.consult-empty').textContent,
      policies: document.querySelectorAll('.consult-policy').length,
      links: document.querySelectorAll('.consult-official-link').length,
    }))()`);
    check('接口异常时明确降级且不展示伪数据',
      /暂时无法读取政策数据/.test(blocked.text) && blocked.policies === 0 && blocked.links === 0,
      JSON.stringify(blocked));

    await page.send('Network.setBlockedURLs', { urls: ['*api/policy/gz_elderly_001*'] });
    await page.nav('consult.html?partial=1');
    await page.waitFor("!!document.querySelector('.consult-failure')");
    const partial = await page.eval(`(() => ({
      text: document.querySelector('.consult-failure').textContent,
      policies: document.querySelectorAll('.consult-policy').length,
    }))()`);
    check('单项详情失败时保留其余真实数据并提示',
      /另有 1 项/.test(partial.text) && partial.policies === apiData.total - 1,
      JSON.stringify(partial));
    await page.send('Network.setBlockedURLs', { urls: [] });
  } finally {
    if (page) page.close();
    try {
      stopBrowserProcesses(browser, tempDir);
      await sleep(1200);
      cleanupTempDir(tempDir);
      console.log('临时 profile 已清理: ' + tempDir);
    } catch (e) {
      // 清理失败只作警告：不掩盖、不改写此前真实的测试通过与失败结果。
      // 测试本身通过则仍为通过；测试本身失败则仍报告失败。
      console.log('清理警告：临时 profile 未能清理（不影响上方测试结果）：'
        + tempDir + ' -> ' + (e && e.message ? e.message : e));
    }
  }

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error('测试执行异常:', error && error.stack ? error.stack : error);
  process.exit(2);
});
