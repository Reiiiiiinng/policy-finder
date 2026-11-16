import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const evidence = resolve('evidence');
const refinement = process.env.PF_SEARCH_UI_REFINEMENT === '1';
const run = refinement ? 'search-ui' : 'phase2a';
const seed = JSON.parse(readFileSync(join(evidence, run + '-browser.stdout.log'), 'utf8'));
assert.equal(seed.origin, 'http://127.0.0.1:8148');
assert.equal(seed.search_mode, 'mock');
assert.equal(resolve(seed.database), resolve('data/private-migration/v33-' + run + '-browser/acceptance.db'));
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(join(tmpdir(), 'policy-v33-edge-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-proxy-server',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
const report = {mode: 'CleverSee and DeepSeek mocked', checks: [], requests: [], exceptions: [], screenshots: []};
let socket;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const widths = [320, 375, 390, 1366];

async function until(read, label) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const value = await read();
    if (value) return value;
    await sleep(100);
  }
  throw Error('等待超时 ' + label);
}

function check(label, condition) {
  assert(condition, label);
  report.checks.push(label);
}

try {
  const api = async path => (await fetch(seed.origin + path)).json();
  const baseline = await api('/api/policies');
  const databaseHash = () => createHash('sha256').update(readFileSync(seed.database)).digest('hex');
  const before = databaseHash();
  check('目录共 16 条，广州 10、佛山 6', baseline.total === 16 &&
    baseline.policies.filter(p => p.region.includes('广州')).length === 10 &&
    baseline.policies.filter(p => p.region.includes('佛山')).length === 6);
  const debugPort = await until(() => {
    const file = join(profile, 'DevToolsActivePort');
    return existsSync(file) && Number(readFileSync(file, 'utf8').split('\n')[0]);
  }, 'Edge CDP');
  const debug = 'http://127.0.0.1:' + debugPort;
  report.browser = (await (await fetch(debug + '/json/version')).json()).Browser;
  const tabs = await (await fetch(debug + '/json/list')).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    socket.addEventListener('open', ok, {once: true});
    socket.addEventListener('error', fail, {once: true});
  });
  const pending = new Map();
  let next = 0;
  socket.addEventListener('message', ({data}) => {
    const {id, result, error, method, params} = JSON.parse(data);
    if (id) {
      const request = pending.get(id);
      pending.delete(id);
      if (error) request.fail(Error(error.message));
      else request.ok(result);
    }
    if (method === 'Runtime.exceptionThrown') report.exceptions.push(params.exceptionDetails.text);
    if (method === 'Network.requestWillBeSent' && params.request.url.startsWith(seed.origin + '/api/')) {
      report.requests.push({path: new URL(params.request.url).pathname, method: params.request.method});
    }
  });
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const id = ++next;
    pending.set(id, {ok, fail});
    socket.send(JSON.stringify({id, method, params}));
  });
  const js = async expression => {
    const response = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (response.exceptionDetails) throw Error(response.result.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const wait = expression => until(() => js(expression), expression);
  const element = selector => 'document.querySelector(' + JSON.stringify(selector) + ')';
  const found = selector => '!!' + element(selector);
  const contains = (selector, text) => element(selector) + '?.textContent.includes(' + JSON.stringify(text) + ')';
  const click = async (selector, scroll = true) => {
    const point = await js(`(() => {
      const node = ${element(selector)};
      if (${scroll}) node.scrollIntoView({block:'center',behavior:'instant'});
      const box = node.getBoundingClientRect();
      return {x:box.x+box.width/2,y:box.y+box.height/2};
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {type, ...point, button: 'left', clickCount: 1});
    }
  };
  const field = (selector, value, type = 'input') => js(`(() => {
    const node = ${element(selector)};
    node.value = ${JSON.stringify(value)};
    node.dispatchEvent(new Event(${JSON.stringify(type)}, {bubbles:true}));
  })()`);
  const key = async name => {
    const code = {ArrowRight: 39, Enter: 13, Tab: 9}[name];
    for (const type of ['keyDown', 'keyUp']) {
      const text = name === 'Enter' && type === 'keyDown' ? '\r' : undefined;
      await send('Input.dispatchKeyEvent', {type, key: name, code: name, windowsVirtualKeyCode: code, text});
    }
  };
  const navigate = path => send('Page.navigate', {url: new URL(path, seed.origin).href});
  const size = width => send('Emulation.setDeviceMetricsOverride', {
    width, height: width > 600 ? 900 : 844, deviceScaleFactor: 1, mobile: width < 600,
  });
  const screenshot = async name => {
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    const filename = run + '-' + name + '.png';
    writeFileSync(join(evidence, filename), Buffer.from(data, 'base64'));
    report.screenshots.push(filename);
  };
  const layout = async label => {
    for (const width of widths) {
      await size(width);
      await js('window.scrollTo(0,0)');
      await sleep(80);
      check(label + ' ' + width + 'px 无横向溢出，当前控件点击区至少 44px', await js(`innerWidth === ${width} &&
        document.documentElement.scrollWidth === document.documentElement.clientWidth &&
        [...document.querySelectorAll('[role=tab], form input, form button, .result a')]
          .filter(n => n.getClientRects().length).every(n => n.getBoundingClientRect().height >= 44)`));
      check(label + ' ' + width + 'px 导航定位正确且不遮挡最后操作', await js(`(() => {
        const nav = document.querySelector('.pf-global-nav');
        const link = [...document.querySelectorAll('#' + '${label}' + '-results a')].at(-1);
        const desktop = ${width} >= 768;
        if (desktop && Math.abs(nav.getBoundingClientRect().top) > 1 ||
            !desktop && Math.abs(nav.getBoundingClientRect().bottom - innerHeight) > 1) return false;
        window.scrollTo(0, document.documentElement.scrollHeight);
        const rect = link.getBoundingClientRect(), bar = nav.getBoundingClientRect();
        return rect.bottom <= innerHeight && (desktop ? rect.top >= bar.bottom : rect.bottom <= bar.top);
      })()`));
      await js('window.scrollTo(0,0)');
      await screenshot(label + '-' + width);
    }
  };
  const searchCount = () => report.requests.filter(r => r.path === '/api/search/web').length;
  const query = value => field('#web-query', value);
  const submit = () => click('#web-form button');
  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  await size(390);
  await navigate('/');
  await wait(found('a.home-policy-search'));
  await click('a.home-policy-search');
  await wait(contains('#local-status', '16 条'));
  check('首页进入查政策，默认本地且无联网请求', await js('!document.querySelector("#local").hidden') && searchCount() === 0);
  check('本地所有 16 条展示目录原数据与明确核验状态', await js(`(() => {
    const cards = [...document.querySelectorAll('#local-results article')];
    const policies = ${JSON.stringify(baseline.policies)};
    return cards.length === 16 && cards.every((card, i) => {
      const policy = policies[i];
      return card.querySelector('h2').textContent === policy.policy_name &&
        card.textContent.includes('来源已核验') === (policy.verification_status === 'verified') &&
        card.textContent.includes(policy.region) &&
        card.querySelector('.snippet')?.textContent === policy.description.trim() &&
        Boolean(card.querySelector('.snippet').compareDocumentPosition(card.querySelector('.badges')) &
          Node.DOCUMENT_POSITION_FOLLOWING);
    });
  })()`));
  check('两种模式均无快捷筛选与高级筛选', await js(`[...document.querySelectorAll('.search-shell button')]
    .map(button => button.textContent.trim()).every(label =>
      ['搜索','已收录政策','联网搜索','重试加载','重试搜索'].includes(label))`));
  check('16 条政策图标可按场景区分，SVG 已定义且未知类别回退到文件', await js(`(() => {
    const expected = {
      gz_elderly_001: 'assessment', gz_elderly_002: 'community', gz_elderly_003: 'meals',
      gz_elderly_004: 'home-visit', gz_elderly_005: 'bed', gz_elderly_006: 'access',
      gz_elderly_007: 'wellness', gz_elderly_008: 'cognition', gz_elderly_009: 'care-cover',
      gz_elderly_010: 'allowance', fs_med_001: 'medical', fs_med_002: 'family',
      fs_med_003: 'critical-cover', fs_med_004: 'outpatient', fs_med_005: 'relief', fs_med_006: 'supplement',
    };
    return [...document.querySelectorAll('#local-results article')].every(card => {
      const href = card.querySelector('.result-icon use').getAttribute('href');
      return href === '#icon-' + expected[card.id.slice(7)] && !!document.querySelector(href);
    }) && policyGlyph({category: '未知类别'}) === 'file';
  })()`));
  await layout('local');
  await size(320);
  check('320px 长标题、两行摘要及空摘要按内容排版', await js(`(() => {
    const real = catalogue.find(policy => policy.policy_id === 'fs_med_002');
    const long = localCard(real);
    const empty = localCard({...real, description: '   '});
    long.id = ''; empty.id = '';
    const list = document.querySelector('#local-results');
    list.append(long, empty);
    try {
      const title = long.querySelector('h2');
      const snippet = long.querySelector('.snippet');
      const link = long.querySelector('a');
      return title.offsetHeight > parseFloat(getComputedStyle(title).lineHeight) * 1.5 &&
        snippet.scrollHeight > snippet.clientHeight &&
        snippet.getBoundingClientRect().bottom < link.getBoundingClientRect().top &&
        !empty.querySelector('.snippet') && empty.getBoundingClientRect().height < long.getBoundingClientRect().height;
    } finally { long.remove(); empty.remove(); }
  })()`));
  await field('#local-query', '佛山');
  check('本地关键词匹配 6 条佛山政策', await js('document.querySelectorAll("#local-results article").length === 6'));
  if (refinement) await screenshot('local-foshan-320');
  await click('#local-results a');
  await wait('location.pathname === "/policy.html"');
  await wait(found('[data-back]'));
  check('本地详情保留查政策选中项', await js(found('.pf-global-nav [data-tab=search][aria-current]')));
  await js('history.back()');
  await wait(contains('#local-status', '6 条'));
  await js('history.forward()');
  await wait(found('[data-back]'));
  check('浏览器前进恢复政策详情', await js('location.pathname === "/policy.html"'));
  await click('[data-back]');
  await wait(contains('#local-status', '6 条'));
  check('原政策详情返回查政策并恢复关键词', await js('document.querySelector("#local-query").value === "佛山"'));
  await field('#local-query', '不存在的关键词');
  check('本地空结果有提示', await js(contains('#local-status', '未找到')));
  await js('document.querySelector("#local-tab").focus()');
  await key('ArrowRight');
  check('方向键切换联网标签，焦点保留且无联网请求', await js('document.activeElement.id === "web-tab" && document.activeElement.matches(":focus-visible")') && searchCount() === 0);
  check('未主动搜索时无结果卡片或结果总数', searchCount() === 0 &&
    await js('document.querySelector("#web-results-title").hidden && !document.querySelector("#web-results article")'));
  await screenshot('web-initial-320');
  const beforeSearch = searchCount();
  await js('document.querySelector("#web-query").focus()');
  await key('Tab');
  check('Tab 从联网输入框到搜索按钮', await js('document.activeElement.matches("#web-form button")') &&
    searchCount() === beforeSearch);
  await js('document.querySelector("#web-query").focus()');
  await key('Enter');
  await wait(contains('#web-status', '请输入'));
  check('空提交无联网请求', searchCount() === 0);
  await query('佛山市老年人助餐政策');
  check('输入无联网请求', searchCount() === 0);
  await js('document.querySelector("#web-query").focus()');
  await key('Enter');
  await wait(contains('#web-status', '正在搜索'));
  await js('document.querySelector("#web-form").requestSubmit()');
  await screenshot('loading-320');
  await wait(contains('#web-status', '模拟演示 · 共找到 5 条'));
  check('回车主动搜索一次，加载中重复提交被拦截', searchCount() === 1);
  check('五种来源和待核实可辨，缺失日期隐藏', await js(`(() => {
    const cards = [...document.querySelectorAll('#web-results article')];
    const labels = ['政府政策文件','政策解读','政府部门资讯','第三方资讯','来源待确认'];
    return cards.length === 5 && cards.every((card, i) => card.textContent.includes(labels[i]) &&
      card.textContent.includes('待核实') && !card.textContent.includes('网页发布'));
  })()`));
  check('政府站与第三方样式有别，摘要、实际关键词与数量可读', await js(`(() => {
    const official = document.querySelector('.web-result .badge.official');
    const media = document.querySelector('.web-result .badge.third-party');
    return official && media && getComputedStyle(official).backgroundColor !== getComputedStyle(media).backgroundColor &&
      document.querySelectorAll('.web-result .site-badge').length === 3 &&
      document.querySelector('#web-submitted-query').textContent.includes('佛山市老年人助餐政策') &&
      document.querySelector('#web-query').value === '佛山市老年人助餐政策' &&
      document.querySelector('#web-status strong').textContent === '5' &&
      document.querySelectorAll('.web-result .snippet').length === 5 &&
      !document.querySelector('.web-result time');
  })()`));
  const original = await js(`(() => {
    const link = document.querySelector('#web-results a');
    return {href: link.href, rel: link.rel, target: link.target};
  })()`);
  check('原文链接为 HTTPS，安全打开新标签页', original.href.startsWith('https://www.foshan.gov.cn/') &&
    original.rel === 'noopener noreferrer' && original.target === '_blank');
  await send('Network.setBlockedURLs', {urls: ['https://www.foshan.gov.cn/*']});
  await click('#web-results a');
  await until(async () => {
    const pages = await (await fetch(debug + '/json/list')).json();
    return pages.some(page => page.id !== tabs.find(tab => tab.type === 'page').id);
  }, '原文链接创建新标签页');
  check('点击原文创建新标签页', true);
  await layout('web');
  await size(320);
  await click('#local-tab');
  check('两个模式保留各自内容', await js('document.querySelector("#local-query").value === "不存在的关键词"'));
  await click('#web-tab');
  check('切回联网复用当前页面结果', searchCount() === 1 && await js(contains('#web-status', '5 条')));
  await query('模拟网络异常');
  await submit();
  await wait(contains('#web-status', '网络或代理'));
  await screenshot('error-320');
  await sleep(1050);
  check('网络错误不会自动重试', searchCount() === 2 && await js('!document.querySelector("#web-retry").hidden'));
  await click('#web-retry');
  await wait(contains('#web-status', '网络或代理'));
  check('显式重试只增加一次请求', searchCount() === 3);
  await sleep(1050);
  await query('空结果');
  await submit();
  await wait(contains('#web-status', '未找到相关结果'));
  await screenshot('empty-320');
  await sleep(1050);
  await query('注入');
  await submit();
  await wait(contains('#web-status', '1 条'));
  check('模拟 HTML 以文本呈现，脚本与不安全协议不进入 DOM', await js(`document.querySelector('#web-results h3').textContent.includes('<img') &&
    !window.injected && !document.querySelector('#web-results img, #web-results script, #web-results a[href^="javascript:"]')`));
  await send('Page.reload');
  await wait(contains('#local-status', '未找到'));
  check('刷新回到已收录且不重发联网搜索', searchCount() === 5 &&
    await js('document.querySelector("#local-tab").getAttribute("aria-selected") === "true"'));
  check('搜索路径不发 AI、跟进或计划请求，SQLite 与目录读回一致',
    report.requests.every(r => ['/api/policies', '/api/health', '/api/policy/' + baseline.policies.find(p => p.region.includes('佛山')).policy_id,
      '/api/followup/bootstrap'].includes(r.path) || r.method === 'GET' && !r.path.startsWith('/api/ai/') ||
      r.method === 'POST' && r.path === '/api/search/web') &&
    before === databaseHash() && JSON.stringify(await api('/api/policies')) === JSON.stringify(baseline));

  for (const [tab, path, marker] of [
    ['home','/index.html','a.home-policy-search'],
    ['search','/search.html','#local-form'],
    ['discover','/find.html','#startDiscovery'],
    ['consult','/consult.html','#consultDepts'],
    ['mine','/services.html','#mineMembers'],
  ]) {
    await click('.pf-global-nav [data-tab=' + tab + ']');
    await wait(found(marker));
    check('五栏真实目标及当前项：' + tab, await js(`location.pathname === '${path}' &&
      document.querySelectorAll('.pf-global-nav a').length === 5 &&
      document.querySelector('.pf-global-nav [aria-current]')?.dataset.tab === '${tab}'`));
  }
  await navigate('/discovery-c.html');
  await wait(found('.dc-search'));
  check('旧目录深链可打开并归查政策', await js(found('.pf-global-nav [data-tab=search][aria-current]')));
  await size(320);
  await navigate('/find.html?choose=1');
  await wait(contains('main', '验收甲'));
  check('AI 发现可读合成家庭成员', await js(contains('main', '验收乙')));
  await navigate('/services.html');
  await wait(found('#mineMembers[href]'));
  await click('#mineMembers');
  await wait(found('#fuAddMember'));
  const memberName = 'V3.3合成成员' + Date.now();
  await field('#fuAddMember [name=name]', memberName);
  await field('#fuAddMember [name=relation]', '父亲', 'change');
  await click('#fuAddMember button');
  await wait(contains('body', memberName));
  check('原家庭管理可添加并读回合成成员',
    (await api('/api/followup/members')).members.some(member => member.name === memberName));
  await navigate('/analysis.html?member=' + seed.member);
  await wait(found('#intake'));
  await field('[name=age]', '68');
  await field('[name=region]', '佛山市', 'change');
  await field('[name=description]', '合成案例：母亲68岁，住在佛山市，住院自费3万元，家庭经济困难，需要了解医疗救助。');
  await click('#intake button');
  await wait(found('#recommendations'));
  check('AI 推荐页保留 AI发现高亮', await js(found('.pf-global-nav [data-tab=discover][aria-current]')));
  const favorite = '[data-favorite="fs_med_002"]';
  await wait(found(favorite + ':not(:disabled)'));
  if (await js(element(favorite) + '.getAttribute("aria-pressed") !== "true"')) await click(favorite);
  await wait(found('#selected-next:not(:disabled)'));
  await click('[data-action=open-chat]');
  await wait(found('#conversation[open]'));
  await field('#chat textarea', '请问办理医疗救助前需要核对哪些条件？');
  await click('#chat button');
  await wait('document.querySelector("#chat-log article")?.textContent.length > 500');
  await click('.chat-answer-full summary');
  await wait(found('.chat-answer-full[open]'));
  const nextVisible = `(() => {
    const button = document.querySelector('#selected-next');
    if (!button || button.disabled) return false;
    const box = button.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight &&
      button.contains(document.elementFromPoint(box.x + box.width/2, box.y + box.height/2));
  })()`;
  check('UX-04：320px 完整长答复展开后下一步位于视口且可点击', await js(nextVisible));
  await screenshot('ux04-chat-320');
  await click('#selected-next', false);
  await wait(found('#selected-review'));
  if (await js(found('[name=answer-hukou][value=true]'))) await click('[name=answer-hukou][value=true]');
  await click('#selected-review button');
  await wait(found('#reviewed-plan'));
  check('原 AI 推荐可进入集中核对和完成页', true);
  await click('#rights-next');
  await wait(contains('body', '家庭少跑腿计划'));
  const planUrl = new URL(await js('location.href'));
  const planId = planUrl.searchParams.get('plan');
  const plan = (await api('/api/followup/plans/' + planId + '?memberId=' + seed.member)).plans[planId];
  check('原计划须显式创建，关联成员和原目录政策', plan.tasks.some(task => task.policyId === 'fs_med_002'));
  check('少跑腿计划保留我的高亮', await js(found('.pf-global-nav [data-tab=mine][aria-current]')));
  await screenshot('plan-320');
  check('无前端运行异常', report.exceptions.length === 0);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  socket?.close();
  browser.kill();
  writeFileSync(join(evidence, 'edge-' + run + '.json'), JSON.stringify(report, null, 2) + '\n');
}
