import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const evidence = resolve('evidence');
const seed = JSON.parse(readFileSync(process.env.PF_V32_TEST_SEED || join(evidence, 'ux0506-test.stdout.log'), 'utf8').trim());
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(resolve('data/private-migration/edge-ux0506-'));
const browser = spawn(edge, [...(process.env.PF_EDGE_VISIBLE ? [] : ['--headless=new']), '--disable-gpu', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'], {windowsHide:true, stdio:'ignore'});
const report = {origin:seed.origin, visibleWindow:Boolean(process.env.PF_EDGE_VISIBLE), checks:[], responses:[], exceptions:[]};
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
    writeFileSync(join(evidence, 'ux0506-'+name+'.png'), Buffer.from(shot.data, 'base64'));
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
  const failure = process.argv.includes('--failure');
  assert.equal(seed.origin,'http://127.0.0.1:'+(failure ? 8143 : 8141));
  assert.equal(resolve(seed.database),resolve('data/private-migration/v32-ux0506-'+(failure ? 'failure' : 'test')+'/acceptance.db'));
  const before = process.argv.includes('--before');
  const phase = before ? 'before' : 'after';
  const medical = 'gz_elderly_009';
  const size = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  const dimensions = [[320,844],[375,812],[390,844],[1366,900]];
  const viewport = async label => {
    for (const [width,height] of dimensions) {
      await size(width,height);
      await sleep(100);
      check(label+' '+width+'×'+height+' 无横向溢出',await js('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
      await screenshot(phase+'-'+label+'-'+width);
    }
    await size(390,844);
  };
  const key = name => `document.querySelector(${JSON.stringify(name)})`;
  const waitClick = async selector => { await wait(matches(selector)); await click(selector); };
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await size(390,844);
  if (failure) {
    await navigate('/analysis.html?demo=medical');
    await wait(matches('#intake'));
    const description = await js('document.querySelector("[name=description]").value');
    await click('#intake button');
    await wait(matches('#fallback'));
    const initialFailure = await state();
    check('T06 模拟模型超时后保留原始描述', initialFailure.error==='TIMEOUT' && initialFailure.original_description.description===description);
    await click('[data-action=analyze]');
    await until(async () => {
      const current = await state();
      return current.revision > initialFailure.revision && current.stage === 'unavailable' && await js(matches('#fallback'));
    },'重试后再次收到模拟超时');
    check('T06 可以再次请求 AI 并回到降级选择', (await state()).error==='TIMEOUT');
    await screenshot('failure-390');
    await click('#fallback button');
    await wait(matches('#recommendations'));
    const fallback = await state();
    check('T06 基础规则出结果且原输入不变',fallback.result.mode==='rules' && fallback.original_description.description===description);
    await screenshot('failure-rules-390');
  } else {
  await navigate('/analysis.html?member='+seed.member);
  await wait(matches('#intake'));
  await setField('[name=age]','68','input');
  await setField('[name=region]','广州市','change');
  await setField('[name=description]','合成案例：妈妈68岁，居住在广州市，长期卧床，需要居家护理，想了解长期护理保险，尚未做过正式失能评估。','input');
  await click('#intake button');
  await wait(matches('.analysis-progress'));
  if (!before) {
    const stage = await state();
    const display = await js('[...document.querySelectorAll(".analysis-steps [data-phase]")].map(li=>[li.dataset.phase,li.querySelector("small").textContent])');
    check('T04 真正的运行阶段与阶段状态一致', ['understand','needs','retrieve','verify','judge'].includes(stage.stage) &&
      display.length === 4 && display.filter(([phase])=>phase==='current').length === 1 &&
      display.every(([phase,label])=>label===({done:'已完成',current:'进行中',waiting:'未开始'})[phase]));
  }
  await viewport('analysis');
  await wait(matches('#recommendations')+' || '+matches('#fallback'));
  const result = await state();
  assert.equal(result.result?.mode,'ai',result.error || '预期真实 AI 推荐');
  assert(result.result.policy_candidates.some(item => item.id === medical),'长护险须在真实推荐中');
  report.resultUrl = await url();
  const favorite = '[data-favorite="'+medical+'"]';
  await wait(matches(favorite+':not(:disabled)'));
  if (await js(key(favorite)+'.getAttribute("aria-pressed")!=="true"')) await click(favorite);
  await wait(matches('#selected-next:not(:disabled)'));
  if (!before) {
    await click('[data-action=open-chat]');
    check('T20 AI 追问和下一步同时可用', await js('document.querySelector("#conversation").open && !document.querySelector("#selected-next").disabled'));
  }
  await click('#selected-next');
  await wait(matches('#selected-review'));
  report.selectedUrl = await url();
  await viewport('selected');
  if (!before) {
    const insurance = '[name=answer-insurance][value=true]';
    const insuranceSummary = '.selected-condition:has([name=answer-insurance]) summary';
    await click(insuranceSummary);
    await click(insurance);
    await click(insuranceSummary);
    await click(insuranceSummary);
    check('T07/T18 展开收起保留客观事实草稿',await js(key(insurance)+'.checked'));
    await click(insuranceSummary);
  }
  await click('#selected-review button');
  await waitClick('#rights-next');
  await wait(mainText('家庭少跑腿计划'));
  report.planUrl = await url();
  const plan = new URL(report.planUrl).searchParams.get('plan');
  const data = await api('/api/followup/plans/'+plan+'?memberId='+seed.member);
  report.baselineRows = data.plans[plan].tasks.find(task=>task.policyId===medical).conditionChecks;
  const conditions = '/follow-up.html?'+new URLSearchParams({view:'conditions',plan,member:seed.member,pid:medical});
  await navigate(conditions);
  await wait(mainText('条件核对'));
  await viewport('conditions');
  if (before) {
    check('同一目录中，other 可编辑而 missing_information 不可编辑',
      report.baselineRows.some(row=>row.id==='other:2' && row.editable) &&
      report.baselineRows.some(row=>row.id==='missing_information:0' && !row.editable) &&
      report.baselineRows.some(row=>row.id==='missing_information:1' && !row.editable));
    // A legacy personal result is written only to the isolated test database.
    await setField('[data-condition="other:2"] select','met','change');
    await click('[data-condition="other:2"] button');
    await wait('document.querySelector("#followupStatus")?.textContent.includes("这项核对已保存")');
    writeFileSync(join(evidence,'ux0506-legacy-url.json'),JSON.stringify({conditions,selected:report.selectedUrl}));
  } else {
    const legacy = JSON.parse(readFileSync(join(evidence,'ux0506-legacy-url.json'),'utf8'));
    await navigate(legacy.conditions);
    await wait(matches('.fu-condition-item'));
    const summary = id => '[id="check-'+id+'"] summary';
    const form = id => '[data-condition="'+id+'"]';
    await click(summary('other:2'));
    check('T08/T16/T17 旧计划能回读，评估需官方核实，界面无资格下拉框', await js('('+mainText('已有旧版个人记录')+' || '+mainText('合成测试评估机构')+') && '+mainText('需要官方核实')+' && !'+key(form('other:2')+' select[name=answer]')));
    await setField(form('other:2')+' select','received','change');
    await setField(form('other:2')+' [name=reportedResult]','合成评估结果','input');
    await setField(form('other:2')+' [name=reportedSource]','合成测试评估机构','input');
    await click(summary('other:2'));
    await click(summary('other:2'));
    check('T18 关闭再展开保留评估草稿',await js(key(form('other:2')+' [name=reportedResult]')+'.value==="合成评估结果"'));
    await click(form('other:2')+' button');
    await wait(mainText('合成测试评估机构'));
    check('T13 正式结果和来源保存后立即读回',await js(mainText('需要官方核实')));
    await send('Page.reload');
    await waitClick(summary('other:2'));
    check('T14 刷新后读取正式结果与来源',await js(mainText('合成测试评估机构')));
    await click(summary('missing_information:0'));
    await click('[id="check-missing_information:0"] [data-related-condition]');
    check('T07/T11 重复参保提示转到同一事实，焦点跟随',await js('document.activeElement === '+key(summary('insurance_required'))));
    await setField(form('insurance_required')+' select','unknown','change');
    await click(form('insurance_required')+' button');
    await wait(mainText('已记录不清楚'));
    check('T10 可以保存不清楚，状态明确',await js(mainText('已记录不清楚')));
    await click(summary('missing_information:1'));
    await setField(form('missing_information:1')+' select','six_months','change');
    await click(form('missing_information:1')+' button');
    await wait(mainText('已记录：已持续 6 个月或以上'));
    await screenshot('after-conditions-open-390');
    const legacyPlan = new URL(legacy.conditions,seed.origin).searchParams.get('plan');
    const saved = await api('/api/followup/plans/'+legacyPlan+'?memberId='+seed.member);
    const checks = saved.plans[legacyPlan].tasks.find(task=>task.policyId===medical).conditionChecks;
    check('T17 已报告评估和观察时长仍为未知资格',checks.filter(row=>['other:2','missing_information:1'].includes(row.id)).every(row=>row.state==='pending' && row.answer==='unknown' && row.reported));
    const crossed = new URL(legacy.conditions,seed.origin);
    crossed.searchParams.set('member',seed.other);
    await navigate(crossed.href);
    await wait('document.readyState==="complete" && !!document.querySelector("#followupView")?.innerText.trim() && !document.querySelector(".fu-condition-item")');
    check('T15 跨成员无法读取该核对清单',(await fetch(seed.origin+'/api/followup/plans/'+legacyPlan+'?memberId='+seed.other)).status===404);
    await navigate(legacy.selected);
    await wait(matches('#reviewed-plan'));
    check('T16/T19 旧集中核对回执正常打开完成页',await js(mainText('为你整理好了')));
    await navigate('/analysis.html?demo=medical');
    await wait(matches('#intake'));
    await click('#intake button');
    await wait(matches('#recommendations'));
    await wait(matches('[data-favorite]:not(:disabled)'));
    const medicalFavorite = '[data-favorite="fs_med_002"]';
    await wait(matches(medicalFavorite+':not(:disabled)'));
    if(await js(key(medicalFavorite)+'.getAttribute("aria-pressed")!=="true"')) await click(medicalFavorite);
    await waitClick('#selected-next:not(:disabled)');
    await wait(matches('#selected-review'));
    check('T09 已明确参保事实不重复询问',await js('!'+key('[name=answer-insurance]')));
  }
  }
  check('Edge 无脚本异常',report.exceptions.length===0);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  socket?.close();
  browser.kill();
  const phase = process.argv.includes('--before') ? 'before' : process.argv.includes('--failure') ? 'failure' : 'after';
  writeFileSync(join(evidence,'ux0506-edge-'+phase+'.json'),JSON.stringify(report,null,2)+'\n');
}
