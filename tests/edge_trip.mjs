import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const evidence = resolve('evidence');
const baselineOnly = process.env.PF_TRIP_BASELINE === '1';
const run = baselineOnly ? 'trip-before' : 'trip-after';
const seedFile = baselineOnly ? 'evidence/baseline-source/data/private-migration/v33-trip-baseline/fixture.json' :
  'data/private-migration/v33-' + (process.env.PF_TRIP_INSTANCE || 'trip-final') + '/fixture.json';
const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
assert.equal(seed.origin, 'http://127.0.0.1:' + (baselineOnly ? '8157' : (process.env.PF_TRIP_PORT || '8163')));
assert.equal(seed.search_mode, 'mock');
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
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  const heading = name => wait(contains('#followupView h1', name));
  const href = selector => js(element(selector) + '.href');
  const clickThen = async (selector, name) => {await click(selector); await heading(name);};
  const layout = async name => {
    for (const width of widths) {
      await size(width);
      await js('scrollTo(0,0)');
      await sleep(80);
      check(name + ' ' + width + 'px 五栏布局无横向溢出', await js(`innerWidth === ${width} &&
        document.documentElement.scrollWidth === document.documentElement.clientWidth && document.querySelectorAll('.pf-global-nav a').length === 5 &&
        !!document.querySelector('.pf-global-nav [data-tab=mine][aria-current]')`));
      await screenshot(name + '-' + width);
    }
    await size(390);
  };
  await size(390);
  await navigate('/analysis.html?member=' + seed.member);
  await wait(found('#intake'));
  await field('[name=age]', '68');
  await field('[name=region]', '佛山市', 'change');
  await field('[name=description]', '合成案例：母亲68岁，住在佛山市，住院自费3万元，家庭经济困难，需要了解医疗救助。');
  await click('#intake button');
  await wait(found('#recommendations'));
  const favorite = '[data-favorite="fs_med_002"]';
  await wait(found(favorite + ':not(:disabled)'));
  const secondPolicy = 'fs_med_005';
  for (const policy of baselineOnly ? ['fs_med_002'] : ['fs_med_002',secondPolicy]) {
    const button = '[data-favorite="' + policy + '"]';
    if (await js(found(button + ':not(:disabled)')) &&
        await js(element(button) + '.getAttribute("aria-pressed") !== "true"')) await click(button);
  }
  await wait(found('#selected-next:not(:disabled)'));
  await click('#selected-next');
  await wait(found('#selected-review'));
  if (await js(found('[name=answer-hukou][value=true]'))) {
    await click('.selected-condition:has([name=answer-hukou]) > summary');
    await click('[name=answer-hukou][value=true]');
  }
  await click('#selected-review button');
  await wait(found('#reviewed-plan'));
  await clickThen('#rights-next','家庭少跑腿计划');
  const planUrl = await js('location.href');
  const planId = new URL(planUrl).searchParams.get('plan');
  const planApi = '/api/followup/plans/' + planId + '?memberId=';
  const plan = async () => (await api(planApi + seed.member)).plans[planId];
  const task = async () => (await plan()).tasks.find(row => row.policyId === 'fs_med_002');
  const route = view => '/follow-up.html?view=' + view + '&plan=' + planId + '&member=' + seed.member + '&pid=fs_med_002';
  check('AI选择、集中核对、完成页创建关联计划，初始无提交结果',
    (await task()).stage === 'pending' && !(await task()).submission && (await plan()).progress.done === 0);
  if (baselineOnly) {
    await screenshot('UI-10-before-390');
    for (const [view,title,name] of [['conditions','条件核对','UI-11'],['prepare','材料准备','UI-12'],
        ['task','办理任务','UI-14']]) {
      await navigate(route(view));
      await heading(title);
      await screenshot(name + '-before-390');
    }
    await js(`async function start() { const d = await PFBusiness.plan('${planId}', '${seed.member}');
      const task = d.plans['${planId}'].tasks.find(t=>t.policyId==='fs_med_002');
      await PFBusiness.command('workflow',{action:'start_preparation',planId:'${planId}',policyId:task.policyId,
        memberId:'${seed.member}',taskId:task.id,expectedRevision:task.revision}); }; start()`);
    await send('Page.reload'); await heading('办理任务');
    await wait(found('[data-workflow=review_submission]'));
    await js('document.querySelector("[data-workflow=review_submission]").scrollIntoView()');
    await screenshot('UI-13-before-390');
  } else {
    await layout('UI-10');
    const tasks = (await plan()).tasks;
    check('同一计划含两项已选择权益', tasks.length >= 2);
    await click('[data-plan-policy="' + secondPolicy + '"]');
    await wait(found('[data-plan-policy="' + secondPolicy + '"][aria-current]'));
    await click('[data-plan-policy="fs_med_002"]');
    await wait(found('[data-plan-policy="fs_med_002"][aria-current]'));
    check('可自行切换办理事项', true);
    await clickThen('.fu-lead .fu-primary','补充必要条件');
    const hukou = (await task()).conditionChecks.find(row=>row.id==='qualify:0');
    check('沿用集中核对户籍，条件区不重复询问',
      hukou?.source === 'confirmed_profile' &&
      !(await js(found('.fu-condition-list [data-condition="qualify:0"]'))));
    await layout('UI-11');
    check('拟申请的困难家庭认定保留官方核实状态',
      (await task()).conditionChecks.some(row=>row.id==='qualify:1' && row.state==='pending' && !row.canRecord));
    await clickThen('a[href*="view=prepare"].fu-button','材料准备清单');
    await layout('UI-12');
    check('跳过条件后可查看材料', (await task()).stage === 'pending');
    await clickThen('.fu-entry','材料详情');
    await layout('material');
    await js(`window.originalFetch = window.fetch;
      window.fetch = (...args) => String(args[0]).endsWith('/commands') ?
        Promise.resolve(new Response(JSON.stringify({detail:'模拟保存失败'}),{status:503})) : window.originalFetch(...args)`);
    await field('[name=state]', 'ready','change');
    await field('[name=reason]', '合成测试备注');
    await click('.fu-material button');
    await wait(contains('.fu-inline-feedback','模拟保存失败'));
    check('保存失败保留状态和备注且数据库未写入', await js(element('[name=reason]')+'.value === "合成测试备注" && '+element('[name=state]')+'.value === "ready"') &&
      (await task()).materials.every(row=>row.reason!=='合成测试备注'));
    await js('window.fetch = window.originalFetch');
    await clickThen('.fu-material button','材料准备清单');
    await send('Page.reload'); await heading('材料准备清单');
    check('材料详情保存返回，刷新后材料备注及计数保持',
      (await task()).materials.some(row=>row.reason==='合成测试备注' && row.state==='ready') &&
      await js(contains('#materialTotals','已准备 1')));
    await clickThen('a.fu-primary[href*="view=review"]','提交前核对与办理渠道');
    await layout('UI-13');
    await click('a[href="#official-channels"]');
    check('尚有缺项时仍可查看政府原文，查看渠道无提交写入', await js(`location.hash==='#official-channels' &&
      /^https:\/\//.test(document.querySelector('#official-channels a[target=_blank]').href)`) &&
      (await task()).materials.some(row=>row.state==='missing') && !(await task()).submission);
    await clickThen('#official-channels a[href*="view=task"]','办理进度与结果记录');
    await layout('UI-14');
    await click('#executionForm button');
    await wait(contains('#executionStatus','尚未保存'));
    check('缺少实际提交确认时保持原状态', !(await task()).submission);
    await click('[name=submitted]');
    await field('[name=submittedDate]','2026-11-14','change');
    await field('[name=channel]','合成验收渠道');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('确认实际提交后显示等待反馈并保存用户输入', (await task()).stage==='in_progress' &&
      (await task()).submission.channel==='合成验收渠道' && await js(contains('.fu-lead','等待反馈')));
    await clickThen('.fu-lead .fu-primary','办理进度与结果记录');
    await field('[name=result]','needs_supplement','change');
    await field('[name=note]','合成验收：需补件');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('保存需要补件后返回总览', (await task()).stage==='needs_supplement');
    await navigate(route('task')); await heading('办理进度与结果记录');
    await field('[name=status]','confirm_submission','change');
    await click('[name=submitted]');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('实际补交后恢复等待反馈并保留补件历史', (await task()).stage==='in_progress' &&
      (await task()).workflowHistory.some(row=>row.newStage==='needs_supplement'));
    await clickThen('.fu-lead .fu-primary','办理进度与结果记录');
    await field('[name=result]','completed','change');
    await field('[name=note]','合成验收：收到办结反馈');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('办结后突出另一权益', (await task()).stage==='completed' &&
      await js(found('[data-plan-policy="' + secondPolicy + '"][aria-current]')));
    await screenshot('UI-10-resumed-390');
    await click('.pf-global-nav [data-tab=mine]');
    await wait(found('#minePlanLink[href]'));
    await click('#minePlanLink');
    if (!(await js(contains('#followupView h1','家庭少跑腿计划')))) {
      await heading('我的少跑腿计划');
      await clickThen('a[href*="plan_id="]','家庭少跑腿计划');
    }
    check('我的入口恢复同一份计划和办结状态', (await js('location.href')).includes(planId) &&
      await js(contains('[data-plan-policy="fs_med_002"]','已办结')));
    await send('Page.reload'); await heading('家庭少跑腿计划');
    check('刷新后仍显示办结', await js(contains('[data-plan-policy="fs_med_002"]','已办结')));
    const reviewDraft = await task();
    const completedCount = (await plan()).progress.done;
    check('办理结果与提交回执独立保存，完成数只计办结', reviewDraft.outcome.result === 'completed' &&
      !!reviewDraft.submission && completedCount === 1);
    const wrongMember = await fetch(seed.origin + planApi + seed.other);
    check('另一个家庭成员无法读取该计划', wrongMember.status === 404);
    await navigate('/follow-up.html?view=plan&plan='+planId+'&member='+seed.other);
    await heading('记录暂不可用');
    check('成员串用链接不显示原计划内容', !(await js(found('[data-plan-policy]'))));

    await navigate('/analysis.html?member=' + seed.other);
    await wait(found('#intake'));
    await field('[name=age]', '69');
    await field('[name=region]', '佛山市', 'change');
    await field('[name=description]', '合成案例：69岁，住院自付3万元，需要了解佛山市医疗救助。');
    await click('#intake button');
    await wait(found('#recommendations'));
    const medical = '[data-favorite="fs_med_001"]';
    await wait(found(medical + ':not(:disabled)'));
    await click(medical);
    await wait(found('#selected-next:not(:disabled)'));
    await click('#selected-next');
    await wait(found('#selected-review'));
    await click('#selected-review button');
    await wait(found('#reviewed-plan'));
    await clickThen('#rights-next','家庭少跑腿计划');
    const otherPlanId = new URL(await js('location.href')).searchParams.get('plan');
    await clickThen('.fu-lead .fu-primary','补充必要条件');
    const condition = '.fu-condition-list .fu-condition-item:has(select[name=answer])';
    await wait(found(condition));
    await click(condition + ' > summary');
    await field(condition + ' select[name=answer]','met','change');
    await click(condition + ' button[type=submit]');
    await wait(contains('#followupStatus','已保存'));
    await send('Page.reload'); await heading('补充必要条件');
    const otherPlan = (await api('/api/followup/plans/' + otherPlanId + '?memberId=' + seed.other)).plans[otherPlanId];
    check('缺失条件可填写是，刷新后恢复为用户自述且不再要求补填', otherPlan.tasks[0].conditionChecks.some(
      row=>row.source==='user_record' && row.answer==='met') && await js(contains('details.fu-disclosure','自述：是')));
    await screenshot('UI-11-recorded-390');
  }
  check('无前端运行异常', report.exceptions.length === 0);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  socket?.close();
  browser.kill();
  writeFileSync(join(evidence, 'edge-' + run + '.json'), JSON.stringify(report, null, 2) + '\n');
}
