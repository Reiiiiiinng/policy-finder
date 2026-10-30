/*
 * 本轮正式项目浏览器回归：Edge + CDP，操作真实 index/discover/policy/
 * verify-list/plan/services/records 页面，并保存 375/768 视口截图。
 *
 * 运行前提：python backend/server.py 已在 127.0.0.1:8000 启动。
 * 运行：node .tools/ui-repair-e2e.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const BASE = 'http://127.0.0.1:8000';
const ROOT = path.dirname(__dirname);
const SHOTS = path.join(ROOT, '.ui-shots', 'ui-repair-20261030');
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
      const text = typeof event.data === 'string'
        ? event.data
        : Buffer.from(event.data).toString('utf8');
      const msg = JSON.parse(text);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const task = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) task.reject(new Error(msg.error.message));
      else task.resolve(msg.result);
    };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
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
    await sleep(180);
    await this.waitFor("document.readyState === 'complete'");
    await sleep(120);
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

  async screenshot(name) {
    await this.eval('scrollTo(0, 0)');
    await sleep(120);
    const shot = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const file = path.join(SHOTS, name);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return file;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function openTab(port, page) {
  const target = encodeURIComponent(BASE + '/' + page);
  const result = await request('PUT', `http://127.0.0.1:${port}/json/new?${target}`);
  if (result.status !== 200 || !result.body?.webSocketDebuggerUrl) {
    throw new Error('无法创建浏览器标签页');
  }
  return result.body.webSocketDebuggerUrl;
}

async function waitForEndpoint(url, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const out = await request('GET', url, 1000);
      if (out.status === 200) return;
    } catch (e) { /* retry */ }
    await sleep(200);
  }
  throw new Error('浏览器调试端口未就绪');
}

