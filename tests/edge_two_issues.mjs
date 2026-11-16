import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const evidence = resolve('evidence');
const suffix = process.env.PF_V32_TEST_SUFFIX || '';
const seed = JSON.parse(readFileSync(process.env.PF_V32_TEST_SEED || join(evidence, 'two-issues.stdout.log'), 'utf8').trim());
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(resolve('data/private-migration/edge-two-issues-'));
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
  assert.equal(seed.origin,'http://127.0.0.1:8135');
  assert.equal(resolve(seed.database),resolve('data/private-migration/v32-two-issues/acceptance.db'));
  const noOverflow = 'document.documentElement.scrollWidth<=document.documentElement.clientWidth';
  const resize = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await resize(320,844);
  await navigate('/analysis.html?demo=medical');
  await wait(matches('#intake'));
  await click('#intake button');
  await wait('location.search.includes("id=")');
  report.normalUrl = await url();
  await send('Page.reload');
  await wait(matches('#recommendations')+' || '+matches('#fallback'));
  const normal = await state();
  check('T01 T04 T15 T17 真实 AI 无冲突直接出结果，刷新可恢复',
    normal.result?.mode==='ai' && !normal.suggested_basic.conflicting_information.length &&
    await js('!document.querySelector("#confirm, #resolve")'));
  const policy = '[data-policy="fs_med_001"]';
  const pick = policy+' [data-favorite]';
  const nextButton = '#selected-next';
  await wait(matches(pick+':enabled'));
  await wait('!document.querySelector("[data-favorite]:disabled")');
  const existing = await js('[...document.querySelectorAll("[data-favorite][aria-pressed=true]")].map(b=>b.dataset.favorite)');
  for (const id of existing) {
    const saved = '[data-favorite="'+id+'"]';
    await js('document.querySelector('+JSON.stringify(saved)+').closest("#recommendations > details")?.setAttribute("open","")');
    await click(saved);
    await wait(matches(saved+'[aria-pressed=false]:enabled'));
  }
  check('T09 空选择禁用下一步', await js(matches(nextButton+':disabled')));
  await click(pick);
  await wait(matches(pick+'[aria-pressed=true]:enabled'));
  check('T06 选择后更新计数', await js('document.querySelector("#selected-count").textContent==="已选 1 项"'));
  await send('Page.reload');
  await wait(matches(nextButton+':enabled'));
  await click(pick);
  await wait(matches(pick+'[aria-pressed=false]:enabled'));
  check('T07 取消后恢复空态', await js(matches(nextButton+':disabled')));
  await click(pick);
  await wait(matches(nextButton+':enabled'));
  check('320×844 结果及固定操作区无溢出',await js(noOverflow));
  await screenshot('two-issues-result-320');
  await click(nextButton);
  await wait(matches('#selected-review'));
  report.selectedUrl = await url();
  check('T10 T11 进入真实集中核对，仅显示所选政策的事实问题',
    await js('document.querySelectorAll(".policy-card").length===1 && document.querySelectorAll("#selected-review select").length===3'));
  await resize(375,812);
  check('375×812 核对页无溢出',await js(noOverflow));
  await screenshot('two-issues-review-375');
  await click('#selected-review button');
  await wait(mainText('权益清单与办理提示'));
  check('T12 T13 不清楚可完成，并显示权益清单入口', await js(matches('a[href*="#mineFavorites"]')));
  await send('Page.reload');
  await wait(mainText('权益清单与办理提示'));
  await click('main a[href*="analysis.html"]');
  await wait(matches(nextButton+':enabled'));
  check('T14 返回恢复选择', await js(matches(pick+'[aria-pressed=true]')));
  await resize(390,844);
  await setField('#chat textarea','为什么推荐佛山市医疗救助？','input');
  await click('#chat button');
  await wait(matches('#chat-log article'));
  check('T17 真实 DeepSeek 追问保留答复',!!(await state()).messages[0].answer);
  check('AI 理解详情默认折叠',await js('[...document.querySelectorAll("details")].some(d=>d.querySelector("summary")?.textContent.includes("查看或修改 AI 理解的信息") && !d.open)'));
  await navigate('/analysis.html?demo=age');
  await wait(matches('#intake'));
  await click('#intake button');
  await wait(matches('#resolve'));
  report.conflictUrl=await url();
  check('T02 年龄真实冲突只展示年龄', await js(mainText('发现年龄信息不一致')+' && '+matches('#resolve [name=age]')+' && !'+matches('#resolve [name=region]')));
  await screenshot('two-issues-conflict-390');
  await setField('#resolve [name=age]','65','change');
  await click('#resolve button');
  await wait(matches('#recommendations')+' || '+matches('#fallback'));
  const corrected=await state();
  check('T02 修正后自动继续真实 AI，保留原文',
    corrected.result?.mode==='ai' && corrected.result.confirmed.basic.age===65 && corrected.basic.age===68);
  check('390×844 冲突修正后可操作',await js(noOverflow));
  const wrong = new URL(report.normalUrl);
  wrong.searchParams.set('member',seed.other);
  await navigate(wrong.href);
  await wait(mainText('未找到该成员的分析'));
  check('T16 不同成员无法读取这条查询',true);
  check('无前端运行异常', report.exceptions.length===0);
} catch(error) {
  report.failure=String(error.stack || error);
  throw error;
} finally {
  if(socket) socket.close();
  browser.kill();
  writeFileSync(join(evidence,'edge-two-issues.json'),JSON.stringify(report,null,2)+'\n');
}
