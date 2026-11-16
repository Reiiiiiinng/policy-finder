import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const evidence = resolve('evidence');
mkdirSync(evidence, { recursive: true });
const baselineOnly = process.env.PF_TRIP_BASELINE === '1';
const live = process.env.PF_AUDIT_LIVE === '1'; const run = process.env.PF_AUDIT_PHASE || 'remediation';
const seedFile = baselineOnly ? 'evidence/baseline-source/data/private-migration/v33-trip-baseline/fixture.json' :
  'data/private-migration/v33-' + (process.env.PF_TRIP_INSTANCE || 'trip-final') + '/fixture.json';
const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
assert.equal(seed.origin, 'http://127.0.0.1:' + (baselineOnly ? '8157' : (process.env.PF_TRIP_PORT || '8163')));
assert.equal(seed.search_mode, live ? 'live' : 'mock');
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
const report = {instance:seed.instance, process:seed.pid, mode: seed.search_mode, checks: [], requests: [], exceptions: [], screenshots: []};
let socket;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const widths = [320, 375, 390, 1366];

async function until(read, label) {
  for (let attempt = 0; attempt < (live ? 900 : 240); attempt++) {
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
  const api = async path => {
    const response=await fetch(seed.origin+path);
    assert.equal(response.headers.get('x-pf-preview-run'),seed.run);
    return response.json();
  };
  const baseline = await api('/api/policies');
  check('目录共 17 条，广州 10、佛山 7', baseline.total === 17 &&
    baseline.policies.filter(p => p.region.includes('广州')).length === 10 &&
    baseline.policies.filter(p => p.region.includes('佛山')).length === 7);
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
    if (method === 'Network.responseReceived' && params.response.url.includes('/api/')) report.requests.push({status:params.response.status,url:params.response.url});
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
    width, height: width > 600 ? 900 : width===375 ? 812 : 844, deviceScaleFactor: 1, mobile: width < 600,
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
  const clickThen = async (selector, name) => {await wait(found(selector)); await click(selector); await heading(name);};
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
  await navigate('/find.html');
  await wait('location.pathname==="/find.html" && document.readyState==="complete"');
  await js(`fetch('/api/followup/members').then(r=>{if(r.headers.get('x-pf-preview-run')!==${JSON.stringify(seed.run)})throw Error('Edge instance mismatch')})`);
  if(run==='restore' || run.endsWith('-restore')){
    const before=JSON.parse(readFileSync(join(evidence,process.env.PF_AUDIT_PRIOR || 'edge-remediation.json'),'utf8'));
    const p=new URL(before.planUrl);
    const id=p.searchParams.get('plan'), member=before.member.id;
    await navigate('/services.html?member='+member);
    const entry='#minePlanLink[href*="member='+member+'"]';
    await wait(found(entry));
    report.mineTarget=await href(entry);
    await screenshot('mine-before-click');
    await click(entry);
    await heading('我的少跑腿计划');
    await clickThen('a[href*="'+id+'"]','家庭少跑腿计划');
    report.finalPlan=(await api('/api/followup/plans/'+id+'?memberId='+member)).plans[id];
    assert.deepEqual(report.finalPlan,before.finalPlan);
    await screenshot('plan-reopened');
    await navigate('/analysis.html?member='+member);
    await wait(found('#intake'));
    check('新 Edge 恢复未提交草稿', await js(element('[name=description]')+'.value === "合成未提交草稿，重启后继续。"'));
    await screenshot('draft-reopened');
  } else {
  let people=(await api('/api/followup/members')).members.find(p=>p.name==='全链路合成父亲');
  if (!people) {
    await navigate('/follow-up.html?view=members&member='+seed.member);
    await wait(found('#fuAddMember'));
    await field('#fuAddMember [name=name]', '全链路合成父亲');
    await field('#fuAddMember [name=relation]', '父亲','change');
    await click('#fuAddMember button');
    people = await until(async()=> (await api('/api/followup/members')).members.find(p=>p.name==='全链路合成父亲'), 'synthetic father');
  }
  seed.member=people.id;
  report.member=people;
  if (live) {
    await navigate('/');
    await wait(found('.pf-global-nav [data-tab=discover]'));
    await screenshot('home');
    await click('.pf-global-nav [data-tab=discover]');
    await wait('location.pathname === "/find.html"');
    await wait(found('#startDiscovery'));
    await click('#startDiscovery');
  } else await navigate('/analysis.html');
  const fatherRadio='input[name=member][value="'+seed.member+'"]';
  await wait(found(fatherRadio));
  await click('label:has('+fatherRadio+')');
  await screenshot('member-selected');
  await click('form:has('+fatherRadio+') button[type=submit]');
  await wait(found('#intake'));
  await field('[name=age]', '68');
  await field('[name=region]', '佛山市', 'change');
  await field('[name=description]', live
    ? '合成案例：父亲68岁，住在佛山市南海区，长期卧床，洗澡、穿衣需要家人帮忙。想了解上门照护和养老服务消费补贴，尚未参加能力评估。'
    : '合成案例：父亲68岁，住在佛山市，日常需照护，住院自费3万元，家庭经济困难，需要了解医疗救助。');
  if (live) for (const width of widths.slice(0,3)) {
    await size(width);
    check('输入表单 ' + width + 'px 无横向裁切', await js(`innerWidth === ${width} &&
      document.querySelector('#intake').scrollWidth <= document.querySelector('#intake').clientWidth &&
      document.documentElement.scrollWidth === innerWidth`));
    await screenshot('intake-' + width);
  }
  await screenshot('intake');
  await click('#intake button');
  await wait('!!document.querySelector("#recommendations,#fallback,#resolve,#revise,#confirm") || /暂时无法|普通查询/.test(document.body.innerText)');
  await screenshot('first-analysis');
  report.analysis = {url:await js('location.href'),body:await js('document.body.innerText')};
  if (await js(found('#confirm'))) { await click('#confirm button'); await wait(found('#recommendations')); }
  if (live) {
    await wait(found('#recommendations'));
    const url = new URL(await js('location.href'));
    const state = await api('/api/followup/v32/state?id='+url.searchParams.get('id')+'&memberId='+seed.member);
    const ids = state.result.policy_candidates.map(row=>row.id);
    check('真实 DeepSeek 返回养老补贴，未出现商业保险或无关困难认定', state.result.mode === 'ai' &&
      ids.length === 1 && ids[0] === 'fs_care_001');
    check('官方能力评估仍待核实', state.result.policy_candidates.find(row=>row.id==='fs_care_001')
      .conditions.some(condition=>condition.action_status==='official_required'));
    report.model = {mode: state.result.mode, policyIds: ids};
    await screenshot('recommendations');
    const favorite = '[data-favorite="fs_care_001"]';
    await wait(found(favorite+':not(:disabled)'));
    if (await js(element(favorite)+'.getAttribute("aria-pressed") !== "true"')) await click(favorite);
    await wait(found('#selected-next:not(:disabled)'));
    await click('#selected-next');
    await wait(found('#selected-review button'));
    await click('#selected-review button');
    await wait(found('#reviewed-plan'));
    await screenshot('completion');
    await clickThen('#rights-next','家庭少跑腿计划');
    report.planUrl=await js('location.href');
    const planId=new URL(report.planUrl).searchParams.get('plan');
    const saved=async()=>(await api('/api/followup/plans/'+planId+'?memberId='+seed.member)).plans[planId];
    const task=async()=>(await saved()).tasks.find(x=>x.policyId==='fs_care_001');
    check('真实发现连接到持久化计划，未写入提交记录', (await task()).stage==='pending' && !(await task()).submission);
    await screenshot('plan');
    await clickThen('.fu-lead .fu-primary','补充必要条件');
    await clickThen('a[href*="view=prepare"].fu-button','材料准备清单');
    await screenshot('materials');
    await clickThen('a.fu-primary[href*="view=review"]','提交前核对与办理渠道');
    check('官方渠道可见民政通', await js(contains('#official-channels','民政通')));
    await screenshot('channel');
    await clickThen('#official-channels a[href*="view=consult"]','官方咨询与核实');
    await screenshot('consult');
    await clickThen('#followupView header a','提交前核对与办理渠道');
    check('咨询返回原养老补贴事项', await js(contains('#official-channels','民政通')) && !(await task()).submission);
    await navigate('/services.html?member='+seed.member);
    const entry='#minePlanLink[href*="member='+seed.member+'"]';
    await wait(found(entry));
    await click(entry);
    await wait('!!document.querySelector("#followupView h1") && /我的少跑腿计划|家庭少跑腿计划/.test(document.querySelector("#followupView h1").textContent)');
    if (await js(contains('#followupView h1','我的少跑腿计划'))) {
      await clickThen('a[href*="'+planId+'"]','家庭少跑腿计划');
    }
    await send('Page.reload');
    await heading('家庭少跑腿计划');
    check('我的恢复同一事项，刷新仍在',
      new URL(await js('location.href')).searchParams.get('plan')===planId && (await task()).policyId==='fs_care_001');
    await screenshot('mine-restored');
  } else {
  await wait(found('#recommendations'));
  await screenshot('recommendations');
  if (!baselineOnly) {
    check('推荐卡同时显示用途、推荐理由、待核实条件和下一步', await js(
      '!!document.querySelector(".policy-card .policy-benefit") && '+
      '["为什么推荐", "还需核实", "下一步"].every(label=>document.querySelector(".policy-card").textContent.includes(label))'));
    check('隔离预览明确标记 AI 模拟结果', await js('document.body.textContent.includes("AI 模拟结果")'));
    for (const width of widths) {
      await size(width);
      await js('document.querySelector(".policy-card").scrollIntoView({block:"start"})');
      await sleep(80);
      check('推荐卡 '+width+'px 无横向溢出', await js(
        `innerWidth===${width} && document.querySelector(".result-scroll").scrollWidth===document.querySelector(".result-scroll").clientWidth`));
      await screenshot('v34-card-'+width);
    }
    await size(390);
  }
  await click('[data-action=open-chat]');
  await field('#chat-question','补充事实：父亲已经参加佛山市基本医疗保险。需要核对哪些条件？');
  await click('#chat button');
  await wait(found('#chat-log article'));
  await screenshot('chat');
  report.chat=await js('document.querySelector("#conversation").innerText');
  const favorite = '[data-favorite="fs_med_002"]';
  await wait(found(favorite + ':not(:disabled)'));
  const secondPolicy = 'fs_med_005';
  for (const policy of baselineOnly ? ['fs_med_002'] : ['fs_med_002',secondPolicy]) {
    const button = '[data-favorite="' + policy + '"]';
    await wait(found(button + ':not(:disabled)'));
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
  if (!baselineOnly) await screenshot('v34-completion-390');
  await clickThen('#rights-next','家庭少跑腿计划');
  const planUrl = await js('location.href');
  const planId = new URL(planUrl).searchParams.get('plan');
  report.planUrl=planUrl; const planApi = '/api/followup/plans/' + planId + '?memberId=';
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
    report.review=await js('document.querySelector("#followupView").innerText');
    report.officialLinks=await js('[...document.querySelectorAll("#official-channels a")].map(a=>[a.textContent,a.getAttribute("href")])');
    const beforeConsult = await task();
    report.conditionBeforeConsult=beforeConsult.conditionChecks;
    const consultLink='#official-channels a[href*="view=consult"]';
    await wait(found(consultLink));
    await clickThen('nav a[href*="view=conditions"]','补充必要条件');
    const direct='.fu-condition-item:has(a[href*="view=consult"])';
    await wait(found(direct));
    if (!await js(found(direct+'[open]'))) {
      const outer=await js(element(direct)+'.parentElement.closest("details")?.className');
      if(outer) await click('.fu-disclosure:has(a[href*="view=consult"]) > summary');
      await click(direct+' > summary');
    }
    await clickThen(direct+' a[href*="view=consult"]','官方咨询与核实');
    check('条件直达咨询携带 task 和 condition', await js('new URLSearchParams(location.search).has("task") && new URLSearchParams(location.search).has("condition")'));
    check('不重复咨询已确认户籍', !await js('document.querySelector("#followupView").innerText.includes("家庭成员是否具有当地户籍")'));
    await screenshot('consult-no-record');
    report.consult = {url:await js('location.href'), text:await js('document.querySelector("#followupView").innerText'),
      links:await js('[...document.querySelectorAll("#followupView a")].map(a=>[a.textContent,a.getAttribute("href")])')};
    await click('[data-copy]');
    await wait(contains('#followupStatus','已复制'));
    report.consult.copyFeedback=await js('document.querySelector("#followupStatus").innerText');
    await clickThen('#followupView header a','补充必要条件');
    await wait(found('.fu-condition-item[open]'));
    report.consult.skipReturn={url:await js('location.href'),records:(await plan()).consultations.length, revision:(await task()).revision};
    await clickThen('nav a[href*="view=review"]','提交前核对与办理渠道');
    await clickThen(consultLink,'官方咨询与核实');
    await click('[data-consult-contact]');
    await wait(contains('#followupStatus','已标记联系'));
    check('轻量已联系状态独立保存', (await task()).consultationStatus==='contacted' && (await plan()).consultations.length===0);
    await field('#consultForm [name=sourceType]','official_reply_recorded','change');
    await field('#consultForm [name=institution]','合成咨询机构');
    await field('#consultForm [name=date]','2026-11-14','change');
    await field('#consultForm [name=channel]','模拟窗口');
    await field('#consultForm [name=content]','请问是否需要困难家庭认定？');
    await field('#consultForm [name=answer]','合成转记：由受理机构审核，以书面通知为准。');
    await field('#consultForm [name=pending]','下次核实材料');
    await click('#consultForm button');
    await wait(contains('#followupStatus','咨询记录已保存'));
    report.consult.afterSave={records:(await plan()).consultations, task:await task()};
    check('咨询转记不改变条件及材料状态',JSON.stringify((await task()).conditionChecks)===JSON.stringify(beforeConsult.conditionChecks) &&
      JSON.stringify((await task()).materials)===JSON.stringify(beforeConsult.materials));
    await clickThen('a[href*="view=record"]','咨询记录');
    await screenshot('consult-record');
    report.consult.recordPage=await js('document.querySelector("#followupView").innerText');
    report.consult.recordBack=await href('#followupView header a');
    await js('history.back()'); await heading('官方咨询与核实');
    await clickThen('#followupView header a','提交前核对与办理渠道');
    await click('[name=requirementsConfirmed]');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('待提交未创建提交记录', (await task()).stage==='ready_to_submit' && !(await task()).submission);
    await clickThen('.fu-lead a[href*="view=review"]','提交前核对与办理渠道');
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
    await field('[name=submittedDate]','2026-11-20','change');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('首次提交和最近补交分别保留', (await task()).firstSubmission.submittedDate==='2026-11-14' && (await task()).latestSupplement.submittedDate==='2026-11-20');
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
    await wait(found('a[href*="view=plans"]'));
    report.mineLanding = {url:await js('location.href'), text:await js('document.body.innerText')};
    await screenshot('mine');
    await click('a[href*="view=plans"]');
    await wait('Array.from(document.querySelectorAll("#followupView h1")).some(n=>n.textContent.includes("少跑腿计划"))');
    report.minePlans={url:await js('location.href'),text:await js('document.querySelector("#followupView").innerText')};
    if (!(await js(contains('#followupView h1','家庭少跑腿计划')))) {
      await clickThen('a[href*="'+planId+'"]','家庭少跑腿计划');
    }
    check('我的入口恢复同一份计划', (await js('location.href')).includes(planId));
    await send('Page.reload'); await heading('家庭少跑腿计划');
    check('刷新后仍显示办结', await js(contains('[data-plan-policy="fs_med_002"]','已办结')));
    const wrongMember = await fetch(seed.origin + planApi + seed.other);
    check('另一个家庭成员无法读取该计划', wrongMember.status === 404);
    await navigate('/follow-up.html?view=plan&plan='+planId+'&member='+seed.other);
    await heading('记录暂不可用');
    check('成员串用链接不显示原计划内容', !(await js(found('[data-plan-policy]'))));
    await navigate(planUrl); await heading('家庭少跑腿计划');
    await wait(found('#planPauseForm'));
    await field('#planPauseForm [name=reason]', '合成暂停');
    await click('#planPauseForm button');
    await wait(contains('#followupStatus','计划已暂停'));
    check('整计划暂停保留两个任务状态', (await plan()).pausedAt && (await task()).stage==='completed');
    await click('#planPauseForm button');
    await wait(contains('#followupStatus','计划已恢复'));
    check('整计划恢复', !(await plan()).pausedAt);
    await click('[data-plan-policy=fs_med_002]');
    await wait(found('[data-plan-policy=fs_med_002][aria-current]'));
    await clickThen('.fu-lead .fu-primary','办理进度与结果记录');
    await field('[name=correctionReason]','合成更正：提前误记了办结。');
    await click('[name=correctionConfirmed]');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('终态更正保留原办结并重开', (await task()).stage==='in_progress' &&
      (await task()).workflowHistory.some(e=>e.reason==='correct_result' && e.details.previousOutcome.result==='completed'));
    await clickThen('.fu-lead .fu-primary','办理进度与结果记录');
    await field('[name=result]','feedback_received','change');
    await field('[name=note]','合成：收到进度反馈。');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('反馈独立于办结', (await task()).stage==='in_progress' && (await task()).outcome.result==='feedback_received');
    await clickThen('.fu-lead .fu-primary','办理进度与结果记录');
    await field('[name=result]','completed','change');
    await field('[name=note]','合成：最终确认已办结。');
    await clickThen('#executionForm button','家庭少跑腿计划');
    await click('[data-plan-policy=fs_med_005]');
    await wait(found('[data-plan-policy=fs_med_005][aria-current]'));
    await clickThen('.fu-lead a[href*="view=review"]','提交前核对与办理渠道');
    await clickThen('#official-channels a[href*="view=task"]','办理进度与结果记录');
    await field('[name=status]','pause','change');
    await clickThen('#executionForm button','家庭少跑腿计划');
    check('第二项暂停不影响第一项', (await plan()).tasks.find(t=>t.policyId==='fs_med_005').stage==='paused' && (await task()).stage==='completed');
    await clickThen('.fu-lead .fu-primary','办理进度与结果记录');
    await clickThen('#executionForm button','家庭少跑腿计划');
    await clickThen('.fu-lead a[href*="view=review"]','提交前核对与办理渠道');
    await clickThen('#official-channels a[href*="view=task"]','办理进度与结果记录');
    await click('[name=submitted]');
    await clickThen('#executionForm button','家庭少跑腿计划');
    await clickThen('.fu-lead .fu-primary','办理进度与结果记录');
    await field('[name=result]','rejected','change');
    await field('[name=note]','合成：暂时缺少支出材料。');
    await clickThen('#executionForm button','家庭少跑腿计划');
    await click('[data-plan-policy=fs_med_005]');
    await wait(found('[data-plan-policy=fs_med_005][aria-current]'));
    await clickThen('.fu-lead .fu-primary','办理进度与结果记录');
    await wait(contains('#followupView','合成：暂时缺少支出材料。'));
    check('未通过时显示与原情况相关候选或暂无匹配', await js('/可能相关的政策|暂未找到/.test(document.querySelector("#followupView").innerText)'));
    await screenshot('rejected');
    report.finalPlan = await plan();
    await navigate('/analysis.html?member='+seed.member+'&new=1');
    await wait(found('#intake'));
    await field('[name=description]', '合成未提交草稿，重启后继续。');
    await wait(contains('#draft-status','草稿已保存'));

  }
  }; }; check('无前端运行异常', report.exceptions.length === 0);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  socket?.close();
  browser.kill();
  writeFileSync(join(evidence, 'edge-' + run + '.json'), JSON.stringify(report, null, 2) + '\n');
}
