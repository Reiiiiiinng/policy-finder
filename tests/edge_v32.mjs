import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const evidence = resolve('evidence');
const suffix = process.env.PF_V32_TEST_SUFFIX || '';
const seed = JSON.parse(readFileSync(process.env.PF_V32_TEST_SEED || join(evidence, 'preview.stdout.log'), 'utf8').trim());
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(resolve('data/private-migration/edge-v32-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'], {windowsHide:true, stdio:'ignore'});
const report = {origin:seed.origin, checks:[], responses:[], exceptions:[]};
let socket;
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function until(read, label) {
  for (let attempt=0; attempt<600; attempt++) {
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
  const widths = [[320,844],[375,812],[390,844],[1366,900]];
  for (const [width,height] of widths) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await navigate('/index.html');
    await wait(matches('#go'));
    await click('#go');
    await wait(matches('#intake'));
    check(width+'×'+height+' 首页进入可编辑的分析表单，四栏导航且无横向溢出',
      await js('document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelectorAll("nav a").length===4'));
    await screenshot('v32-input-'+width);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await setField('[name=age]','68','input');
  await setField('[name=region]','佛山市','change');
  const original = '妈妈68岁，住在佛山。家里收入偏低，她最近一直住院，医疗开销压力很大，住院自费3万元。';
  await setField('[name=description]',original,'input');
  await navigate('/analysis.html?member='+seed.other);
  await wait(matches('#intake'));
  check('T15 切换成员后不会带出甲的原文', await js('document.querySelector("[name=description]").value === ""'));
  await navigate('/analysis.html?member='+seed.member);
  await wait(matches('#intake'));
  check('T15 回到甲恢复独立草稿', await js('document.querySelector("[name=description]").value === '+JSON.stringify(original)));
  await click('#intake button');
  await wait('location.search.includes("id=")');
  const analysisUrl = await url();
  report.analysisUrl = analysisUrl;
  await send('Page.reload');
  await wait(matches('#confirm') + ' || ' + matches('#fallback'));
  const genuine = await js(matches('#confirm'));
  report.liveIntake = genuine;
  if (genuine) {
    const review = await state();
    check('T13 分析期间刷新后回到同一查询的真实 AI 确认页面',
      review.original_description.description === original && review.intake.extracted_facts.length > 0);
    check('相同年龄不会触发冲突', !review.intake.conflicting_information.length);
    await screenshot('v32-review-390');
    await click('#confirm button');
    await wait(matches('#plan') + ' || ' + matches('#fallback'));
  }
  if (await js(matches('#fallback'))) {
    const unavailable = await state();
    report.liveError = unavailable.error;
    await screenshot('v32-fallback-390');
    await click('#fallback button');
    await wait(matches('#plan'));
  }
  const found = await state();
  report.mode = found.result.mode;
  check('按验收实例运行预期路径', found.result.mode === (suffix === '-offline' ? 'rules' : 'ai'));
  report.candidates = found.result.policy_candidates.map(({id,status,canPlan})=>({id,status,canPlan}));
  check('医疗困难返回佛山候选且保存确认快照', found.result.policy_candidates.length > 0 &&
    found.result.policy_candidates.every(item => item.region === '佛山市') && found.result.confirmed.basic.age === 68);
  for (const [width,height] of widths) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    check(width+'×'+height+' 结果卡片无横向溢出', await js('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
    await screenshot('v32-result-'+width);
  }
  if (found.result.mode === 'ai') {
    check('真实 DeepSeek 综合研判成功', report.liveIntake && !!await js(matches('#chat')));
    await setField('#chat textarea','妈妈现在还需要家人每天帮忙洗澡。为什么推荐第一条政策？','input');
    await click('#chat button');
    await wait(matches('#apply') + ' || ' + mainText('AI 暂时无法回复'));
    const chat = await state();
    report.liveChat = Boolean(chat.messages.length);
    check('T16 真实对话只生成提议，确认事实未变', chat.pending?.length &&
      JSON.stringify(chat.result.confirmed)===JSON.stringify(found.result.confirmed));
    await screenshot('v32-chat-390');
    await click('#apply button');
    await wait(mainText('第 2 版') + ' || ' + matches('#fallback'));
    const changed = await state();
    check('T16 确认后重做研判并保留旧版', changed.result.version === 2 &&
      changed.result.confirmed.facts.length > found.result.confirmed.facts.length);
    await setField('#chat textarea','第一项政策的联系电话是多少？','input');
    await click('#chat button');
    await wait(mainText('第一项政策的联系电话是多少？') + ' || ' + mainText('AI 暂时无法回复'));
    const last = (await state()).messages.at(-1);
    check('办理电话无官方依据时直接说明', last.question.includes('联系电话') &&
      (last.answer.includes('没有足够的官方依据') || last.answer.includes('没有可引用的官方依据')));
  }
  const chosen = (await state()).result.policy_candidates.find(item => item.canPlan && item.policy.materials?.length);
  assert(chosen,'需要一条具备正式依据和材料的候选');
  const option = '#plan input[value="'+chosen.id+'"]';
  await js('document.querySelector('+JSON.stringify(option)+').closest("details.panel")?.setAttribute("open","")');
  await click(option);
  await click('#plan > button');
  await wait('location.pathname.endsWith("follow-up.html") && '+mainText('家庭少跑腿计划'));
  report.planUrl = await url();
  const planId = new URL(report.planUrl).searchParams.get('plan');
  const planState = async () => (await api('/api/followup/plans/'+planId+'?memberId='+seed.member)).plans[planId];
  const stageBefore = (await planState()).tasks.find(task => task.policyId === chosen.id).stage;
  await screenshot('v32-plan-390');
  const materialLink = await js('Array.from(document.querySelectorAll("a")).find(link=>link.href.includes("view=prepare"))?.href');
  if (materialLink) {
    await navigate(materialLink);
  } else {
    const values = new URL(report.planUrl).searchParams;
    await navigate('/follow-up.html?'+new URLSearchParams({view:'prepare',plan:values.get('plan'),member:seed.member,pid:chosen.id}));
  }
  await wait(matches('.fu-material'));
  await click('.fu-material-item summary');
  await setField('.fu-material textarea','V3.2 Edge 合成材料备注','input');
  await click('.fu-material button');
  await wait('document.querySelector(".fu-inline-feedback")?.innerText.includes("已保存")');
  report.materialUrl = await url();
  await send('Page.reload');
  await wait('document.querySelector(".fu-material textarea")?.value === "V3.2 Edge 合成材料备注"');
  const after = (await planState()).tasks.find(task => task.policyId === chosen.id);
  check('材料保存不覆盖办理状态并保留来源版本和推荐理由',
    after.stage === stageBefore && !!after.analysisRecommendation?.reason && !!after.analysisRecommendation?.version);
  check('T20 从候选进入真实少跑腿计划，材料备注保存后刷新回读',true);
  await screenshot('v32-material-390');
  await navigate('/analysis.html?member='+seed.member);
  const historyHref = new URL(analysisUrl).pathname+new URL(analysisUrl).search;
  await wait(matches('#history a[href*="'+new URL(analysisUrl).searchParams.get('id')+'"]'));
  await click('#history a[href*="'+new URL(analysisUrl).searchParams.get('id')+'"]');
  await wait(matches('#plan'));
  check('T19 历史恢复相同查询和计划入口', (await state()).original_description.description === original &&
    await js("document.querySelector('a[href*=\"view=plan\"]') !== null"));
  check('Edge 无前端运行异常', report.exceptions.length===0);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  if (socket) socket.close();
  browser.kill();
  writeFileSync(join(evidence,'edge-v32'+suffix+'.json'),JSON.stringify(report,null,2)+'\n');
}
