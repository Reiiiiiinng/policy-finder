import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const evidence = resolve('evidence');
const seed = JSON.parse(readFileSync(join(evidence, 'preview.stdout.log'), 'utf8').trim());
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(resolve('data/private-migration/edge-p0-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'], {windowsHide:true, stdio:'ignore'});
const report = {origin:seed.origin, checks:[], responses:[], exceptions:[]};
let socket;
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function until(read, label) {
  for (let attempt=0; attempt<120; attempt++) {
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
    writeFileSync(join(evidence, name+'.png'), Buffer.from(shot.data, 'base64'));
  };
  const checkBasic = (age, city, desc) => js(`(() => {
    const field = id => document.querySelector('#'+id)?.value;
    return field('qAge')===${JSON.stringify(age)} && field('qCity')===${JSON.stringify(city)}
      && field('qAIDescription')===${JSON.stringify(desc)};
  })()`);

  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate', {url:seed.origin+'/family.html'});
  await wait('document.querySelector("#qMember")?.options.length === 3');
  const postMatch = payload => js(`fetch('/api/match',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(${JSON.stringify(payload)})}).then(response=>response.json())`);
  const unknown = await postMatch({text:'68岁，做饭困难'});
  check('实际匹配 API 在地区缺失时返回零条城市候选', unknown.profile.region === null && unknown.total === 0);
  await setField('#qOperator','女儿','change');
  await setField('#qMember',seed.member,'change');
  await click('#qNext');
  await wait('document.querySelector("#qCity")?.options.length === 3');
  await setField('#qAge','68','input');
  await setField('#qCity','佛山市','change');
  await setField('#qAIDescription','母亲58岁，住院自费3万元。','input');
  await click('#qNext');
  await wait('!!document.querySelector("#qEdit")');
  await click('#qNext');
  await wait('document.querySelector("#qError")?.textContent.includes("不一致")');
  check('年龄冲突返回编辑页、同时提示两个年龄并保留原文', await checkBasic('68','佛山市','母亲58岁，住院自费3万元。')
    && await js('["68","58"].every(age=>document.querySelector("#qError").textContent.includes(age))'));
  await screenshot('edge-age-conflict');
  const firstDescription = '母亲68岁，住院自费3万元。';
  await setField('#qAIDescription',firstDescription,'input');
  await click('#qPrev');
  await wait('!!document.querySelector("#qMember")');
  await setField('#qMember',seed.other,'change');
  await click('#qNext');
  await wait('!!document.querySelector("#qAge")');
  check('同称谓成员切换后年龄、城市和原文全部为空', await checkBasic('','',''));
  await screenshot('edge-member-switch');
  await setField('#qAge','35','input');
  await setField('#qCity','佛山市','change');
  const secondDescription = '需要住房救助。';
  await setField('#qAIDescription',secondDescription,'input');
  await click('#qPrev');
  await setField('#qMember',seed.member,'change');
  await click('#qNext');
  check('切回原成员只恢复该成员草稿', await checkBasic('68','佛山市',firstDescription));
  await click('#qPrev');
  await setField('#qMember',seed.other,'change');
  await click('#qNext');
  check('再次切换后恢复第二位成员自己的草稿', await checkBasic('35','佛山市',secondDescription));
  await click('#qNext');
  await wait('!!document.querySelector("#qEdit")');
  await click('#qNext');
  await wait('!!document.querySelector("[data-empty-state=rule-zero]")');
  const resultUrl = await js('location.href');
  report.emptyResult = resultUrl;
  check('空结果绑定到第二位成员', new URL(resultUrl).searchParams.get('member') === seed.other);
  check('空结果三条出口均可见，页面无横向溢出', await js(`(() => {
    const section = document.querySelector('[data-empty-state=rule-zero]');
    const links = [...section.querySelectorAll('.rp-empty-actions a')];
    return document.documentElement.scrollWidth <= innerWidth && links.length === 3 &&
      links.every(link=>link.getClientRects().length && link.href.startsWith(location.origin));
  })()`));
  await js('document.querySelector("[data-empty-state=rule-zero]").scrollIntoView({block:"center",behavior:"instant"})');
  await screenshot('edge-empty-result');
  await click('[data-describe-query]');
  await wait('document.activeElement?.id === "qAIDescription"');
  check('补充出口打开同一成员与查询版本并定位描述', await checkBasic('35','佛山市',secondDescription)
    && await js(`new URLSearchParams(location.search).get("member") === ${JSON.stringify(seed.other)}`));
  await screenshot('edge-empty-edit');
  await send('Page.navigate',{url:resultUrl});
  await wait('!!document.querySelector("[data-empty-state=rule-zero] [data-edit-query]")');
  await click('[data-empty-state=rule-zero] [data-edit-query]');
  await wait('!!document.querySelector("#qAge") && document.querySelector("#qAge").value === "35"');
  check('修改条件出口恢复相同成员、城市和原文', await checkBasic('35','佛山市',secondDescription));
  await send('Page.navigate',{url:resultUrl});
  await wait('!!document.querySelector("[data-empty-state=rule-zero] a[href*=discovery-c]")');
  await click('[data-empty-state=rule-zero] a[href*=discovery-c]');
  await wait('location.pathname.endsWith("/discovery-c.html") && !!document.querySelector("#list")');
  check('浏览目录出口打开真实政策目录', true);
  check('无前端运行时异常', report.exceptions.length === 0);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  if (socket) socket.close();
  browser.kill();
  writeFileSync(join(evidence, 'edge-acceptance.json'), JSON.stringify(report,null,2)+'\n');
}
