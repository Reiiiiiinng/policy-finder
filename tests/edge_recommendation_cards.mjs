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
const profile = mkdtempSync(resolve('data/private-migration/edge-card-ux-'));
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
      const x=box.x+box.width/2,y=box.y+box.height/2;
      const hit=document.elementFromPoint(x,y);
      return {x,y,target:hit?.outerHTML.slice(0,160),hit:element.contains(hit)};
    })()`);
    assert(point.hit,selector+' 点击命中 '+point.target);
    for (const type of ['mousePressed','mouseReleased']) {
      await send('Input.dispatchMouseEvent', {type,x:point.x,y:point.y,button:'left',clickCount:1});
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
    writeFileSync(join(evidence, 'card-ux-'+name+'.png'), Buffer.from(shot.data, 'base64'));
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
  assert.equal(seed.origin,'http://127.0.0.1:8141');
  assert.equal(resolve(seed.database),resolve('data/private-migration/v32-ux0506-test/acceptance.db'));
  const before = process.argv.includes('--before');
  const phase = before ? 'before' : 'after';
  const fixture = join(evidence,'card-ux-fixture.json');
  const size = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await size(390,844);
  if (before) {
    await navigate('/analysis.html?demo=medical');
    await wait(matches('#intake'));
    await setField('[name=description]', '合成案例：妈妈68岁，住在佛山市，参加佛山市基本医疗保险。今年住院后自费3万元，收入偏低，想了解医疗救助、重病医疗费用、困难家庭认定以及慈善救助。没有佛山市户籍。','input');
    await click('#intake button');
    await wait(matches('#recommendations')+' || '+matches('#fallback'));
    assert.equal((await state()).result?.mode,'ai');
    writeFileSync(fixture,JSON.stringify({result:await url()}));
  } else {
    await navigate(JSON.parse(readFileSync(fixture,'utf8')).result);
    await wait(matches('#recommendations'));
  }
  report.resultUrl = await url();
  const result = await state();
  report.policies = result.result.policy_candidates.map(item=>item.id);
  report.excluded = result.result.excluded.map(item=>item.name);
  assert(report.policies.length >= 4,'用例需同时覆盖前三项与其他政策');
  await wait('!document.querySelector("[data-favorite]:disabled")');
  const card = '#recommendations > .policy-card';
  const favorite = card+' [data-favorite]';
  for (const [index,id] of report.policies.entries()) {
    const selector = '[data-favorite="'+id+'"]';
    if (await js(`document.querySelector('${selector}').getAttribute('aria-pressed') !== '${index===0}'`)) {
      if (index>=3) await js('document.querySelector("#recommendations > details").open=true');
      await click(selector);
      await wait(`document.querySelector('${selector}').getAttribute('aria-pressed') === '${index===0}'`);
    }
  }
  await js('document.querySelector("#recommendations > details").open=false');
  for (const [width,height] of [[320,844],[375,812],[390,844],[1366,900]]) {
    await size(width,height);
    await js(`document.querySelector('.result-scroll').scrollTop=0`);
    await screenshot(phase+'-results-'+width);
    await js(`document.querySelector('${card}').scrollIntoView({block:'start'})`);
    await screenshot(phase+'-card-'+width);
    const layout = await js(`(() => {
      const cards=[...document.querySelectorAll('${card}')];
      const shape=node=>{ const style=getComputedStyle(node);return [style.backgroundColor,style.borderColor,style.borderRadius,style.boxShadow,style.padding]; };
      const scroll=document.querySelector('.result-scroll');
      return {styles:cards.map(shape),gutter:cards[0].getBoundingClientRect().left-scroll.getBoundingClientRect().left,
        surface:getComputedStyle(scroll).backgroundColor,overflow:scroll.scrollWidth>scroll.clientWidth,
        controls:[...cards[0].querySelectorAll('.card-links a,.save-policy,summary')].map(node=>node.getBoundingClientRect().height)};
    })()`);
    (report.layout ??= {})[width]=layout;
    check(width+'px 无横向溢出，前三项样式一致，卡片操作高度至少 44px',
      !layout.overflow && layout.styles.length===3 && layout.styles.every(item=>item.join()===layout.styles[0].join()) &&
      layout.controls.every(height=>height>=44));
    if (!before) check(width+'px 背景、边框、卡面分层',layout.styles[0][0]==='rgb(255, 254, 251)' && layout.surface==='rgb(247, 244, 236)' && layout.gutter>=16);
  }
  await size(390,844);
  await click(card+' summary');
  await wait(matches(card+' details[open]'));
  await screenshot(phase+'-expanded-390');
  await click(card+' summary');
  await wait('!document.querySelector('+JSON.stringify(card+' details')+').open');
  await click('#recommendations > details > summary');
  await js('document.querySelector("#recommendations > details .policy-card").scrollIntoView({block:"start"})');
  await screenshot(phase+'-related-390');
  if (!before) {
    check('其他政策沿用相同卡面',await js('getComputedStyle(document.querySelector("#recommendations > details .policy-card")).backgroundColor === "rgb(255, 254, 251)"'));
    if(result.result.excluded.length) {
      await click('details:has(> summary[data-excluded-summary]) > summary');
      await wait(matches('.policy-card[data-excluded]'));
      await screenshot(phase+'-excluded-390');
      check('条件不满足线索使用相同卡面，无选择按钮',await js('getComputedStyle(document.querySelector(".policy-card[data-excluded]")).backgroundColor === "rgb(255, 254, 251)" && !document.querySelector(".policy-card[data-excluded] [data-favorite]")'));
    }
    const official = 'a[target="_blank"][href^="https:"]';
    check('有原文的卡片提供独立 HTTPS 入口，缺原文保留提示',await js(`[...document.querySelectorAll('#recommendations .policy-card')].every(card=>card.querySelector('${official}') || card.textContent.includes('官方原文链接待核实'))`));
    const sourced = result.result.policy_candidates.find(item=>item.source?.official_url?.startsWith('https:'));
    if (sourced) {
      const selector = '[data-policy="'+sourced.id+'"] '+official;
      const external = await js(`document.querySelector('${selector}').href`);
      const event = new Promise(ok=>{
        const listener=({data})=>{
          const message=JSON.parse(data);
          if(message.method==='Page.windowOpen'){
            socket.removeEventListener('message',listener);
            ok(message.params.url);
          }
        };
        socket.addEventListener('message',listener);
      });
      await click(selector);
      check('实际点击原文打开目录中的 URL',await Promise.race([event,sleep(5000).then(()=>null)])===external);
      await send('Page.bringToFront');
    }
    await click(card+' a[href^="policy.html"]');
    await wait(matches('.detail-actions'));
    check('实际打开政策详情',new URL(await url()).searchParams.get('id')===report.policies[0]);
    await wait('document.querySelector(".detail-actions a.primary")?.href === '+JSON.stringify(report.resultUrl));
    await click('.detail-actions a.primary');
    await wait(matches('#selected-next:not(:disabled)'));
    await click(favorite);
    await wait('document.querySelector("#selected-next")?.disabled && document.querySelector("#selected-count").textContent==="已选 0 项"');
    check('取消最后一项后下一步按既有规则禁用',await js('document.querySelector("#selected-count").textContent==="已选 0 项"'));
    await click(favorite);
    await wait(matches('#selected-next:not(:disabled)'));
    await click('[data-action=open-chat]');
    await wait(matches('#conversation[open]'));
    check('展开追问后已选仍为 1，下一步可点击',await js(`(() => {
      const next=document.querySelector('#selected-next'), r=next.getBoundingClientRect();
      return !next.disabled && next.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) &&
        document.querySelector('#selected-count').textContent==='已选 1 项';
    })()`));
    await screenshot(phase+'-chat-390');
    await click('#selected-next');
    await wait(matches('#selected-review')+' || '+matches('#reviewed-plan'));
    check('下一步实际进入原集中核对',new URL(await url()).searchParams.get('view')==='selected');
    if (!result.result.excluded.length) {
      await navigate('/analysis.html?demo=medical');
      await wait(matches('#intake'));
      await setField('[name=description]','合成案例：妈妈68岁，住在佛山市，今年住院后自费3万元，想了解医疗救助。','input');
      await click('#intake details summary');
      await setField('[name=insurance]','false','change');
      await click('#intake button');
      await wait(matches('#recommendations'));
      const excluded = (await state()).result.excluded;
      assert(excluded.length,'无参保案例应有已知条件不满足的政策');
      report.excluded = excluded.map(item=>item.name);
      await click('[data-excluded-summary]');
      await js('document.querySelector(".policy-card[data-excluded]").scrollIntoView({block:"start"})');
      await screenshot(phase+'-excluded-390');
      check('条件不满足线索使用相同卡面，且不能选择',await js('getComputedStyle(document.querySelector(".policy-card[data-excluded]")).backgroundColor === "rgb(255, 254, 251)" && !document.querySelector(".policy-card[data-excluded] [data-favorite]")'));
    }
  }
  check('Edge 无脚本异常',report.exceptions.length===0);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  socket?.close();
  browser.kill();
  const phase = process.argv.includes('--before') ? 'before' : 'after';
  writeFileSync(join(evidence,'card-ux-edge-'+phase+'.json'),JSON.stringify(report,null,2)+'\n');
}
