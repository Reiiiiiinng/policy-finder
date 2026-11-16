import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const evidence = resolve('evidence');
const suffix = process.env.PF_V32_TEST_SUFFIX || '';
const seed = JSON.parse(readFileSync(process.env.PF_V32_TEST_SEED || join(evidence, 'special.stdout.log'), 'utf8').trim());
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(resolve('data/private-migration/edge-special-'));
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
  assert.equal(seed.origin,'http://127.0.0.1:8136');
  assert.equal(resolve(seed.database),resolve('data/private-migration/v32-special/acceptance.db'));
  const size = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  const fits = () => js('document.documentElement.scrollWidth<=document.documentElement.clientWidth');
  const old = JSON.parse(readFileSync(join(evidence,'edge-two-issues.json'),'utf8'));
  const saved = new URL(old.selectedUrl);
  const selected = saved.pathname + saved.search;
  if(process.argv.includes('--readback')){
    const existing = JSON.parse(readFileSync(join(evidence,'edge-special.json'),'utf8'));
    await navigate(existing.guideUrl);
    await wait(mainText('我的权益与办理指引'));
    check('T08 重启后真实 Edge 回读办理指引',await js(mainText('佛山市医疗救助实施办法')));
    await navigate(selected);
    await wait(matches('#rights-next')+' || '+matches('#selected-review'));
    check('T19 旧查询原有核对可恢复',true);
  } else {
    await size(320,844);
    await navigate(selected);
    await wait(matches('#rights-next')+' || '+matches('#selected-review'));
    const edit = 'a[href*="view=selected-edit"]';
    if(await js(matches('#rights-next'))) await click(edit);
    await wait(matches('#selected-review'));
    await setField('[name=answer-insurance]','false','change');
    await click('#selected-review button');
    await wait(matches('#rights-next'));
    check('T01 T02 T06 明确不满足、待核实及已保存',await js(mainText('条件不满足')+' && '+mainText('仍待核实')));
    await click(edit);
    await wait(matches('#selected-review'));
    await setField('[name=answer-insurance]','','change');
    await click('#selected-review button');
    await wait(matches('#rights-next'));
    report.summaryUrl = await url();
    check('T05 不清楚仍可完成且摘要可见',await js(mainText('不清楚')+' && '+mainText('本次条件核对已保存')) && await fits());
    await screenshot('special-summary-320');
    await click('#rights-next');
    await wait(mainText('我的权益与办理指引'));
    report.guideUrl = await url();
    check('T03 T04 真实指引有渠道、材料和官方链接',await js(mainText('办理渠道与步骤')+' && '+mainText('材料准备')+' && '+matches('a[href^="https://"]')));
    for(const [w,h] of [[375,812],[390,844],[1366,900]]) {
      await size(w,h);
      check(w+'×'+h+' 指引无横向溢出',await fits());
      await screenshot('special-guide-'+w);
    }
    await send('Page.reload');
    await wait(mainText('我的权益与办理指引'));
    check('T08 刷新恢复指引',true);
    const other = new URL(report.guideUrl);
    other.searchParams.set('member',seed.other);
    await navigate(other.href);
    await wait(mainText('未找到该成员的分析'));
    check('T09 核对与指引受成员隔离',true);
    for(const [option,age] of [['form:68',68],['description:65',65],['custom',55]]){
      await size(390,844);
      await navigate('/analysis.html?demo=age');
      await wait(matches('#intake'));
      await click('#intake button');
      await wait(matches('#resolve'));
      const selector = '[name=ageChoice][value="'+option+'"]';
      check('T11 两个来源与自定义选项都可见',await js(mainText('发现年龄信息不一致')+' && '+matches(selector)+' && '+matches('#custom-age[hidden]')));
      if(option==='custom') await screenshot('special-conflict-390');
      await click(selector);
      if(option==='custom'){
        for(const invalid of ['','-1','5.5','abc','121']){
          await setField('[name=age]',invalid,'input');
          await click('#resolve button');
          check('T15 拒绝无效年龄 '+(invalid || '空值'),await js(matches('#resolve')));
        }
        await setField('[name=age]','55','input');
      }
      await click('#resolve button');
      await wait(matches('#recommendations')+' || '+matches('#fallback'));
      const record = await state();
      check('T12–T17 真实 AI 使用 '+age+' 岁，原始资料仍在',
        record.result?.mode==='ai' && record.result.confirmed.basic.age===age &&
        record.basic.age===68 && record.original_description.description.includes('65岁'));
      if(option==='custom'){
        report.ageUrl=await url();
        await send('Page.reload');
        await wait(matches('#recommendations'));
        await setField('#chat textarea','本次查询确认使用的年龄是多少？','input');
        await click('#chat button');
        await wait(matches('#chat-log article'));
        const after=await state();
        check('T16 T17 追问读取 55 岁且同一冲突未复现',
          after.result.confirmed.basic.age===55 && after.messages.at(-1).answer.includes('55'));
      }
    }
  }
  check('无前端运行异常',report.exceptions.length===0);
} catch(error){
  report.failure=String(error.stack || error);
  throw error;
} finally {
  if(socket) socket.close();
  browser.kill();
  const name=process.argv.includes('--readback')?'edge-special-readback.json':'edge-special.json';
  writeFileSync(join(evidence,name),JSON.stringify(report,null,2)+'\n');
}
