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
    missing_information: tier === '待确认'
      ? ['是否属于所在社区卫生服务机构的服务覆盖范围']
      : [],
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
  check('顶部显示总数', has(h, '共发现 4 项可能相关权益'), '');
  check('顶部显示建议优先了解数', has(h, '建议优先了解其中 2 项'), '');
  check('分组标题为「优先关注」', has(h, '优先关注'));
  check('折叠区标题为「其他可能相关 2 项」', has(h, '其他可能相关 2 项'), '');
  check('优先关注计数正确', has(h, '>2 项<'));
  check('卡片保留 data-id', has(h, 'data-id="p1"'));
  check('保留 .result-card 类', has(h, 'result-card'));
  check('保留查看详情入口', has(h, '查看详情与办理方式'));
  check('保留来源区', has(h, '政策来源'));
  check('保留为什么推荐', has(h, '为什么推荐'));
  check('保留还需确认', has(h, '还需确认'));
  check('证据链默认收起', has(h, 'hidden') && has(h, 'data-ev-toggle'));
  check('优先项在折叠项之前', h.indexOf('data-id="p1"') < h.indexOf('data-id="p3"'));
  check('折叠区默认收起', has(h, 'aria-expanded="false"') && has(h, 'data-more-body'));
  check('折叠区有可访问性关联', has(h, 'aria-controls="moreItems"') && has(h, 'id="moreItems"'));
  // 措辞红线：新分组不得使用「强相关」「最符合」「已符合资格」
  check('不使用「强相关」字样', !has(h, '强相关'), '');
  // 注意：页面里「不代表已符合资格」是合规免责声明，
  // 只有脱离否定语境的「已符合资格」才违规，所以先把否定表述剥掉再检查。
  const hNoNeg = h.replace(/不代表[^，。]*资格|不构成[^，。]*结论|不作为[^，。]*认定/g, '');
  check('不使用「最符合」', !/最符合/.test(hNoNeg), '');
  check('不使用肯定语境的「已符合资格」', !/已符合资格/.test(hNoNeg), '');
  check('保留「不代表已符合资格」免责表述', /不代表已符合资格/.test(h), '');
  // 状态徽章仍用「可能相关 / 待确认」，这是需求要求保留的
  check('保留可能相关徽章', has(h, '可能相关'));
  check('保留待确认徽章', has(h, '待确认'));
  check('空结果走空状态', has(sandbox.renderResultCards({ profile: {}, results: [] }, {}), 'empty-card'));

  // 无优先项时不应显示「优先关注 0 项」
  const noFocus = sandbox.renderResultCards({
    profile: { mode: 'family' },
    results: [mk('p9', '认知功能筛查', '待确认', '待确认')],
  }, {});
  check('无优先项时不出现「优先关注」分组', !has(noFocus, '优先关注 0'), '');
  check('无优先项时改用其他提示', has(noFocus, '暂未识别到优先关注项'), '');

  // 全部为优先项时不应出现折叠区
  const allFocus = sandbox.renderResultCards({
    profile: { mode: 'family' },
    results: [mk('p8', '社区养老服务', '强相关', '可能相关')],
  }, {});
  check('全部优先时不出现折叠区', !has(allFocus, 'more-toggle'), '');
  check('全部优先时计数正确', has(allFocus, '共发现 1 项可能相关权益'), '');
}

