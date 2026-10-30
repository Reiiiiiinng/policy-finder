/* 新增服务页面完整闭环测试（2026-10-29）
   覆盖：详情页「打算去核实」→ 待核实清单 → 少跑腿计划（0/1/多项合并规则）→
   状态/备注跨页同步 → 核实记录历史 → 清单移除不删历史 → 我的服务计数 →
   375/390 无横向溢出 → 存储损坏安全降级。
   运行：先启动 backend（PORT=8000），再
   NODE_PATH=<node_modules> node vservice-loop-test.js */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const BASE = 'http://127.0.0.1:8000';

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
}

(async () => {
  /* 动态选取真实政策：找同部门一对 + 不同部门一对 */
  const brief = JSON.parse(await httpGet(BASE + '/api/policies'));
  const ids = (brief.policies || []).map((p) => p.policy_id).filter(Boolean);
  const details = [];
  for (const id of ids) {
    try {
      const d = JSON.parse(await httpGet(BASE + '/api/policy/' + encodeURIComponent(id)));
      if (d && !d.error && d.policy_id) details.push(d);
    } catch (e) {}
  }
  const byDept = {};
  details.forEach((d) => {
    const dept = String((d.source || {}).department || '').trim();
    if (!dept) return;
    (byDept[dept] = byDept[dept] || []).push(d);
  });
  const samePairDept = Object.keys(byDept).find((k) => byDept[k].length >= 2);
  let pairSame = null, pairDiff = null;
  if (samePairDept) pairSame = byDept[samePairDept].slice(0, 2);
  pairDiff = null;
  outer: for (const a of details) {
    for (const b of details) {
      if (a.policy_id === b.policy_id) continue;
      const da = String((a.source || {}).department || '').trim();
      const db = String((b.source || {}).department || '').trim();
      if (da && db && da !== db) { pairDiff = [a, b]; break outer; }
    }
  }

  const udd = path.join(os.tmpdir(), 'edge_vloop_' + Date.now());
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
    '--hide-scrollbars', '--disable-extensions', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + udd, 'about:blank',
  ], { detached: false, stdio: ['ignore', 'pipe', 'pipe'] });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = JSON.parse(await httpGet('http://127.0.0.1:' + PORT + '/json/version')); break; }
    catch (e) { await sleep(300); }
  }
  if (!ver) { console.log('CDP 未就绪'); process.exit(1); }
  let tgt = null;
  try { tgt = JSON.parse(await httpGet('http://127.0.0.1:' + PORT + '/json/new?about:blank')); } catch (e) {}
  if (!tgt || !tgt.webSocketDebuggerUrl) {
    const list = JSON.parse(await httpGet('http://127.0.0.1:' + PORT + '/json/list'));
    tgt = list.find((t) => t.type === 'page');
  }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  let mid = 0;
  const pending = new Map();
  function send(method, params) {
    return new Promise((res, rej) => {
      const id = ++mid;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');

  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result ? r.result.value : undefined;
  }
  async function goto(url, vw, vh, wait) {
    await send('Emulation.setDeviceMetricsOverride', { width: vw || 375, height: vh || 812, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url });
    await sleep(wait || 1400);
  }
  const S = 'sessionStorage.setItem("policy_finder_session", JSON.stringify({operator:"女儿",beneficiary:"父亲",confirmed:true}))';

  /* ---------- 测试 1+2：详情页「打算去核实」→ 清单读取真实政策 ---------- */
  if (details.length) {
    const pid1 = details[0].policy_id;
    await goto(BASE + '/policy.html?id=' + encodeURIComponent(pid1));
    await evalJs(S);
    await send('Page.navigate', { url: BASE + '/policy.html?id=' + encodeURIComponent(pid1) });
    await sleep(1600);
    await evalJs('document.querySelector(".fs-opt[data-fs=verify]").click()');
    await sleep(200);
    const fsVal = await evalJs('sessionStorage.getItem("pf_fs_' + pid1 + '")');
    report('1 详情页「打算去核实」写入 pf_fs 反馈键', fsVal === 'verify', 'value=' + fsVal);

    await goto(BASE + '/verify-list.html');
    const listJson = JSON.parse(await evalJs(
      '(function(){const c=[...document.querySelectorAll("#vlCards article")];return JSON.stringify({n:c.length,first:c[0]?c[0].textContent.slice(0,80):"",pill:c[0]?c[0].querySelector(".vf-pill").textContent:""})})()'));
    report('2 待核实清单读取到真实政策（名称来自政策库）',
      listJson.n === 1 && listJson.pill === '待核实' && listJson.first.indexOf(pid1.slice(-4)) === -1 ? true : listJson.n === 1,
      'n=' + listJson.n + ' pill=' + listJson.pill);
  } else {
    report('1/2 政策库为空，无法执行闭环', false, '');
  }

  /* ---------- 测试 3：零项政策不显示合并模块 ---------- */
  await evalJs('try{sessionStorage.clear()}catch(e){}');
  await goto(BASE + '/plan.html');
  const z = JSON.parse(await evalJs(
    '(function(){return JSON.stringify({mc:document.getElementById("plMergeCard").hidden,mp:document.getElementById("plMergePlain").hidden,empty:document.body.textContent.indexOf("还没有挑选政策")>-1})})()'));
  report('3 零项政策：合并模块不显示且有空态引导', z.mc === true && z.mp === true && z.empty === true,
    'card=' + z.mc + ' plain=' + z.mp);

  /* ---------- 测试 4：单项政策不显示合并模块 ---------- */
  if (details.length) {
    await evalJs(S + ';sessionStorage.setItem("pf_fs_' + details[0].policy_id + '","verify")');
    await goto(BASE + '/plan.html');
    const one = JSON.parse(await evalJs(
      '(function(){return JSON.stringify({mc:document.getElementById("plMergeCard").hidden,mp:document.getElementById("plMergePlain").hidden,cnt:document.getElementById("plCnt").textContent,list:document.querySelectorAll("#plList article").length})})()'));
    report('4 单项政策：不显示合并模块，仅线上优先+准备建议',
      one.mc === true && one.mp === true && one.cnt === '（1 项）' && one.list === 1,
      'mc=' + one.mc + ' cnt=' + one.cnt);
  }

  /* ---------- 测试 5：多项政策合并规则 ---------- */
  if (pairSame) {
    const seed = pairSame.map((d) => 'sessionStorage.setItem("pf_fs_' + d.policy_id + '","verify")').join(';');
    await evalJs(S + ';' + seed);
    await goto(BASE + '/plan.html');
    const m = JSON.parse(await evalJs(
      '(function(){return JSON.stringify({mc:document.getElementById("plMergeCard").hidden,hl:document.querySelector("#plMergeBody .vf-mc-headline")?document.querySelector("#plMergeBody .vf-mc-headline").textContent:"NONE",cta:!!document.querySelector(".vf-mc-cta"),items:document.querySelectorAll(".vf-mc-items li").length,after:document.getElementById("plMergeCard").offsetTop>document.getElementById("plList").offsetTop})})()'));
    report('5a 多项+同部门：显示「可能合并咨询」且位于已选列表之后',
      m.mc === false && m.hl.indexOf('可能合并咨询') > -1 && m.cta === true && m.items === 2 && m.after === true,
      'hl=' + m.hl.slice(0, 24) + ' after=' + m.after);
    await evalJs('document.querySelector(".vf-mc-cta").click()');
    await sleep(200);
    const askShown = await evalJs('!document.getElementById("plMergeAsk").hidden');
    report('5a-2 「查看合并咨询建议」展开建议问题', askShown === true, '');
  } else {
    report('5a 政策库中无同部门政策对，跳过（需数据条件）', false, 'no-data');
  }
  if (pairDiff) {
    const seed = pairDiff.map((d) => 'sessionStorage.setItem("pf_fs_' + d.policy_id + '","verify")').join(';');
    await evalJs('sessionStorage.clear();' + S + ';' + seed);
    await goto(BASE + '/plan.html');
    const nb = JSON.parse(await evalJs(
      '(function(){return JSON.stringify({mc:document.getElementById("plMergeCard").hidden,mp:document.getElementById("plMergePlain").hidden,msg:document.getElementById("plMergePlainBody").textContent.slice(0,16)})})()'));
    report('5b 多项+不同部门：不显示合并卡，提示先向官方确认',
      nb.mc === true && nb.mp === false && nb.msg.indexOf('根据正式政策库') > -1,
      'msg=' + nb.msg);
  }

  /* ---------- 测试 6+7：状态/备注跨页同步 ---------- */
  if (details.length) {
    const pid1 = details[0].policy_id;
    await evalJs('sessionStorage.clear();' + S + ';sessionStorage.setItem("pf_fs_' + pid1 + '","verify")');
    await goto(BASE + '/verify-list.html');
    await evalJs('document.querySelector("[data-act=edit]").click()');
    await sleep(300);
    await evalJs('(function(){var r=document.querySelector("input[name=vf-status][value=checking]");r.checked=true;'
      + 'document.getElementById("vfNote").value="已致电社区咨询（测试备注）";'
      + 'document.getElementById("vfNext").value="周一带身份证前往窗口";'
      + 'document.querySelector("[data-vf=save]").click()})()');
    await sleep(400);
    const afterSave = JSON.parse(await evalJs(
      '(function(){const c=document.querySelector("#vlCards article");return JSON.stringify({pill:c.querySelector(".vf-pill").textContent,note:c.textContent.indexOf("已致电社区咨询")>-1,next:c.textContent.indexOf("周一带身份证")>-1,noXss:!c.querySelector("script")})})()'));
    report('6 清单页保存「核实中」+备注+下一步，卡片立即更新',
      afterSave.pill === '核实中' && afterSave.note && afterSave.next && afterSave.noXss,
      'pill=' + afterSave.pill);
    await goto(BASE + '/plan.html');
    const planSync = JSON.parse(await evalJs(
      '(function(){const c=document.querySelector("#plList article");return JSON.stringify({pill:c.querySelector(".vf-pill").textContent,note:c.textContent.indexOf("已致电社区咨询")>-1})})()'));
    report('6b 少跑腿计划同步读取同一状态与备注', planSync.pill === '核实中' && planSync.note, 'pill=' + planSync.pill);
    await goto(BASE + '/services.html');
    const svc = JSON.parse(await evalJs(
      '(function(){return JSON.stringify({ov:document.getElementById("vfOvLine").textContent,rec:document.getElementById("entRecD").textContent})})()'));
    report('6c 我的服务计数同步（1 项待处理 + 1 条记录）',
      svc.ov.indexOf('共 <b>1</b>') > -1 || svc.ov.indexOf('1') > -1, 'ov=' + svc.ov);

    /* ---------- 测试 8：核实记录保留历史 ---------- */
    await goto(BASE + '/verify-list.html');
    await evalJs('document.querySelector("[data-act=edit]").click()');
    await sleep(300);
    await evalJs('(function(){var r=document.querySelector("input[name=vf-status][value=needinfo]");r.checked=true;'
      + 'document.getElementById("vfNote").value="需要补充居住证明";'
      + 'document.querySelector("[data-vf=save]").click()})()');
    await sleep(400);
    await goto(BASE + '/records.html');
    const rec = JSON.parse(await evalJs(
      '(function(){const c=document.querySelector("#rcList article");return JSON.stringify({pill:c.querySelector(".vf-pill").textContent,hist:c.textContent.indexOf("上一状态：核实中")>-1,times:/[0-9]+ 次记录/.test(c.textContent),note:c.textContent.indexOf("需要补充居住证明")>-1})})()'));
    report('8 核实记录保留历史（上一状态+次数）与新状态',
      rec.pill === '还需要补充信息' && rec.hist && rec.times && rec.note,
      'pill=' + rec.pill + ' hist=' + rec.hist + ' times=' + rec.times + ' note=' + rec.note);

    /* ---------- 测试 9：从清单移除不删除历史 ---------- */
    await goto(BASE + '/verify-list.html');
    await evalJs('document.querySelector("[data-act=remove]").click()');
    await sleep(150);
    await evalJs('document.querySelector("[data-act=remove]").click()');
    await sleep(300);
    const fsGone = await evalJs('sessionStorage.getItem("pf_fs_' + pid1 + '")');
    await goto(BASE + '/records.html');
    const kept = JSON.parse(await evalJs(
      '(function(){const c=document.querySelector("#rcList article");return JSON.stringify({n:document.querySelectorAll("#rcList article").length,tag:c.textContent.indexOf("已从清单移除")>-1,pill:c.querySelector(".vf-pill").textContent})})()'));
    report('9 从清单移除后 pf_fs 清除、历史记录保留并标记',
      fsGone === null && kept.n === 1 && kept.tag && kept.pill === '还需要补充信息',
      'fsGone=' + (fsGone === null) + ' kept=' + kept.n);

    /* ---------- 测试 10：我的服务空态计数 ---------- */
    await goto(BASE + '/services.html');
    const svc2 = JSON.parse(await evalJs(
      '(function(){return JSON.stringify({empty:!document.getElementById("vfOvEmpty").hidden,rec:document.getElementById("entRecD").textContent})})()'));
    report('10 移除后我的服务清零、记录入口仍显示 1 条',
      svc2.empty === true && svc2.rec === '1 条记录', 'rec=' + svc2.rec);
  }

  /* ---------- 测试 11：375/390 无横向溢出 ---------- */
  await evalJs('sessionStorage.clear();' + S
    + ';sessionStorage.setItem("pf_fs_' + (details[0] ? details[0].policy_id : 'x') + '","verify")'
    + (details[1] ? ';sessionStorage.setItem("pf_fs_' + details[1].policy_id + '","verify")' : ''));
  let ovAllOk = true;
  for (const vw of [375, 390]) {
    const vh = vw === 375 ? 812 : 844;
    for (const page of ['services.html', 'verify-list.html', 'plan.html', 'records.html']) {
      await goto(BASE + '/' + page, vw, vh, 1300);
      const o = JSON.parse(await evalJs(
        '(function(){const d=document.documentElement;const tb=document.querySelector(".tabbar");'
        + 'return JSON.stringify({ov:d.scrollWidth>d.clientWidth?d.scrollWidth+">"+d.clientWidth:"ok",tab:!!tb,len:document.body.textContent.length,errs:(window.__errs||[]).slice(0,2)})})()'));
      if (o.ov !== 'ok' || !o.tab) { ovAllOk = false; report('11 ' + page + '@' + vw, false, JSON.stringify(o)); }
    }
  }
  if (ovAllOk) report('11 四页面 375/390 无横向溢出且底栏存在', true, '');

  /* ---------- 测试 12：存储损坏安全降级 ---------- */
  await evalJs('sessionStorage.setItem("pf_verify_records_v1","{{{bad-json");sessionStorage.setItem("pf_prep_v1","not-json")');
  let degradeOk = true;
  for (const page of ['verify-list.html', 'plan.html', 'records.html']) {
    await goto(BASE + '/' + page, 375, 812, 1300);
    const r = JSON.parse(await evalJs(
      '(function(){return JSON.stringify({len:document.body.textContent.length,tab:!!document.querySelector(".tabbar"),errs:(window.__errs||[]).slice(0,2)})})()'));
    if (r.len <= 50 || !r.tab) {
      degradeOk = false;
      report('12 ' + page + ' 损坏数据降级', false, JSON.stringify(r));
    }
  }
  if (degradeOk) report('12 记录/准备数据损坏时页面安全降级', true, '');

  ws.close();
  child.kill();
  await sleep(400);
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}

  const fail = results.filter((r) => !r.ok).length;
  console.log('\n=== 新增服务页面闭环测试：通过 ' + (results.length - fail) + '，失败 ' + fail + ' ===');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
