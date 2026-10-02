/*
 * 前端渲染回归：用 Node 直接跑 assets/app.js 的渲染函数，
 * 校验「情况确认台 / 证据链 / 分层 / 流程指示器」的输出是否符合产品红线。
 *
 * 不依赖浏览器：只验证纯函数渲染出的 HTML 字符串。
 *   node .tools/render-test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');

// 造一个最小 DOM 环境，让 app.js 里的顶层代码可以加载
const noopEl = {
  addEventListener() {}, remove() {}, appendChild() {}, querySelector() { return null; },
  querySelectorAll() { return []; }, insertAdjacentHTML() {}, classList: { add() {}, remove() {} },
  setAttribute() {}, hidden: false,
};
const sandbox = {
  document: {
    getElementById: () => noopEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => Object.assign({}, noopEl),
    body: Object.assign({}, noopEl),
  },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { search: '' },
  fetch: async () => ({ json: async () => ({}) }),
  setTimeout, clearTimeout, console, CSS: { escape: (s) => s },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
// const/let 声明不会挂到 sandbox 上，追加一段显式导出把需要断言的符号取出来
vm.runInContext(src + '\n;globalThis.__X = { FLOW_STAGES, AI_STEPS, SCENE_GLYPH, API, store };',
  sandbox, { filename: 'app.js' });
const X = sandbox.__X;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 200) : '')); }
}

const API = X.API;
const store = X.store;
const has = (h, needle) => String(h).includes(needle);

console.log('== 流程指示器 ==');
{
  const h1 = sandbox.renderFlow(1), h2 = sandbox.renderFlow(3), h4 = sandbox.renderFlow(4);
  check('四阶段齐全', X.FLOW_STAGES.length === 4);
  check('四阶段文案正确',
    X.FLOW_STAGES.map((s) => s.label).join('/') === '确认情况/发现权益/查看依据/进一步确认',
    X.FLOW_STAGES.map((s) => s.label).join('/'));
  check('四个步骤渲染', (h1.match(/<li class="flow-step/g) || []).length === 4);
  check('第1步为当前', has(h1, 'is-active') && !has(h1, 'tier-mid'));
  check('第3步时前两步done', has(h2, 'is-done'));
  check('四阶段文案不夸大', !/保证|一定能|自动办理|已认证/.test(h4));
}

console.log('== 情况确认台 ==');
{
  const profile = {
    age: 72, region: '广州市', hukou: null, insurance: null, disability: null,
    scenes: ['独居', '行动不便', '年龄增长'], relation: '父亲', operator: '女儿',
    beneficiary_label: '父亲', who: '您父亲', mode: 'family',
  };
  const lib = [
    { name: '行动不便', plain: '描述中提到行动、走路方面的困难', detected: true, related_count: 7 },
    { name: '独居', plain: '描述中提到独自居住', detected: true, related_count: 3 },
    { name: '年龄增长', plain: '已到相关政策的年龄门槛附近', detected: true, related_count: 2 },
    { name: '长期卧床', plain: '描述中提到长期卧床、下不了床', detected: false, related_count: 4 },
    { name: '记忆下降', plain: '描述中提到记忆、认知方面的变化', detected: false, related_count: 3 },
  ];
  const h = sandbox.renderSituationBoard(profile, lib, {});
  check('渲染确认台', has(h, 'board'));
  check('年龄事实', has(h, '72 岁'));
  check('地区事实', has(h, '广州市'));
  check('已识别事件带 data-on=1', has(h, 'data-on="1"'));
  check('未识别事件带 data-on=0', has(h, 'data-on="0"'));
  check('chip 数量正确', (h.match(/data-scene=/g) || []).length === 5);
  check('三个关键条件各3 按钮 = 9',
        (h.match(/data-confirm=/g) || []).length === 9,
        (h.match(/data-confirm=/g) || []).length);
  check('提示可纠正', has(h, '认错了就点掉'));
  check('不出现资格断言', !/符合资格|已符合|一定能|保证/.test(h));
  check('家属模式用「老人」', has(h, '老人是否具有广州市户籍'));

  // 本人模式称谓
  const selfProfile = Object.assign({}, profile, { mode: 'self', who: '您', relation: null });
  const hs = sandbox.renderSituationBoard(selfProfile, lib, {});
  check('本人模式用「您」', has(hs, '您是否具有广州市户籍'));
  check('本人模式不出现老人称谓条件', !has(hs, '老人是否具有广州市户籍'));

  // 未提供任何信息时给出警示而不是空白
  const empty = sandbox.renderSituationBoard({ mode: 'family', scenes: [] }, [], {});
  check('无信息时提示补充', has(empty, 'board-warn'));

  // XSS 防护：chip 的 name 与 plain 都必须转义
  const xssLib = [{
    name: '<img src=x onerror=alert(1)>',
    plain: '<script>alert(2)</script>',
    detected: true, related_count: 1,
  }];
  const xss = sandbox.renderSituationBoard(
    { mode: 'family', scenes: ['<img src=x onerror=alert(1)>'], age: 72 }, xssLib, {});
  check('场景名转义', !/<img src=x/.test(xss) && /&lt;img/.test(xss),
        xss.slice(Math.max(0, xss.indexOf('img') - 60), xss.indexOf('img') + 60));
  check('场景说明转义', !/<script>alert/.test(xss) && /&lt;script&gt;/.test(xss));
}

console.log('== 证据链 ==');
{
  const ev = {
    profile_basis: [
      { kind: 'scene', label: '独居', text: '描述中提到独自居住' },
      { kind: 'age', label: '年龄 72 岁', text: '由您在描述中提供' },
    ],
    policy_conditions: [
      { label: '年龄门槛', requirement: '年满 60 周岁', state: 'met', evidence: '您描述为 72 岁' },
      { label: '户籍条件', requirement: '需符合：具有广州市户籍', state: 'unknown', evidence: '尚未确认，需要您或受理单位核实' },
      { label: '医保条件', requirement: '需符合：已参加广州市社会医疗保险', state: 'failed', evidence: '您已确认：未参加广州市社会医疗保险' },
    ],
    citation: {
      department: '广州市民政局', document: '广州市基本养老服务清单（2024年版）',
      document_no: '穗民〔2024〕76号', publish_date: '2024-07-17',
      quote: '广州市基本养老服务清单（2024年版）、穗民〔2024〕76号（2024-07-17）',
      verified: true, checked_at: '2026-09-29',
    },
    pending_count: 1,
  };
  const h = sandbox.renderEvidenceChain(ev, {});
  check('三段齐全', (h.match(/ev-num/g) || []).length === 3);
  check('画像依据显示', has(h, '描述中提到独自居住'));
  check('条件逐条显示', has(h, '年满 60 周岁') && has(h, '户籍条件'));
  check('met 状态', has(h, 'ev-cond met') && has(h, '已确认'));
  check('unknown 状态', has(h, 'ev-cond unknown') && has(h, '待确认'));
  check('failed 状态措辞为已确认不符合', has(h, '已确认不符合'));
  check('真实文号', has(h, '穗民〔2024〕76号'));
  check('部门显示', has(h, '广州市民政局'));
  check('待确认计数', has(h, '1 项条件待确认'));
  check('不出现资格断言', !/符合资格|已符合资格|一定能/.test(h));

  // to_verify 情形
  const ev2 = JSON.parse(JSON.stringify(ev));
  ev2.citation = { department: '广州市卫生健康部门', document: '', document_no: '', publish_date: '', quote: '', verified: false, checked_at: '' };
  ev2.pending_count = 0;
  const h2 = sandbox.renderEvidenceChain(ev2, {});
  check('to_verify 标注来源待核验', has(h2, '来源待核验'));
  check('to_verify 不列文件名/文号/日期',
    !has(h2, '政策文件') && !has(h2, '文号') && !has(h2, '发布时间'));
  check('to_verify 仍显示责任部门', has(h2, '广州市卫生健康部门'));
  check('to_verify 无文件名不出现旧文号', !has(h2, '穗民'));
  check('ev 为空时不崩', sandbox.renderEvidenceChain(null, {}) === '');
}

console.log('== 结果分层 ==');
{
  const mk = (id, name, tier, status) => ({
    policy_id: id, policy_name: name, category: '养老服务', service_type: '照护服务',
    region: '广州市', status: status || '可能相关', score: 20, tier: tier,
    ai_reason: ['您父亲年龄72岁，符合年龄范围'],
    missing_information: [], source_pending: false,
    source_department: '广州市民政局', source_document_no: '穗民〔2024〕76号',
    source_publish_date: '2024-07-17', source_checked_at: '2026-09-29',
    matched_scenes: tier === '待确认' ? [] : ['独居'],
    evidence: { profile_basis: [], policy_conditions: [], citation: {}, pending_count: 0 },
  });
  const data = {
    profile: { mode: 'family', scenes: ['独居'] },
    notice: '以下为初步匹配结果，均需进一步确认，不作为资格认定。',
    results: [
      mk('p1', '社区养老服务', '强相关', '可能相关'),
      mk('p2', '助餐配餐服务', '强相关', '可能相关'),
      mk('p3', '长期护理保险', '可能相关', '待确认'),
      mk('p4', '认知功能筛查', '待确认', '待确认'),
    ],
  };
  const h = sandbox.renderResultCards(data, {});
  check('渲染三档分组标题', has(h, '强相关') && has(h, '可能相关') && has(h, '待确认'));
  check('分组计数正确', has(h, '>2 项<') && has(h, '>1 项<'));
  check('卡片保留 data-id', has(h, 'data-id="p1"'));
  check('保留 .result-card 类', has(h, 'result-card'));
  check('保留查看详情入口', has(h, '查看详情与办理方式'));
  check('保留来源区', has(h, '政策来源'));
  check('保留为什么推荐', has(h, '为什么推荐'));
  check('证据链默认收起', has(h, 'hidden') && has(h, 'data-ev-toggle'));
  check('顺序：强相关在前', h.indexOf('data-id="p1"') < h.indexOf('data-id="p3"'));
  check('空结果走空状态', has(sandbox.renderResultCards({ profile: {}, results: [] }, {}), 'empty-card'));
}

console.log('== 原有能力未被破坏 ==');
{
  check('statusBadge 保留', typeof sandbox.statusBadge === 'function');
  check('renderProfileCard 保留', typeof sandbox.renderProfileCard === 'function');
  check('renderConfirmCard 保留', typeof sandbox.renderConfirmCard === 'function');
  check('renderSceneSummary 保留', typeof sandbox.renderSceneSummary === 'function');
  check('renderTopbar 保留', typeof sandbox.renderTopbar === 'function');
  check('showToast 保留', typeof sandbox.showToast === 'function');
  check('escapeHtml 保留', sandbox.escapeHtml('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;');
  check('store 保留', typeof store.read === 'function' && typeof store.write === 'function');
  check('API.scenes 已接入', typeof API.scenes === 'function');
  check('bindSceneChips 保留', typeof sandbox.bindSceneChips === 'function');
  check('bindEvidenceToggles 保留', typeof sandbox.bindEvidenceToggles === 'function');

  // 称谓与待确认过滤等老逻辑不变
  check('本人模式称谓转换', sandbox.personalize('老人是否具有户籍', { mode: 'self' }) === '您是否具有户籍');
  check('家庭模式不改称谓', sandbox.personalize('老人是否具有户籍', { mode: 'family' }) === '老人是否具有户籍');
  const f = sandbox.filterAnsweredMissing(['老人是否具有广州市户籍', '所在社区覆盖'], { hukou: true });
  check('已答户籍被过滤', !f.some((x) => /户籍/.test(x)));
  check('未答项保留', f.some((x) => /社区/.test(x)));
  check('explainMissing 有解释', sandbox.explainMissing('老人是否具有广州市户籍').length > 10);
}

console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);