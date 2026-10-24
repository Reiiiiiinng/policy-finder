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

console.log('== 步骤单一数据源（P4）==');
{
  // 顶栏步骤文案与进度条高亮必须同源：文案由 flowStepText 生成，序号由 normalizeFlowStage 归一
  check('flowStepText 生成步骤文案', typeof sandbox.flowStepText === 'function');
  check('flowStepText 文案正确',
    [1, 2, 3, 4].map(sandbox.flowStepText).join('/') === '第 1 步/第 2 步/第 3 步/第 4 步',
    [1, 2, 3, 4].map(sandbox.flowStepText).join('/'));
  check('normalizeFlowStage 是函数', typeof sandbox.normalizeFlowStage === 'function');
  check('normalizeFlowStage 保序', [1, 2, 3, 4].every((n) => sandbox.normalizeFlowStage(n) === n));
  check('normalizeFlowStage 下越界夹到第 1 步', sandbox.normalizeFlowStage(0) === 1);
  check('normalizeFlowStage 上越界夹到第 4 步', sandbox.normalizeFlowStage(99) === 4);
  check('normalizeFlowStage 容错非数字', sandbox.normalizeFlowStage('x') === 1
    && sandbox.normalizeFlowStage(null) === 1 && sandbox.normalizeFlowStage(undefined) === 1);
  check('normalizeFlowStage 认字符串数字', sandbox.normalizeFlowStage('3') === 3);

  // 进度条自身带出当前阶段，浏览器测试可据此与顶栏徽章对账
  const f2 = sandbox.renderFlow(2);
  check('进度条带 data-flow-current', has(f2, 'data-flow-current="2"'));
  check('每个步骤带 data-stage',
    (f2.match(/data-stage="[1-4]"/g) || []).length === 4);
  check('当前步骤带 aria-current=step',
    (f2.match(/aria-current="step"/g) || []).length === 1);
  check('aria-current 落在第 2 步',
    /<li class="flow-step is-active" aria-current="step" data-stage="2">/.test(f2));
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

console.log('== 原创视觉母题「一线」（P5）==');
{
  // 母题必须承载信息，不能是纯装饰：左右两端都要有真实文字
  const t = sandbox.renderThread('独居', '社区养老服务');
  check('母题有起点文字', has(t, '独居'));
  check('母题有终点文字', has(t, '社区养老服务'));
  check('母题有连线', has(t, 'th-path'));
  check('母题结构完整', has(t, 'class="thread') && has(t, 'th-clue') && has(t, 'th-right'));
  check('母题对读屏可读', /role="img"/.test(t) && /aria-label="[^"]*独居[^"]*社区养老服务[^"]*"/.test(t));

  // 缺一端就降级为纯文字，不画半条线（否则视觉上像「无来源的结论」）
  const onlyClue = sandbox.renderThread('独居', '');
  check('缺终点时降级为纯文字', !has(onlyClue, 'th-path') && has(onlyClue, '独居'));
  const onlyRight = sandbox.renderThread('', '社区养老服务');
  check('缺起点时降级为纯文字', !has(onlyRight, 'th-path') && has(onlyRight, '社区养老服务'));
  check('两端都空时不崩', sandbox.renderThread('', '') === '<span class="thread is-text"></span>');

  // 转义：母题里的文字来自用户描述与政策名，必须 escapeHtml
  const xss = sandbox.renderThread('<img src=x onerror=alert(1)>', '正常权益');
  check('母题转义用户输入', !/<img/.test(xss) && has(xss, '&lt;img'));

  // 证据链顶部用母题把线索接到这条权益上
  const evT = sandbox.renderEvidenceChain({
    profile_basis: [{ kind: 'scene', label: '独居', text: '描述中提到独自居住' }],
    policy_conditions: [], citation: { department: '广州市民政局', verified: true }, pending_count: 0,
  }, { policyName: '社区养老服务' });
  check('证据链顶部出现母题', has(evT, 'thread-head') && has(evT, 'th-path'));
  check('证据链母题接到真实权益名', has(evT, '社区养老服务'));
  check('证据链母题用真实线索', has(evT, '独居'));

  // 没有画像依据时退回「您的描述」，不空着
  const evNoBasis = sandbox.renderEvidenceChain({
    profile_basis: [], policy_conditions: [], citation: {}, pending_count: 0,
  }, {});
  check('无画像依据时母题退回您的描述', has(evNoBasis, '您的描述'));

  // 母题不得引入新的资格断言
  check('母题不含资格断言', !/符合资格|已符合|一定能/.test(t + evT));
}

console.log('== 两个判断维度分离（P7-A）==');
{
  check('renderAxes 是函数', typeof sandbox.renderAxes === 'function');
  const a = sandbox.renderAxes('可能相关', false);
  const b = sandbox.renderAxes('待确认', true);

  // 两个维度都要自报家门，不能靠读者猜
  check('带匹配维度名', has(a, 'axis-k">匹配'));
  check('带来源维度名', has(a, 'axis-k">来源'));
  check('匹配维度值「可能相关」', has(a, '可能相关'));
  check('待确认走不同色档', has(b, 'is-confirm'));

  // 不同维度不得同款并排：来源层不能再复用匹配层的药丸 class
  check('来源层不复用 badge 药丸', !/class="badge/.test(a) && !/class="badge/.test(b));
  check('匹配层用实心浅底', has(a, 'axis-v is-maybe') && has(b, 'axis-v is-confirm'));
  check('来源层用方点短句', has(a, 'axis-v is-verified') && has(b, 'axis-v is-pending'));

  // 「已核验」只描述来源，不能被读成「已符合资格」
  check('已核验带勾', has(a, '✓ 已核验'));
  check('待核验不带勾', has(b, '待核验') && !has(b, '✓'));
  check('维度标签有序（匹配在前来源在后）',
    a.indexOf('axis-k">匹配') < a.indexOf('axis-k">来源'));
  check('两个维度各出现一次',
    (a.match(/class="axis /g) || []).length === 2);
  check('不出现资格断言', !/符合资格|已符合|一定能/.test(a + b));
  // 兼容名仍在（老页面/老测试还在用）
  check('statusBadge 委托 renderAxes',
    sandbox.statusBadge('待确认', true) === sandbox.renderAxes('待确认', true));
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
  check('顶部显示总数', has(h, '共找到 4 条可能相关的政策'), '');
  check('顶部显示建议优先了解数', has(h, '建议优先了解其中 2 项'), '');
  check('分组标题为「优先关注」', has(h, '优先关注'));
  // 「信息待补充」是横切属性，不再把条目从档位分组里剔除：
  // p3、p4 仍按档位分组，另有单独的缺口清单指回它们。
  check('折叠区标题为「其他可能相关 2 项」', has(h, '其他可能相关 2 项'), '');
  check('信息待补充组独立成组', has(h, '信息待补充') && has(h, 'id="seg-needinfo"'));
  check('缺口组不复述卡片，只列名字', !/id="seg-needinfo"[\s\S]{0,900}?class="result-card/.test(h));
  check('优先关注计数正确', has(h, '>2 项<'));
  check('卡片保留 data-id', has(h, 'data-id="p1"'));
  check('保留 .result-card 类', has(h, 'result-card'));
  check('保留查看详情入口', has(h, '查看详情与办理方式'));
  check('保留来源区', has(h, '政策来源'));
  check('保留为什么推荐', has(h, '为什么推荐'));
  check('保留还需确认', has(h, '还需确认'));
  check('证据链默认收起', has(h, 'hidden') && has(h, 'data-ev-toggle'));
  // P6：主卡第一眼三件事——是什么 / 为什么（一条）/ 下一步。
  // 理由默认只留一条，其余收在「另外 N 条理由」里；措辞不是分页。
  // 注意：上面的夹具每条只有 1 条理由，折叠分支要用单独夹具验证。
  {
    const multi = sandbox.renderResultCards({
      profile: {},
      results: [Object.assign(mk('m1', '社区养老服务', '强相关', '可能相关'), {
        ai_reason: ['您父亲年龄72岁，符合年龄范围', '服务依托颐康中心就近提供', '独居老人可获得日间照料'],
      })],
    }, {});
    check('P6 理由默认只显示一条',
      (multi.match(/<ul class="reason-list">/g) || []).length === 1,
      'n=' + (multi.match(/<ul class="reason-list">/g) || []).length);
    check('P6 其余理由折叠为「另外 N 条理由」', has(multi, '另外 2 条理由'));
    check('P6 折叠理由默认收起',
      has(multi, 'data-reason-toggle="m1"') && has(multi, 'data-reason-rest="m1"')
      && /data-reason-rest="m1"[^>]*hidden/.test(multi));
    check('P6 折叠理由与按钮有可访问性关联',
      has(multi, 'aria-controls="reasonRest-m1"') && has(multi, 'id="reasonRest-m1"'));
    check('P6 折叠区里仍保留全部理由',
      has(multi, '服务依托颐康中心就近提供') && has(multi, '独居老人可获得日间照料'));
    check('P6 首条理由始终可见（不在折叠区里）',
      multi.indexOf('符合年龄范围') < multi.indexOf('data-reason-rest="m1"'));
  }
  check('P6 不用分页措辞', !/加载更多|查看更多|showMore|pageSize/.test(h));
  // 「还需确认」「政策来源」收进原生 details：内容仍在 DOM，只是默认不展开
  check('P6 待确认与来源默认收起', (h.match(/<details class="rc-fold">/g) || []).length === 4,
    'n=' + (h.match(/<details class="rc-fold">/g) || []).length);
  check('P6 折叠摘要写明项数与来源',
    has(h, '还需确认 1 项 · 政策来源') || has(h, '政策来源'));
  check('P6 折叠不等于删除',
    has(h, '还需确认') && has(h, '政策来源') && has(h, 'rc-block is-warm'));
  check('P6 主按钮指向为什么推荐', has(h, '为什么推荐？看依据'));
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
  check('全部优先时计数正确', has(allFocus, '共找到 1 条可能相关的政策'), '');
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

console.log('== 双模式会话：当前生效查询的判定 ==');
{
  // 换上可写的 sessionStorage 桩（默认桩只读 null），两种模式的资料可以同时在场
  const mem = new Map();
  sandbox.sessionStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const setSession = (obj) => {
    mem.clear();
    if (obj) mem.set('policy_finder_session', JSON.stringify(obj));
  };
  // 两份画像同时在场（先帮家人查、又为自己查）——这是劫持问题的事发状态
  const both = {
    text: '我父亲72岁', profile: { mode: 'family' },
    selfText: '我63岁', selfProfile: { mode: 'self' },
    operator: '女儿', beneficiary: '父亲',
  };

  // lastQuery 是唯一权威：谁最后查的，当前模式就是谁
  setSession(Object.assign({ lastQuery: 'self' }, both));
  check('lastQuery=self 判为本人模式', sandbox.activeQueryMode() === 'self');
  check('lastQuery=self 画像取 selfProfile', sandbox.activeProfile().mode === 'self');

  setSession(Object.assign({ lastQuery: 'family' }, both));
  check('lastQuery=family 判为家庭模式', sandbox.activeQueryMode() === 'family');
  // 上一轮把详情页取画像改成 selfProfile 无条件优先，反向劫持过家庭模式：
  // 残留的本人画像不能盖过本次的家庭画像
  check('lastQuery=family 画像取 profile（残留本人画像不劫持家庭）',
    sandbox.activeProfile().mode === 'family');

  // 旧会话兼容：没有 lastQuery 时按字段推断
  setSession({ selfText: '我63岁', selfProfile: { mode: 'self' } });
  check('旧会话只有 selfText 判为本人', sandbox.activeQueryMode() === 'self');
  setSession({ text: '我父亲72岁', profile: { mode: 'family' } });
  check('旧会话只有 text 判为家庭', sandbox.activeQueryMode() === 'family');
  setSession({ selfText: '', selfProfile: {}, text: '', profile: {} });
  check('全空会话默认家庭', sandbox.activeQueryMode() === 'family');
  check('全空会话画像回退不抛错', sandbox.activeProfile() !== undefined);

  // 关系条是「家庭协助」轴的常驻可见元素：本人模式下必须整体消失
  setSession(Object.assign({ lastQuery: 'self' }, both));
  check('本人模式下不渲染家庭关系条', sandbox.renderRelationStrip() === '');
  setSession(Object.assign({ lastQuery: 'family' }, both));
  const strip = sandbox.renderRelationStrip();
  check('家庭模式下渲染关系条', strip.indexOf('rel-strip') >= 0, strip.slice(0, 80));
  check('关系条含核实状态', strip.indexOf('rs-flag') >= 0);
  setSession({ lastQuery: 'family', profile: { mode: 'family' } });
  check('无操作者信息时不渲染关系条', sandbox.renderRelationStrip() === '');
}

console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
