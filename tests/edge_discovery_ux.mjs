import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const evidence = resolve('evidence');
const seed = JSON.parse(readFileSync(process.env.PF_V32_TEST_SEED || join(evidence, 'ux-20261113-test.stdout.log'), 'utf8').trim());
const edge = [
  process.env.PF_EDGE_EXECUTABLE,
  ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map(directory => join(directory, 'Microsoft/Edge/Application/msedge.exe')),
].filter(Boolean).find(existsSync);
assert(edge, 'Microsoft Edge is required');
const profile = mkdtempSync(resolve('data/private-migration/edge-discovery-ux-'));
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
    writeFileSync(join(evidence, 'ux-20261113-'+name+'.png'), Buffer.from(shot.data, 'base64'));
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
  assert.equal(seed.origin, 'http://127.0.0.1:8139');
  assert.equal(resolve(seed.database), resolve('data/private-migration/v32-ux-20261113-test/acceptance.db'));
  await send('Network.setCacheDisabled', {cacheDisabled:true});
  const dimensions = [[320,844],[375,812],[390,844],[1366,900]];
  const size = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  const captures = async name => {
    for (const [width,height] of dimensions) {
      await size(width,height);
      await sleep(130);
      check(name+' '+width+'×'+height+' 无横向溢出', await js('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
      await screenshot(name+'-'+width);
    }
    await size(390,844);
  };
  const baseline = process.argv.includes('--before');
  await size(390,844);
  await navigate('/find.html');
  await wait(matches('#startDiscovery'));
  await captures(baseline ? 'before-find' : 'after-find');
  await click('#startDiscovery');
  if (baseline) await wait('document.querySelector("#chooseMember select")?.options.length > 1');
  else {
    await wait(matches('#chooseMember input'));
    check('T02 独立选人步骤，初次未选择时不能继续', await js('document.querySelector("#discoveryLanding").hidden && document.querySelector("#chooseMember button").disabled'));
    check('T02 选人页标题获得焦点', await js('document.activeElement === document.querySelector("#chooseMember h1")'));
    await click('#chooseMember input[value="'+seed.member+'"]');
  }
  await captures(baseline ? 'before-member' : 'after-member');
  if (!baseline) {
    await click('#chooseMember button');
    await wait(matches('#intake'));
    check('T03 正确成员进入描述，无重复选择', await js(mainText('验收甲')+' && !document.querySelector("#member")'));
    await setField('#intake textarea[name=description]', '仅用于测试返回后的合成草稿。','input');
    await click('#flow-back');
    await wait(matches('#chooseMember input:checked'));
    await click('.entry-back');
    await wait('!document.querySelector("#discoveryLanding")?.hidden');
    await click('#startDiscovery');
    await wait(matches('#chooseMember input:checked'));
    check('T04 返回发现后保留选人', await js('document.querySelector("#chooseMember input:checked").value') === seed.member);
    await click('#chooseMember button');
    await wait(matches('#intake'));
    check('T04 返回描述后保留草稿', await js('document.querySelector("#intake textarea").value.includes("合成草稿")'));
    await navigate('/find.html');
    await wait(matches('.entry-links'));
    await click('.entry-links a:first-child');
    await wait(matches('#history[open]'));
    await navigate('/find.html');
    await wait(matches('.entry-links'));
    await click('.entry-links a:last-child');
    await wait('location.pathname.endsWith("/discovery-c.html") && document.readyState === "complete"');
    check('T05 两个次级入口均可打开',true);
  }
  await navigate('/analysis.html?demo=medical');
  await wait(matches('#intake'));
  await click('#intake button');
  await wait(matches('#recommendations')+' || '+matches('#fallback'));
  const found = await state();
  assert.equal(found.result?.mode, 'ai', found.error || '预期真实 AI 推荐');
  report.resultUrl = await url();
  const item = found.result.policy_candidates.find(row => row.id === 'fs_med_002') || found.result.policy_candidates[0];
  assert(item, '医疗案例必须存在政策');
  const favorite = '[data-policy="'+item.id+'"] [data-favorite]';
  await wait('!!document.querySelector('+JSON.stringify(favorite+':not(:disabled)')+')');
  if (!baseline) {
    await wait('!Array.from(document.querySelectorAll("[data-favorite]")).some(button => button.disabled)');
    while (await js(matches('[data-favorite][aria-pressed=true]'))) {
      await click('[data-favorite][aria-pressed=true]');
      await wait('!document.querySelector("[data-favorite]:disabled")');
    }
    check('T12 无选择仍显示操作区，下一步禁用并说明原因', await js('document.querySelector("#selected-next").disabled && !document.querySelector("#selection-hint").hidden'));
  }
  if (await js('document.querySelector('+JSON.stringify(favorite)+').getAttribute("aria-pressed") !== "true"')) await click(favorite);
  await wait('document.querySelector("#selected-next")?.disabled === false');
  const inspect = () => js(`(() => {
    const bar = document.querySelector('.selection-bar'), next = document.querySelector('#selected-next');
    const nav = document.querySelector('nav'), chat = document.querySelector('#conversation');
    const position = element => {
      const {top,bottom,left,width,height} = element.getBoundingClientRect();
      return {top,bottom,left,width,height,position:getComputedStyle(element).position,
        visibility:getComputedStyle(element).visibility,zIndex:getComputedStyle(element).zIndex};
    };
    const {x,y,width,height} = next.getBoundingClientRect();
    return {bar:position(bar),nav:position(nav),next:position(next),disabled:next.disabled,
      hit:next.contains(document.elementFromPoint(x+width/2,y+height/2)),
      active:document.activeElement.outerHTML.slice(0,120), count:document.querySelector('#selected-count').textContent,
      opened:chat.open, bodyOverflow:getComputedStyle(document.body).overflow,
      appOverflow:getComputedStyle(document.querySelector('#app')).overflow,
      viewport:visualViewport.height,pageHeight:document.documentElement.scrollHeight,
      scrollHeight:document.querySelector('.result-scroll')?.scrollHeight};
  })()`);
  report.closed = await inspect();
  await captures(baseline ? 'before-result' : 'after-result');
  await click('[data-action=open-chat]');
  await wait(matches('#conversation[open]'));
  report.open = await inspect();
  await captures(baseline ? 'before-chat' : 'after-chat');
  if (baseline) {
    check('原版展开时按钮仍在 DOM，但焦点进入后 visibility:hidden', report.closed.hit && report.open.bar.visibility === 'hidden' && !report.open.hit && !report.open.disabled);
    await js('document.activeElement.blur()');
    report.blurred = await inspect();
    check('原版展开状态下失焦后恢复可点击', report.blurred.opened && report.blurred.hit);
  } else {
    check('T13/T18/T19 展开后下一步可点，选中数量一致', report.open.hit && !report.open.disabled && report.open.count === '已选 1 项');
    await click('[data-action=open-chat]');
    await wait('!document.querySelector("#conversation")?.open');
    await click('[data-action=open-chat]');
    await wait(matches('#conversation[open]'));
    check('T06 追问展开与收起', (await inspect()).hit);
    for (const type of ['rawKeyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    check('T06 展开后可用 Tab 从摘要进入建议问题',await js('document.activeElement.hasAttribute("data-question")'));
    await click('[data-question]');
    check('T08 建议问题实际填入并能发送', await js('document.querySelector("#chat textarea").value === document.querySelector("[data-question]").textContent && !document.querySelector("#chat button").disabled'));
    await setField('#chat textarea','本次查询确认使用的年龄是多少？','input');
    await click('#chat textarea');
    report.typing = await inspect();
    check('T14 输入聚焦时下一步可点击', report.typing.hit && !report.typing.disabled);
    report.keyboardSimulation = [];
    for (const [width,height] of dimensions.slice(0,3)) {
      await size(width,height-340);
      await js('document.querySelector("#chat textarea").scrollIntoView({block:"center"})');
      const geometry = await inspect();
      const composer = await js('document.querySelector("#chat").getBoundingClientRect().bottom');
      report.keyboardSimulation.push({width,geometry,composer});
      check('T17 模拟键盘压缩 '+width+' 时输入及下一步可见',geometry.hit && composer <= geometry.bar.top + 1 && geometry.bar.bottom <= geometry.nav.top + 1);
    }
    await screenshot('after-keyboard-simulation-390');
    await size(390,844);
    await send('Network.setBlockedURLs',{urls:['*://127.0.0.1:8139/api/followup/v32/chat']});
    await click('#chat button');
    await wait('document.querySelector("#chat-status")?.textContent.includes("已保留") && !document.querySelector("#chat button").disabled');
    check('T10 发送失败保留原问题，可重试', await js('document.querySelector("#chat textarea").value.includes("年龄是多少")') && (await inspect()).hit);
    await screenshot('after-retry-390');
    await send('Network.setBlockedURLs',{urls:[]});
    await click('#chat button');
    await wait('document.querySelector("#chat-status")?.textContent.includes("正在回答") || !!document.querySelector("#chat-log article")');
    report.sending = await inspect();
    check('T07/T12 发送时禁用重复提交，下一步仍可点',report.sending.hit && !report.sending.disabled && await js('document.querySelector("#chat button").disabled'));
    await wait(matches('#chat-log article'));
    check('T09/T15 真实追问返回已确认年龄，选择操作仍可点', (await state()).messages.at(-1).answer.includes('68') && (await inspect()).hit);
    await setField('#chat textarea','根据刚才的回答，哪些条件还需要确认？','input');
    await click('#chat button');
    await wait('document.querySelectorAll("#chat-log article").length === 2 || document.querySelector("#chat-status")?.textContent.includes("已保留")');
    const afterChat = await state();
    check('T11/T16 第二轮保存到同成员同查询同版本，选择未丢失', afterChat.id === found.id && afterChat.result.version === found.result.version && afterChat.messages.length === 2 && (await inspect()).count === '已选 1 项');
    await js(`(() => {
      const last = [...document.querySelectorAll('#recommendations details')].find(node => node.querySelector('summary')?.textContent.startsWith('其他相关政策'));
      if (last) last.open = true;
      Array.from(document.querySelectorAll('#recommendations .policy-card')).at(-1)?.scrollIntoView({block:'end'});
    })()`);
    check('T16 最后一张政策卡片可滚动到操作栏上方', await js('Array.from(document.querySelectorAll("#recommendations .policy-card")).at(-1).getBoundingClientRect().bottom <= document.querySelector(".selection-bar").getBoundingClientRect().top + 1'));
    await js('document.querySelector("#chat").scrollIntoView({block:"end"})');
    await captures('after-multiturn');
    const policy = '[data-policy="'+item.id+'"]';
    await click(policy + ' a[href^="policy.html"]');
    await wait(matches('.detail-actions'));
    check('T22 可从推荐进入同项政策详情及依据', await js(mainText(item.name)+' && '+mainText('查看政策依据')));
    await click('.detail-actions .primary');
    await wait('document.querySelector("#selected-next")?.disabled === false');
    await click('[data-action=open-chat]');
    await wait(matches('#conversation[open]'));
    await setField('#chat textarea','还需要去哪里核实这项政策？','input');
    await click('#chat button');
    await wait('document.querySelector("#chat-status")?.textContent.includes("正在回答")');
    await click('#selected-next');
    await wait(matches('#selected-review')+' || '+matches('#reviewed-plan'));
    check('T20 发送期间点击下一步，真实进入同查询集中核对', new URL(await url()).searchParams.get('view') === 'selected');
    await screenshot('after-selected-review-390');
    if(await js(matches('#reviewed-plan'))) await click('a[href*="view=selected-edit"]');
    await wait(matches('#selected-review'));
    await click('#selected-review button');
    await wait(matches('#reviewed-plan'));
    await click('#rights-next');
    await wait(mainText('家庭少跑腿计划'));
    check('T26 集中核对保存后能打开现有计划', new URL(await url()).searchParams.get('member') === seed.member);
    await screenshot('after-plan-390');
    const crossed = new URL(report.resultUrl);
    crossed.searchParams.set('member',seed.other);
    await navigate(crossed.href);
    await wait(mainText('未找到该成员的分析'));
    check('T24 跨成员无法读取原查询',true);
    await navigate('/analysis.html?view=history&member='+seed.member);
    await wait(matches('#history a[href*="'+found.id+'"]'));
    await js('document.querySelector("#history").open = true');
    await click('#history a[href*="'+found.id+'"]');
    await wait('document.querySelector("#selected-next")?.disabled === false');
    check('T25 历史恢复同一查询及已选', (await state()).id === found.id);
    await navigate('/analysis.html?demo=age');
    await wait(matches('#intake'));
    await click('#intake button');
    await wait(matches('#resolve'));
    await click('[name=ageChoice][value=custom]');
    await setField('#custom-age input','55','input');
    await click('#resolve button');
    await wait(matches('#recommendations'));
    check('T21 年龄冲突核对后采用用户确认年龄', (await state()).result.confirmed.basic.age === 55);
    await navigate('/analysis.html?demo=meal');
    await wait(matches('#intake'));
    await click('#intake button');
    await wait(matches('#recommendations'));
    check('T23 无匹配仍可打开政策目录，下一步禁用',await js(mainText('当前目录无相关政策')+' && document.querySelector("#selected-next").disabled'));
    check('浏览器无前端运行异常',report.exceptions.length === 0);
  }
} catch(error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  socket?.close();
  browser.kill();
  const phase = process.argv.includes('--before') ? 'before' : 'after';
  writeFileSync(join(evidence,'ux-20261113-edge-'+phase+'.json'),JSON.stringify(report,null,2)+'\n');
}
