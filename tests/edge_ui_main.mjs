import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const evidence = resolve('evidence');
const suffix = process.env.PF_V32_TEST_SUFFIX || '';
const seed = JSON.parse(readFileSync(process.env.PF_V32_TEST_SEED || join(evidence, 'ui-main.stdout.log'), 'utf8').trim());
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(resolve('data/private-migration/edge-ui-main-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'], {windowsHide:true, stdio:'ignore'});
const report = {origin:seed.origin, checks:[], responses:[], exceptions:[]};
let socket;
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function until(read, label) {
  for (let attempt=0; attempt<560; attempt++) {
    const value = await read();
    if (value) return value;
    await sleep(125);
  }
  throw Error('等待超时 ' + label);
}
function check(label, value) {
  assert(value, label);
  report.checks.push(label);
}

try {
  const health = await (await fetch(seed.origin+'/api/health')).json();
  check('隔离服务健康并加载 16 条原有项目', health.ok === true && health.policy_count === 16);
  const debugPort = await until(() => {
    const file = join(profile, 'DevToolsActivePort');
    return existsSync(file) && Number(readFileSync(file, 'utf8').split('\n')[0]);
  }, 'Edge 调试端口');
  const debugOrigin = 'http://127.0.0.1:'+debugPort;
  report.browser = (await (await fetch(debugOrigin+'/json/version')).json()).Browser;
  const tabs = await (await fetch(debugOrigin+'/json/list')).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    socket.addEventListener('open', ok, {once:true});
    socket.addEventListener('error', fail, {once:true});
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
    if (method === 'Network.responseReceived' && params.response.url.startsWith(seed.origin+'/api/')) {
      report.responses.push({path:params.response.url.slice(seed.origin.length), status:params.response.status});
    }
  });
  const send = (method, params={}) => new Promise((ok, fail) => {
    const id = ++next;
    pending.set(id, {ok, fail});
    socket.send(JSON.stringify({id, method, params}));
  });
  const js = async expression => {
    const response = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (response.exceptionDetails) throw Error(response.result.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const wait = expression => until(() => js(expression), expression);
  const click = async selector => {
    const point = await js(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({block:'center',behavior:'instant'});
      const box = element.getBoundingClientRect();
      return {x:box.x+box.width/2,y:box.y+box.height/2};
    })()`);
    for (const type of ['mousePressed','mouseReleased']) {
      await send('Input.dispatchMouseEvent', {type,...point,button:'left',clickCount:1});
    }
  };
  const setField = (selector, value, event) => js(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true}));
    return element.value;
  })()`);
  const screenshot = async name => {
    const shot = await send('Page.captureScreenshot', {format:'png'});
    writeFileSync(join(evidence, name+suffix+'.png'), Buffer.from(shot.data, 'base64'));
  };
  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  const navigate = path => send('Page.navigate',{url:new URL(path,seed.origin).href});
  const mainText = value => 'document.querySelector("main")?.innerText.includes(' + JSON.stringify(value) + ')';
  const url = () => js('location.href');
  const matches = selector => '!!document.querySelector(' + JSON.stringify(selector) + ')';
  const api = async path => (await fetch(seed.origin+path)).json();
  const state = async () => {
    const values = new URL(await url()).searchParams;
    return api('/api/followup/v32/state?' + new URLSearchParams({id:values.get('id'),memberId:values.get('member')}));
  };
  const offline = process.argv.includes('--offline');
  assert.equal(seed.origin, 'http://127.0.0.1:' + (offline ? '8138' : '8137'));
  assert.equal(resolve(seed.database), resolve('data/private-migration/v32-ui-main' + (offline ? '-offline' : '') + '/acceptance.db'));
  const size = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  const dimensions = [[320,844],[375,812],[390,844],[1366,900]];
  async function capture(name) {
    for (const [width,height] of dimensions) {
      await size(width,height);
      await sleep(120);
      check(name + ' · ' + width + '×' + height + ' 无横向溢出',
        await js('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
      await js(name === 'UI-06' ? 'document.querySelector("#conversation").scrollIntoView()' : 'window.scrollTo(0,0)');
      await screenshot('ui-main-' + name + '-' + width);
    }
    await size(390,844);
  }
  await size(390,844);
  if (offline) {
    await navigate('/analysis.html?demo=medical');
    await wait(matches('#intake'));
    await click('#intake button');
    await wait(matches('#fallback'));
    check('真实客户端错误后保留原始描述及重试入口', (await state()).original_description.description.includes('住院') &&
      await js(matches('[data-action=analyze]')));
    await screenshot('ui-main-AI-fallback-390');
    await click('#fallback button.primary');
    await wait(matches('#recommendations'));
    check('实际运行基础规则，返回规则结果', (await state()).result.mode === 'rules');
    await screenshot('ui-main-rules-390');
  } else {
    await navigate('/find.html');
    await wait(matches('#startDiscovery'));
    await click('#startDiscovery');
    await wait('document.querySelector("#chooseMember select").options.length > 1');
    await setField('#chooseMember select',seed.member,'change');
    await click('#chooseMember button');
    await wait(matches('#intake'));
    check('在发现入口选择成员，输入页没有成员选择器', await js('!document.querySelector("#member") && document.querySelector(".member-note").innerText.includes("验收甲")'));
    await setField('#intake textarea[name=description]','合成草稿，用于浏览器回读。','input');
    await send('Page.reload');
    await wait('document.querySelector("#intake textarea")?.value.includes("合成草稿")');
    check('刷新恢复该成员输入草稿',true);

    await navigate('/analysis.html?demo=medical');
    await wait(matches('#intake'));
    await capture('UI-02');
    await click('#intake button');
    await wait(matches('.analysis-progress'));
    await capture('UI-03');
    await wait(matches('#recommendations') + ' || ' + matches('#fallback'));
    const found = await state();
    assert.equal(found.result?.mode,'ai',found.error || '预期真实 AI 推荐');
    check('真实 DeepSeek 无冲突自动出结果，已给参保事实进入规则', found.result.confirmed.basic.insurance === true);
    assert(found.result.policy_candidates.length, '医疗案例没有候选');
    const medicalUrl = await url();
    report.resultUrl = medicalUrl;
    await wait('document.querySelector("[data-favorite]:not(:disabled)")');
    const first = found.result.policy_candidates.find(row=>row.id==='fs_med_002' && row.canPlan) ||
      found.result.policy_candidates.find(row=>row.canPlan) || found.result.policy_candidates[0];
    const policy = '[data-policy="'+first.id+'"]';
    const favorite = policy + ' [data-favorite]';
    if (await js('document.querySelector('+JSON.stringify(favorite)+')?.getAttribute("aria-pressed") !== "true"')) await click(favorite);
    await wait('!document.querySelector("#selected-next")?.disabled');
    await capture('UI-05');
    await click('[data-action=open-chat]');
    await wait(matches('#conversation[open]'));
    await setField('#chat textarea','本次查询确认使用的年龄是多少？','input');
    await click('#chat button');
    await wait(matches('#chat-log article'));
    check('真实 AI 追问关联同一成员和查询版本', (await state()).messages.at(-1).answer.includes('68'));
    await capture('UI-06');
    await click(policy + ' a[href^="policy.html"]');
    await wait(matches('.detail-actions'));
    check('详情展示真实候选名称、依据、条件及四栏导航',await js(mainText(first.name)+' && '+mainText('查看政策依据')+' && document.querySelectorAll("nav a").length===4'));
    await capture('UI-07');
    await click('.detail-actions .primary');
    await wait('document.querySelector("[data-favorite][aria-pressed=true]")');
    check('详情返回恢复已选状态', true);
    await click('#selected-next');
    await wait(matches('#selected-review')+' || '+matches('#reviewed-plan'));
    if(await js(matches('#reviewed-plan'))) await click('a[href*="view=selected-edit"]');
    await wait(matches('#selected-review'));
    check('集中核对只问所选未知项，不重问已明确参保',
      await js('!document.querySelector("[name=answer-insurance]") && !document.querySelector("#selected-review [data-favorite]")'));
    await capture('UI-08');
    if(await js(matches('[name=answer-hukou][value=true]'))) await click('[name=answer-hukou][value=true]');
    await click('#selected-review button');
    await wait(matches('#reviewed-plan'));
    report.completeUrl = await url();
    check('核对直达精简完成页，保存不建计划', await js(mainText('为你整理好了')+' && '+mainText('稍后再办')+' && document.querySelectorAll(".rights-focus").length===1') &&
      Object.keys((await state()).plans || {}).length === 0);
    await capture('UI-09');
    await send('Page.reload');
    await wait(matches('#reviewed-plan'));
    check('刷新恢复已选及完成页', true);
    await click('#rights-next');
    await wait(mainText('家庭少跑腿计划'));
    report.planUrl = await url();
    check('用户启动计划后打开原业务计划页',new URL(report.planUrl).searchParams.get('member') === seed.member);
    if(first.id==='fs_med_002'){
      const id = new URL(report.planUrl).searchParams.get('plan');
      const plan = (await api('/api/followup/plans/'+id+'?memberId='+seed.member)).plans[id];
      check('计划读取本次核对的户籍事实，未创建提交记录',
        plan.tasks.some(task=>task.policyId===first.id && !task.submission && task.conditionChecks.some(row=>
          row.id==='qualify:0' && row.state==='confirmed' && row.answer==='met')));
    }
    const crossed = new URL(report.completeUrl);
    crossed.searchParams.set('member',seed.other);
    await navigate(crossed.href);
    await wait(mainText('未找到该成员的分析'));
    check('换成员无法读取原查询',true);
    await navigate('/analysis.html?view=history&member='+seed.member);
    await wait('document.querySelector("#history .history a")');
    await click('#history .history a');
    await wait(matches('#recommendations'));
    check('从成员历史恢复推荐和选择', (await state()).id === found.id);

    await navigate('/analysis.html?demo=age');
    await wait(matches('#intake'));
    await click('#intake button');
    await wait(matches('#resolve'));
    await click('[name=ageChoice][value=custom]');
    for (const invalid of ['', '-1', '4.5', 'abc', '121']) {
      await setField('#custom-age input',invalid,'input');
      await click('#resolve button');
      check('年龄冲突拒绝 ' + (invalid || '空值'), await js(matches('#resolve')));
    }
    await setField('#custom-age input','55','input');
    await capture('UI-04');
    await click('#resolve button');
    await wait(matches('#recommendations'));
    const fixed = await state();
    check('真实 AI 使用修正年龄，保留原 68 / 65 岁来源',
      fixed.result.mode === 'ai' && fixed.result.confirmed.basic.age === 55 && fixed.basic.age === 68 &&
      fixed.original_description.description.includes('65岁'));
    await send('Page.reload');
    await wait(matches('#recommendations'));
    check('年龄冲突解决后刷新不再弹出', !(await js(matches('#resolve'))));
    report.ageUrl = await url();
  }
  check('无前端运行异常',report.exceptions.length===0);
} catch(error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  socket?.close();
  browser.kill();
  const name = process.argv.includes('--offline') ? 'edge-ui-main-offline.json' : 'edge-ui-main.json';
  writeFileSync(join(evidence,name),JSON.stringify(report,null,2)+'\n');
}
