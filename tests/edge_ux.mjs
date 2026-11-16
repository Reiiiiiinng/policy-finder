import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const evidence = resolve('evidence');
const suffix = process.env.PF_V32_TEST_SUFFIX || '';
const seed = JSON.parse(readFileSync(process.env.PF_V32_TEST_SEED || join(evidence, 'preview.stdout.log'), 'utf8').trim());
assert(seed.origin === 'http://127.0.0.1:8134' &&
  resolve(seed.database) === resolve('data/private-migration/v32-ux-demo/acceptance.db'),
  'Write tests require the dedicated UX demo instance');
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(resolve('data/private-migration/edge-ux-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'], {windowsHide:true, stdio:'ignore'});
const report = {origin:seed.origin, checks:[], responses:[], exceptions:[]};
let socket;
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function until(read, label) {
  for (let attempt=0; attempt<520; attempt++) {
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
  const set = (selector,value) => setField(selector,value,'input');
  const policy = '[data-policy="fs_med_001"]';
  const select = policy+' [data-favorite]';
  const has = selector => matches(selector);
  const checked = (label,selector) => wait(has(selector)).then(()=>check(label,true));
  for (const [width,height] of [[320,844],[375,812],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await navigate('/');
    await wait(has('[data-tab=discover]'));
    await click('[data-tab=discover]');
    await wait(has('#startDiscovery'));
    check(width+' 发现页无表单且保留四栏',await js('!document.querySelector("form") && document.querySelectorAll("nav a").length===4'));
    await screenshot('ux-find-'+width);
    await click('#startDiscovery');
    await wait(has('#intake'));
    await set('[name=description]','合成草稿 '+width);
    check(width+' 输入可交互且无横向溢出', await js('document.querySelector("[name=description]").value.endsWith("'+width+'") && document.documentElement.scrollWidth<=document.documentElement.clientWidth'));
    await screenshot('ux-input-'+width);
  }
  await navigate('/analysis.html?member='+seed.other);
  await wait(has('#intake'));
  check('乙成员无甲成员草稿',await js('document.querySelector("[name=description]").value===""'));
  await navigate('/analysis.html?demo=medical');
  await wait(has('#intake'));
  check('成功演示预填且标明合成数据',await js('document.querySelector("[name=description]").value.includes("自费3万元") && !!document.querySelector(".demo-note")'));
  await click('#intake button');
  await wait('location.search.includes("id=")');
  const successUrl = await url();
  await send('Page.reload');
  await wait(has('#confirm')+' || '+has('#fallback'));
  check('真实 DeepSeek 理解并刷新恢复',await js(has('#confirm')));
  await screenshot('ux-confirm-390');
  await click('#review-questions summary');
  await wait(has('[name=answer-insurance]'));
  await set('[name=answer-insurance]','true');
  await click('#confirm button');
  await wait(has('#recommendations')+' || '+has('#fallback'));
  const result = await state();
  const medical = result.result?.policy_candidates.find(row=>row.id==='fs_med_001');
  check('真实 DeepSeek 与规则发现佛山市医疗救助，资格待核实',result.result?.mode==='ai' && medical?.status==='待核实');
  report.medical = {url:successUrl, candidates:result.result.policy_candidates.map(({id,status})=>({id,status})),
    verification:medical.conditions.map(({key,verification,user_provided})=>({key,verification,user_provided}))};
  check('已提供医保事实规则核验，未知经济类别仍待核实',
    medical.conditions.some(row=>row.key==='insurance' && row.user_provided && row.verification==='rule_verified') &&
    medical.conditions.some(row=>row.key==='family_economic' && row.verification==='not_provided'));
  await js('document.querySelector('+JSON.stringify(policy)+').closest("#recommendations > details")?.setAttribute("open","")');
  await click(policy+' summary');
  check('卡片展示统一核验标签和链接', await js('(()=>{const c=document.querySelector('+JSON.stringify(policy)+'); return c.innerText.includes("规则已核验") && c.innerText.includes("尚未提供信息") && c.innerText.includes("官方原文") && c.innerText.includes("查看政策详情")})()'));
  await screenshot('ux-result-390');
  const buttons = await js('[...document.querySelectorAll("[data-favorite]")].map(b=>b.dataset.favorite)');
  check('所有推荐共用权益清单按钮',buttons.length===result.result.policy_candidates.length);
  for(const id of buttons.slice(0,2)){
    const s='[data-favorite="'+id+'"]';
    await js('document.querySelector('+JSON.stringify(s)+').closest("#recommendations > details")?.setAttribute("open","")');
    await wait(has(s+':enabled'));
    await click(s);
    await wait(has(s+'[aria-pressed=true]:enabled'));
    await send('Page.reload');
    await wait(has(s+'[aria-pressed=true]:enabled'));
    await js('document.querySelector('+JSON.stringify(s)+').closest("#recommendations > details")?.setAttribute("open","")');
    await click(s);
    await wait(has(s+'[aria-pressed=false]:enabled'));
  }
  check('推荐卡片加入、刷新持久、取消行为一致',true);
  await set('#chat textarea','为什么推荐佛山市医疗救助？还有什么条件需要核实？');
  await click('#chat button');
  await wait(mainText('为什么推荐佛山市医疗救助？')+' || '+mainText('AI 暂时无法回复'));
  const chat=await state();
  check('真实 DeepSeek 追问有答复及政策依据',chat.messages.length===1 && !!chat.messages[0].answer && chat.messages[0].sources.length>0);
  await screenshot('ux-chat-390');
  await set('#chat textarea','妈妈现在还需要家人每天帮忙洗澡。为什么推荐佛山市医疗救助？');
  await click('#chat button');
  await wait(has('#apply')+' || '+mainText('AI 暂时无法回复'));
  check('补充事实先预览且保持原快照',(await state()).result.version===1 && await js(has('#apply')));
  await click('#apply button');
  await wait(mainText('第 2 版')+' || '+has('#fallback'));
  check('确认补充后真实重新研判', (await state()).result.version===2);
  await screenshot('ux-reanalysis-390');
  await navigate('/analysis.html?view=history&member='+seed.member);
  const id=new URL(successUrl).searchParams.get('id');
  await wait(has('#history a[href*="'+id+'"]'));
  await click('#history a[href*="'+id+'"]');
  await wait(has('#recommendations'));
  check('历史恢复原查询及合成标记',(await state()).id===id && await js(has('.demo-note')));
  await js('document.querySelector('+JSON.stringify(policy)+').closest("#recommendations > details")?.setAttribute("open","")');
  await click(policy+' a[href^="policy.html"]');
  await wait(has('.policy-overview'));
  check('政策详情打开',await js('document.querySelector(".policy-overview").innerText.includes("佛山市医疗救助")'));
  await click('[data-back]');
  await wait(has('#recommendations'));
  check('详情返回原查询',(await state()).id===id);
  await navigate('/analysis.html?demo=meal');
  await wait(has('#intake'));
  await click('#intake button');
  await wait(has('#confirm')+' || '+has('#fallback'));
  check('无匹配样例仍执行真实 AI 理解',await js(has('#confirm')));
  await click('#confirm button');
  await wait(has('#recommendations')+' || '+has('#fallback'));
  const empty=await state();
  check('佛山助餐场景实际无匹配',empty.result?.mode==='ai' && empty.result.policy_candidates.length===0 && await js(mainText('当前目录无相关政策')));
  report.empty={url:await url(), candidates:empty.result.policy_candidates.length};
  await screenshot('ux-empty-390');
  check('无前端运行时异常',report.exceptions.length===0);
} catch (error) {
  report.failure=String(error.stack || error);
  throw error;
} finally {
  if(socket) socket.close();
  browser.kill();
  writeFileSync(join(evidence,'edge-ux.json'),JSON.stringify(report,null,2)+'\n');
}