console.log('== v0.9 政策状态与阈值提示 ==');
{
  const V = sandbox.renderValidityNote;
  const T = sandbox.renderThresholdNote;
  check('renderValidityNote 是函数', typeof V === 'function');
  check('renderThresholdNote 是函数', typeof T === 'function');

  // 空内容一律不生成 DOM —— 广州库就是这一种状态
  check('validity=null 不渲染', V(null) === '' && V(undefined) === '');
  check('normal + 空 message 不渲染',
    V({ status: 'active', level: 'normal', message: '', expires_at: null }) === '');
  check('level 缺失且无 message 不渲染', V({ status: 'active' }) === '');

  const warn = V({
    status: 'expiring', level: 'warn', expires_at: '2027-01-31',
    message: '本办法有效期至 2027-01-31，届时请以最新文件为准',
  });
  check('warn 正常显示', has(warn, 'policy-validity-warn') && has(warn, '2027-01-31'), warn);
  check('warn 有提示标题', has(warn, '政策时效提醒'), '');

  const muted = V({
    status: 'expired', level: 'muted', expires_at: '2026-12-31',
    message: '该政策已过有效期，请以最新文件为准',
  });
  check('muted 正常显示', has(muted, 'policy-validity-muted') && has(muted, '已过有效期'), muted);

  const sup = V({
    status: 'superseded', level: 'muted', expires_at: null,
    message: '该政策已由《佛山市大病保险管理办法》替代，请查看新规',
    superseded_by: { name: '佛山市大病保险管理办法（2026年版）', document_no: '佛医保〔2026〕1号' },
  });
  check('被替代时给出替代文件', has(sup, '替代文件') && has(sup, '佛医保〔2026〕1号'), '');
  check('muted 用中性类而非警示类', !has(sup, 'policy-validity-warn'));
  check('无 message 但有 expires_at 也能提示',
    has(V({ level: 'warn', expires_at: '2027-06-30' }), '2027-06-30'));

  // 三态阈值
  check('threshold=null 不显示', T(null) === '' && T(undefined) === '');
  check('message/action 全空不显示', T({ touched: true }) === '');

  const hit = T({
    touched: true, message: '按您提供的金额，可能已触及起付标准',
    action: '具体标准请向医保部门核实',
  });
  const below = T({
    touched: false, message: '按您提供的金额，可能尚未达到起付标准',
    action: '具体标准请向医保部门核实；如后续费用增加可重新判断',
  });
  const unknown = T({
    touched: null, message: '尚未提供个人负担金额，无法判断是否已达到起付标准',
    action: '可在补充信息里填写个人负担的大致金额，或直接向医保部门核实',
  });
  check('touched=true 显示可能触及', has(hit, 'is-hit') && has(hit, '可能已触及'), hit);
  check('touched=false 显示未触及', has(below, 'is-below') && has(below, '尚未达到'), below);
  check('touched=null 显示需补充信息', has(unknown, 'is-unknown') && has(unknown, '尚未提供'), unknown);
  check('阈值提示不输出具体金额', !/\d+\s*(?:元|万)/.test(hit + below + unknown), '');
  check('阈值提示含向医保部门核实的指引', has(hit, '向医保部门核实'), '');

  // 产品红线用词
  const FORBID = /符合资格|保证|自动办理|已享受/;
  check('状态提示不含禁止词', !FORBID.test(warn + muted + sup + hit + below + unknown), '');

  // 接入结果卡后的行为：广州库不新增任何 DOM，有数据时才出现
  const card = (extra) => Object.assign({
    policy_id: 'gz1', policy_name: '社区养老服务', category: '养老服务',
    service_type: '照护服务', region: '广州市', status: '可能相关', score: 20,
    tier: '强相关', ai_reason: ['您父亲年龄72岁，处于服务年龄范围内'], missing_information: [],
    source_pending: false, evidence: {},
  }, extra || {});

  const gz = sandbox.renderResultCards({ profile: { mode: 'family' }, results: [card()] }, {});
  check('广州库卡片不出现状态提示',
    !has(gz, 'policy-validity-warn') && !has(gz, 'policy-validity-muted')
    && !has(gz, 'policy-threshold-note'), '');

  const fs = sandbox.renderResultCards({
    profile: { mode: 'family' },
    results: [card({
      validity: {
        status: 'expiring', level: 'warn', expires_at: '2027-01-31',
        message: '本办法有效期至 2027-01-31，届时请以最新文件为准',
      },
      threshold_signal: {
        touched: true, message: '按您提供的金额，可能已触及起付标准',
        action: '具体标准请向医保部门核实',
      },
    })],
  }, {});
  check('有数据时卡片出现状态提示',
    has(fs, 'policy-validity-warn') && has(fs, 'policy-threshold-note'), '');
  check('新提示不破坏卡片原有结构',
    has(fs, 'result-card') && has(fs, '为什么推荐') && has(fs, '政策来源')
    && has(fs, '查看详情与办理方式'), '');
  const fsNoNeg = fs.replace(/不代表[^，。]*资格|不构成[^，。]*结论|不作为[^，。]*认定/g, '');
  check('新增内容不引入资格断言', !/已符合资格|最符合/.test(fsNoNeg), '');
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