function cleanupTempDir(dir) {
  const resolved = path.resolve(dir);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('pf-ui-repair-')) {
    throw new Error('拒绝清理非测试临时目录: ' + resolved);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

function stopBrowser(browser) {
  if (browser && browser.pid) {
    spawnSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

async function main() {
  const health = await request('GET', BASE + '/api/health').catch(() => null);
  if (!health || health.status !== 200 || !health.body?.ok) {
    throw new Error('后端未启动或不可用，请先运行 python backend/server.py');
  }

  const edge = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!edge) throw new Error('未找到 Edge/Chrome，无法运行正式浏览器回归');

  fs.mkdirSync(SHOTS, { recursive: true });
  const port = 9900 + Math.floor(Math.random() * 80);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ui-repair-'));
  const browser = spawn(edge, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + tempDir,
    'about:blank',
  ], { stdio: 'ignore' });

  let page = null;
  const screenshots = [];
  try {
    await waitForEndpoint(`http://127.0.0.1:${port}/json/version`);
    page = new CdpPage(await openTab(port, 'index.html'));
    await page.open();
    await page.nav('index.html');

    const policyRows = await page.eval(`(async () => {
      const brief = await (await fetch('${BASE}/api/policies')).json();
      return (brief.policies || []).map((p) => ({
        id: p.policy_id,
        name: p.policy_name,
        department: p.department || '',
      }));
    })()`);
    check('读取到正式政策库', Array.isArray(policyRows) && policyRows.length >= 2,
      'count=' + policyRows.length);

    await page.nav('index.html');
    await page.eval(`sessionStorage.clear();sessionStorage.setItem('policy_finder_session',JSON.stringify({
      operator:'女儿',beneficiary:'父亲',confirmed:true,text:'',profile:{},
      selfText:'',selfProfile:{}
    }))`);
    await page.send('Page.reload');
    await page.waitFor("!!document.querySelector('.tabbar')");

    await page.eval("document.querySelector('.tab-item[data-tab=\"mine\"]').click()");
    await page.waitFor("location.pathname.endsWith('/services.html')");
    const myState = await page.eval(`(() => ({
      path: location.pathname,
      active: document.querySelector('.tab-item[data-tab="mine"]').classList.contains('is-active'),
      legacyOverlay: !!document.getElementById('mineOverlay'),
      entries: ['entList','entPlan','entRecords'].map((id) => document.getElementById(id)?.textContent.trim() || '')
    }))()`);
    check('首页底部「我的」进入独立新版服务页',
      myState.path.endsWith('/services.html') && myState.active
      && !myState.legacyOverlay && myState.entries.every(Boolean), JSON.stringify(myState));

    await page.nav('index.html');
    await page.eval("document.querySelector('.tab-item[data-tab=\"mine\"]').click()");
    await page.waitFor("location.pathname.endsWith('/services.html')");
    await page.eval("document.getElementById('entList').click()");
    await page.waitFor("location.pathname.endsWith('/verify-list.html')");
    check('我的服务 → 待核实清单', true);
    await page.eval("document.querySelector('.back-link').click()");
    await page.waitFor("location.pathname.endsWith('/services.html')");
    await page.eval("document.getElementById('entPlan').click()");
    await page.waitFor("location.pathname.endsWith('/plan.html')");
    check('我的服务 → 少跑腿计划', true);
    await page.eval("document.querySelector('.back-link').click()");
    await page.waitFor("location.pathname.endsWith('/services.html')");
    await page.eval("document.getElementById('entRecords').click()");
    await page.waitFor("location.pathname.endsWith('/records.html')");
    check('我的服务 → 核实记录', true);

    await page.nav('index.html');
    await page.eval("document.querySelector('.tab-item[data-tab=\"discover\"]').click()");
    await page.waitFor("location.pathname.endsWith('/discover.html')");
    check('首页下方「发现」按业务上下文进入家庭发现页', true);

    const text = '我父亲72岁，一个人在广州生活，最近行动不方便。';
    await page.eval(`document.getElementById('situation').value=${JSON.stringify(text)};document.getElementById('discoverBtn').click()`);
    await page.waitFor("document.querySelectorAll('.result-card').length > 0", 15000);
    const resultIds = await page.eval(`[...document.querySelectorAll('.result-card')].map((c) => c.dataset.id)`);
    check('真实输入后生成可操作政策结果', resultIds.length > 0, JSON.stringify(resultIds.slice(0, 4)));

    await page.eval('window.__pfNavMarker = String(Date.now())');
    const marker = await page.eval('window.__pfNavMarker');
    await page.eval("document.querySelector('.tab-item[data-tab=\"discover\"]').click()");
    await sleep(500);
    const activeTap = await page.eval(`({
      marker: window.__pfNavMarker,
      path: location.pathname,
      active: document.querySelector('.tab-item[data-tab="discover"]').classList.contains('is-active')
    })`);
    check('重复点击当前「发现」不触发整页重载',
      activeTap.marker === marker && activeTap.path.endsWith('/discover.html') && activeTap.active,
      JSON.stringify(activeTap));

    const firstId = resultIds[0];
    await page.eval(`(() => {
      const card=document.querySelector('.result-card[data-id=${JSON.stringify(firstId)}]');
      card.scrollIntoView({block:'center'});
      window.__beforeDetailY=scrollY;
    })()`);
    const beforeDetailY = await page.eval('window.__beforeDetailY');
    await page.eval(`document.querySelector('.result-card[data-id=${JSON.stringify(firstId)}] [data-lead-detail]').click()`);
    await page.waitFor("location.pathname.endsWith('/policy.html')");
    await page.waitFor("!!document.querySelector('.fs-opt[data-fs=\"verify\"]')");
    check('发现结果卡进入正式政策详情', true);

    await page.eval("document.querySelector('.fs-opt[data-fs=\"verify\"]').click()");
    await page.waitFor(`sessionStorage.getItem('pf_fs_${firstId}') === 'verify'`);
    check('详情点击「打算去核实」写入待核实清单', true);
    await page.eval("document.querySelector('.fs-listlink').click()");
    await page.waitFor("location.pathname.endsWith('/verify-list.html')");
    await page.waitFor("document.querySelectorAll('#vlCards article').length === 1");
    const firstList = await page.eval(`(() => ({
      count: document.querySelectorAll('#vlCards article').length,
      planVisible: !document.getElementById('vlPlanCta').hidden,
      planText: document.getElementById('vlPlanBtn').textContent
    }))()`);
    check('待核实清单展示已选政策与计划入口',
      firstList.count === 1 && firstList.planVisible && /少跑腿计划/.test(firstList.planText),
      JSON.stringify(firstList));

    await page.nav('discover.html');
    await page.waitFor("document.querySelectorAll('.result-card').length > 0", 15000);
    const secondId = await page.eval(`(() => {
      const ids=[...document.querySelectorAll('.result-card')].map((c)=>c.dataset.id);
      return ids.find((id) => id !== ${JSON.stringify(firstId)}) || '';
    })()`);
    if (secondId) {
      await page.eval(`(() => {
        const card=document.querySelector('.result-card[data-id=${JSON.stringify(secondId)}]');
        if (!card) throw new Error('second result card missing');
        (card.querySelector('[data-lead-detail]') || card).click();
      })()`);
      await page.waitFor("location.pathname.endsWith('/policy.html')");
      await page.waitFor("!!document.querySelector('.fs-opt[data-fs=\"verify\"]')");
      await page.eval("document.querySelector('.fs-opt[data-fs=\"verify\"]').click()");
      await page.waitFor(`sessionStorage.getItem('pf_fs_${secondId}') === 'verify'`);
    }
    check('可连续选择多项政策', !!secondId);

    await page.nav('verify-list.html');
    await page.waitFor("document.querySelectorAll('#vlCards article').length >= 2");
    await page.setViewport(375, 812);
    const multiList = await page.eval(`(() => {
      const a=document.getElementById('vlPlanCta').getBoundingClientRect();
      const cards=[...document.querySelectorAll('#vlCards article')];
      return {
        count:cards.length,
        planVisible:!document.getElementById('vlPlanCta').hidden,
        beforeCards:a.top < cards[0].getBoundingClientRect().top,
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
      };
    })()`);
    check('多项清单在政策卡前显示清晰计划入口',
      multiList.count >= 2 && multiList.planVisible && multiList.beforeCards && multiList.overflow <= 1,
      JSON.stringify(multiList));
    screenshots.push(await page.screenshot('01-verify-list-plan-entry-375.png'));

    await page.eval("document.getElementById('vlPlanBtn').click()");
    await page.waitFor("location.pathname.endsWith('/plan.html')");
    await page.waitFor("document.querySelectorAll('#plList article').length >= 2");
    const planOrder = await page.eval(`(() => {
      const y=(id)=>document.getElementById(id).getBoundingClientRect().top+scrollY;
      return {
        count:document.querySelectorAll('#plList article').length,
        empty:!document.getElementById('plEmpty').hidden,
        listBeforeQuestions:y('plList') < y('plOnline'),
        questionsBeforePrep:y('plOnline') < y('plPrepHead'),
        noTel:/tel:/.test(document.body.innerHTML),
        selectedNames:[...document.querySelectorAll('#plList article')].map((c)=>c.textContent.slice(0,20)),
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
      };
    })()`);
    check('计划页先列已选政策，再显示核实问题与出发前准备',
      planOrder.count >= 2 && !planOrder.empty && planOrder.listBeforeQuestions
      && planOrder.questionsBeforePrep && planOrder.overflow <= 1, JSON.stringify(planOrder));
    check('计划页不虚构电话联系方式', !planOrder.noTel);
    screenshots.push(await page.screenshot('02-plan-multi-375.png'));
    const planBackTarget = await page.eval("document.querySelector('.back-link').getAttribute('href')");
    check('从清单进入计划后返回目标为清单', planBackTarget === 'verify-list.html', planBackTarget);
    await page.eval("document.querySelector('.back-link').click()");
    await page.waitFor("location.pathname.endsWith('/verify-list.html')");
    await page.waitFor("document.querySelectorAll('#vlCards article').length >= 2");
    check('从计划返回清单后多项政策状态仍保留', true);

    await page.nav('index.html');
    await page.waitFor("!document.getElementById('homeContinue').hidden");
    const homeContinue = await page.eval(`(() => ({
      count:document.getElementById('hcCount').textContent,
      list:document.getElementById('hcList').textContent,
      plan:document.getElementById('hcPlan').textContent,
      primary:document.getElementById('tileMatch').classList.contains('is-primary')
    }))()`);
    check('首页只按本机真实清单显示继续入口',
      /[2-9]|10/.test(homeContinue.count) && homeContinue.primary, JSON.stringify(homeContinue));
    screenshots.push(await page.screenshot('03-home-continue-375.png'));

    await page.nav('discover.html');
    await page.waitFor("document.querySelectorAll('.result-card').length > 0", 15000);
    const beforeReturn = await page.eval(`(() => {
      const c=document.querySelector('.result-card');
      c.scrollIntoView({block:'center'});
      return {y:scrollY,text:document.getElementById('situation').value};
    })()`);
    await page.eval("document.querySelector('.result-card [data-lead-detail]').click()");
    await page.waitFor("location.pathname.endsWith('/policy.html')");
    await page.waitFor("!!document.querySelector('.back-link')");
    await page.eval("document.querySelector('.back-link').click()");
    await page.waitFor("location.pathname.endsWith('/discover.html')");
    await page.waitFor("document.querySelectorAll('.result-card').length > 0", 15000);
    await sleep(1800);
    const afterReturn = await page.eval(`({y:scrollY,text:document.getElementById('situation').value})`);
    check('从详情返回发现后保留输入与结果状态',
      afterReturn.text === beforeReturn.text && Math.abs(afterReturn.y - beforeReturn.y) < 160,
      JSON.stringify({ before: beforeReturn, after: afterReturn }));
    screenshots.push(await page.screenshot('04-discover-return-375.png'));

    await page.eval(`(() => {
      for (let i=sessionStorage.length-1;i>=0;i--) {
        const k=sessionStorage.key(i);
        if (k && k.indexOf('pf_fs_')===0) sessionStorage.removeItem(k);
      }
      sessionStorage.removeItem('pf_prep_v1');
    })()`);
    await page.nav('verify-list.html');
    await page.waitFor("!!document.querySelector('#vlCards .vf-empty')");
    const emptyList = await page.eval(`({
      ctaHidden:document.getElementById('vlPlanCta').hidden,
      emptyText:document.querySelector('#vlCards .vf-empty').textContent
    })`);
    check('空清单不显示计划入口并引导发现',
      emptyList.ctaHidden && /去发现权益/.test(emptyList.emptyText), JSON.stringify(emptyList));
    await page.eval("document.querySelector('#vlCards [data-act=\"discover\"]').click()");
    await page.waitFor("location.pathname.endsWith('/discover.html')");
    check('空清单发现按钮有效', true);

    await page.nav('plan.html');
    await page.waitFor("!document.getElementById('plEmpty').hidden");
    const emptyPlan = await page.eval(`({
      contentHidden:document.getElementById('plContent').hidden,
      hasList:!!document.querySelector('[data-act="goList"]'),
      hasDiscover:!!document.querySelector('[data-act="discover"]')
    })`);
    check('空计划隐藏误导性进度并提供两个有效入口',
      emptyPlan.contentHidden && emptyPlan.hasList && emptyPlan.hasDiscover, JSON.stringify(emptyPlan));
    await page.eval("document.querySelector('#plEmpty [data-act=\"goList\"]').click()");
    await page.waitFor("location.pathname.endsWith('/verify-list.html')");
    check('空计划「去待核实清单」按钮已修复', true);

    await page.nav('services.html');
    await page.setViewport(375, 812);
    const servicesLayout = await page.eval(`({
      active:document.querySelector('.tab-item[data-tab="mine"]').classList.contains('is-active'),
      entries:document.querySelectorAll('.vf-entry').length,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    })`);
    check('我的服务页入口和选中态正确',
      servicesLayout.active && servicesLayout.entries === 4 && servicesLayout.overflow <= 1,
      JSON.stringify(servicesLayout));
    screenshots.push(await page.screenshot('05-services-375.png'));

    await page.nav('index.html');
    await page.setViewport(768, 1024);
    await page.waitFor("!!document.querySelector('.tabbar')");
    await sleep(200);
    const wide = await page.eval(`({
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      tabWidth:Math.round(document.querySelector('.tabbar').getBoundingClientRect().width),
      active:document.querySelector('.tab-item[data-tab="home"]').classList.contains('is-active')
    })`);
    check('768px 宽视口无横向溢出且底部导航正常', wide.overflow <= 1 && wide.active, JSON.stringify(wide));
    screenshots.push(await page.screenshot('06-home-768.png'));

    console.log('\n截图：');
    screenshots.forEach((file) => console.log('  ' + file));
  } finally {
    if (page) page.close();
    stopBrowser(browser);
    await sleep(900);
    try {
      cleanupTempDir(tempDir);
      console.log('临时浏览器 profile 已清理');
    } catch (e) {
      console.log('清理警告：' + tempDir + ' -> ' + e.message);
    }
  }

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error.message);
  process.exit(1);
});
