/*
 * 第六阶段（交互细节修正）专项测试。
 *   node .tools/phase6-test.js
 * 覆盖 6 个问题对应的实现点，重点验证不破坏已有功能。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');

const noopEl = {
  addEventListener() {}, remove() {}, appendChild() {}, insertAdjacentHTML() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  hidden: false, scrollIntoView() {},
};
const store = {};
const sandbox = {
  document: {
    getElementById: () => noopEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => Object.assign({}, noopEl),
    body: Object.assign({}, noopEl),
    referrer: '',
    documentElement: { scrollHeight: 4000 },   // restoreListPosition 会算可滚动上限
  },
  sessionStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  // backOrFallback 会做同源校验（避免从外站直达时把用户带回站外），
  // 所以 mock 里必须给出 origin，否则会一律走兜底分支。
  location: { search: '', href: '', pathname: '/index.html',
               origin: 'http://127.0.0.1:8000', replace(u) { this.__replaced = u; } },
  history: { length: 3, back() { sandbox.__backed = true; } },
  window: null,
  scrollY: 0, pageYOffset: 0, innerHeight: 800,
  scrollTo(x, y) { if (typeof x === 'object' && x) { sandbox.scrollY = x.top || 0; } else { sandbox.scrollY = y || 0; } },
  setTimeout: () => 0, clearTimeout: () => {},
  requestAnimationFrame: (f) => f(), console,
  CSS: { escape: (s) => s },
  URL,   // 通用工具，VM 里必须提供
  URLSearchParams,   // resolveNavParent 解析 ?from= 参数时用到
  fetch: async () => ({ json: async () => ({}) }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__X={goToParent,registerNavParent,resolveNavParent,navPageKey,saveListPosition,restoreListPosition,clearListPosition,renderFlow};',
  sandbox, { filename: 'app.js' });
const X = sandbox.__X;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 160) : '')); }
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

console.log('== 问题1：首页首屏减负 ==');
{
  const html = read('frontend/index.html');
  const heroEnd = html.indexOf('</header>');
  const entryAt = html.indexOf('id="entry"');
  check('首屏 hero 存在', heroEnd > 0);
  check('入口区在 hero 之后（首屏优先顺序）', entryAt > 0 && entryAt < heroEnd + 4000 && entryAt > html.indexOf('<header'));
  // 入口应紧跟首屏：中间不能夹着 how-card / idea-card
  const between = html.slice(html.indexOf('</header>'), entryAt);
  check('入口与首屏之间无说明性大块',
    !/how-card|idea-card|trust-strip|role-diff/.test(between), between.slice(0, 120));
  check('hero 只有标题+一句话定位+下跳',
    !/hero-eyebrow/.test(html.slice(html.indexOf('<header'), heroEnd)), 'hero-eyebrow 应移除');
  check('一句话定位保留', /说出家里发生了变化|主动找到需要它的人/.test(html));
  check('首屏提供入口指引', /hero-jump/.test(html));
  check('核心理念未删除', /人找政策/.test(html) && /政策找人/.test(html));
  check('核心理念压缩为 idea-flow', /idea-flow/.test(html) && /idea-pips/.test(html));
  check('说明性内容仍在页面内（未删）',
    /how-card/.test(html) && /trust-strip/.test(html) && /role-diff/.test(html));
  check('三个入口 data-target 未变',
    /data-target="parents"/.test(html) && /data-target="family"/.test(html) && /data-target="self"/.test(html));
  check('Demo 入口保留', /id="demoEntry"/.test(html) && /showDemoConfirm/.test(html));
}

console.log('== 问题2：父母 / 长辈入口区分 ==');
{
  const html = read('frontend/family.html');
  check('读取 session.target 区分入口', /session\.target === 'family'/.test(html));
  check('父母集合为 父亲/母亲', /const CLOSER = \['父亲', '母亲'\]/.test(html));
  check('长辈集合为祖辈/配偶/其他', /const ELDERS = \['爷爷', '奶奶', '外公', '外婆', '配偶', '其他'\]/.test(html));
  check('非主区折叠展示', /altGroup|alt-group/.test(html) && /altBody/.test(html));
  check('折叠区默认隐藏', /id="altBody" hidden/.test(html));
  check('操作者选择未受影响', /id="operatorGrid"/.test(html) && /operatorGrid/.test(html));
  check('八个关系选项都还在', (html.match(/data-role=/g) || []).length >= 14,
    (html.match(/data-role=/g) || []).length);
  check('本人模式入口未受影响', /data-target="self"/.test(read('frontend/index.html')));
  check('回填兼容折叠区', /inAlt/.test(html) && /beneficiaryBox/.test(html));
  check('绑定覆盖两个容器', /#beneficiaryBox \.choice/.test(html));
  check('跳转契约不变（仍回family.html）', /family\.html/.test(read('frontend/index.html')));
  check('步骤条文案随入口变化', /选择长辈/.test(html));
}

console.log('== 问题3：绿智共生弱化 ==');
{
  const html = read('frontend/index.html');
  const css = read('frontend/assets/style.css');
  check('已从 topbar 移除 theme-tag', !/class="theme-tag">绿智共生/.test(html));
  check('赛事信息保留在页脚', /参赛主题 · 绿智共生/.test(html));
  check('绿智共生 仍在页面出现', /绿智共生/.test(html));
  check('页脚样式为弱提示', /\.theme-foot/.test(css) && /font-size: 11\.5px/.test(css.split('.theme-foot')[1].slice(0, 200)));
  // 产品标题应是首屏最大字号
  const heroTitle = parseFloat((css.split('.hero-title')[1] || '').match(/font-size:\s*([\d.]+)px/)?.[1] || '0');
  const footSize = parseFloat((css.split('.theme-foot')[1] || '').match(/font-size:\s*([\d.]+)px/)?.[1] || '99');
  check('「政策找人」字号 > 绿智共生字号', heroTitle > footSize * 2, heroTitle + ' vs ' + footSize);
}

console.log('== 问题4：顶部返回 = 明确父页面（不再用 history.back）==');
{
  const app = read('frontend/assets/app.js');
  check('goToParent 已定义', typeof X.goToParent === 'function');
  check('registerNavParent 已定义', typeof X.registerNavParent === 'function');
  check('resolveNavParent 已定义', typeof X.resolveNavParent === 'function');
  check('旧的 backOrFallback 已移除', typeof X.backOrFallback === 'undefined');
  check('顶部返回不再调用 history.back()',
    !/goToParent[\s\S]{0,200}history\.back\(/.test(app));
  check('顶部返回使用 location.replace（不压栈）',
    /location\.replace\(parent/.test(app));

  // 明确跳到父页面：无论历史栈多长、身后有没有记录，都去父页面
  sandbox.location.replace = function (u) { sandbox.__replaced = u; };
  sandbox.__replaced = '';
  X.goToParent('family.html');
  check('返回明确跳到父页面', sandbox.__replaced === 'family.html', sandbox.__replaced);

  // 历史栈再长也不会改道——这正是修复「来回跳」的关键
  sandbox.history.length = 99;
  sandbox.__replaced = '';
  X.goToParent('discover.html');
  check('历史栈很长时仍去父页面（不受 history.length 影响）',
    sandbox.__replaced === 'discover.html', sandbox.__replaced);

  // 父页面缺失时兜底回首页，绝不把用户弹出站点
  sandbox.__replaced = '';
  X.goToParent('');
  check('父页面缺失时兜底回首页', sandbox.__replaced === 'index.html', sandbox.__replaced);

  // 登记与解析：按页面各自记录，互不串台
  sandbox.location.pathname = '/discover.html';
  X.registerNavParent('family.html');
  check('登记的父页面可被解析',
    X.resolveNavParent('index.html') === 'family.html',
    X.resolveNavParent('index.html'));
  sandbox.location.pathname = '/policy.html';
  check('不同页面的父页面互不串台',
    X.resolveNavParent('index.html') === 'index.html',
    X.resolveNavParent('index.html'));

  // URL 上的 ?from= 优先级最高
  sandbox.location.pathname = '/discover.html';
  sandbox.location.search = '?from=self.html';
  check('?from= 参数优先于登记值',
    X.resolveNavParent('family.html') === 'self.html',
    X.resolveNavParent('family.html'));
  sandbox.location.search = '';

  check('renderTopbar 绑定返回拦截', /data-back="1"/.test(app) && /goToParent\(parentHref\)/.test(app));
  check('返回仍保留 href（可中键/无 JS 兜底）', /href="\$\{escapeHtml\(parentHref\)\}/.test(app));

  // 各页父页面声明符合层级：家庭协助/本人入口 -> 发现权益 -> 政策详情
  const fam = read('frontend/family.html');
  const disc = read('frontend/discover.html');
  const self_ = read('frontend/self.html');
  const pol = read('frontend/policy.html');
  check('家庭协助页 父页面为 index.html',
    /renderTopbar\('家庭协助', 'index\.html'/.test(fam));
  check('发现权益页 父页面为 family.html',
    /renderTopbar\('确认情况', 'family\.html'/.test(disc));
  check('本人发现页 父页面为 index.html',
    /renderTopbar\('本人权益发现', 'index\.html'/.test(self_));
  check('政策详情页 运行时把父页面改为发现权益',
    /updateTopbarParent\(backHref\)/.test(pol) &&
    /const backHref = selfMode \? 'self\.html' : 'discover\.html'/.test(pol));
}

console.log('== 问题5：详情返回恢复滚动位置 ==');
{
  check('saveListPosition 已定义', typeof X.saveListPosition === 'function');
  check('restoreListPosition 已定义', typeof X.restoreListPosition === 'function');

  sandbox.location = { search: '', href: '' };
  X.saveListPosition('gz_elderly_003');
  const saved = JSON.parse(store.pf_list_pos || '{}');
  check('记录了 policy_id', saved.id === 'gz_elderly_003', JSON.stringify(saved));
  check('记录了 scrollY', typeof saved.y === 'number');

  // 有效记录 → 返回 true 并消费掉（只恢复一次）
  let called = 0;
  sandbox.setTimeout = (f) => { if (typeof f === 'function') { called++; } return 0; };
  const r1 = X.restoreListPosition();
  check('有效记录触发恢复', r1 === true);
  check('记录只消费一次', store.pf_list_pos === undefined, store.pf_list_pos);
  check('安排了重试定位', called >= 1, called);

  // 陈旧记录（>30 分钟）→ 不恢复
  X.saveListPosition('gz_elderly_003');
  const st = JSON.parse(store.pf_list_pos);
  st.t = Date.now() - 31 * 60 * 1000;
  store.pf_list_pos = JSON.stringify(st);
  check('陈旧记录不恢复', X.restoreListPosition() === false);

  // 无记录 → 不恢复
  check('无记录时不干预', X.restoreListPosition() === false);

  // 三个页面都要调用
  ['frontend/discover.html', 'frontend/self.html'].forEach((f) => {
    const h = read(f);
    check(f + ' 进入详情前保存位置', /saveListPosition\(card\.dataset\.id\)/.test(h));
    check(f + ' 返回后恢复位置', /restoreListPosition\(\)/.test(h));
    check(f + ' 由 restorePosition 开关触发', /opts\.restorePosition/.test(h));
    check(f + ' focus 参数优先于恢复', /query\('focus'\)/.test(h));
  });
  check('详情页回跳链接保留', /fsFixScene|fsFixInfo/.test(read('frontend/policy.html')));

  const css = read('frontend/assets/style.css');
  check('刚查看政策有高亮样式', /\.result-card\.is-just-viewed/.test(css));
  check('高亮动效尊重 reduced-motion', /prefers-reduced-motion/.test(css.split('.is-just-viewed')[1] || css));
}

console.log('== 问题6：结果信息层级（本阶段只检查不改） ==');
{
  const app = read('frontend/assets/app.js');
  // 结果卡模板在 renderResultCards 里；oneCard 是它的内部函数。
  // 取 renderResultCards 起点到下一个顶层 function 之前，避免切错区间。
  const start = app.indexOf('function renderResultCards');
  const rest = app.slice(start);
  const nextTop = rest.slice(1).search(/^function /m);
  const card = nextTop > 0 ? rest.slice(0, nextTop + 1) : rest;

  // 卡片顺序：名称 → 为什么推荐 → 还需确认 → 来源 → 证据链 → 详情
  // （第七阶段已移除单卡上的 tier-strip 分层色条，改由分组标题承担，
  //   所以这里不再检查 tier-strip）
  // 只取真正拼 HTML 的模板片段（oneCard 的 return `...`），
  // 否则会误把模板之前声明的 missingHtml / sourceBlock 等变量当成渲染顺序。
  const tplAt = card.indexOf('return `');
  const tpl = tplAt >= 0 ? card.slice(tplAt) : card;

  const order = ['result-name', '为什么推荐', 'missingHtml', 'sourceBlock(r)', 'ev-toggle', 'result-foot'];
  let last = -1, ok = true, missing = [];
  order.forEach((k) => {
    const at = tpl.indexOf(k);
    if (at < 0) { missing.push(k); ok = false; }
    else if (at < last) { ok = false; }
    last = at;
  });
  check('结果卡信息层级顺序合理', ok, '缺失=' + missing.join(','));

  check('政策名称在最前',
    card.indexOf('result-name') < card.indexOf('result-meta'),
    card.indexOf('result-name') + '/' + card.indexOf('result-meta'));
  check('仍保留完整四项结构（未删功能）',
    /为什么推荐/.test(card) && /还需确认/.test(card)
    && /sourceBlock\(r\)/.test(card) && /查看详情/.test(card));
  check('来源块仍是浅蓝信任区', /is-trust/.test(app) && /政策来源/.test(app));
  check('未引入折叠/分页（本阶段不做）',
    !/加载更多|查看更多|showMore|pageSize/.test(card));
  // 第七阶段：不再「全部平铺」，但也不能丢结果——两组都要渲染进 DOM，
  // 「其他可能相关」只是默认折叠（收起状态由 CSS 控制高度，不是移除节点）。
  check('优先关注组全量渲染', /focus\.map\(oneCard\)\.join/.test(card));
  check('其他可能相关组也全量渲染（仅折叠不丢）', /others\.map\(oneCard\)\.join/.test(card));
  check('折叠区保留全部卡片节点', /more-toggle/.test(card) && /data-more-body/.test(card));
}

console.log('== 已有功能未被破坏 ==');
{
  const app = read('frontend/assets/app.js');
  ['renderProfileCard', 'renderConfirmCard', 'renderSceneSummary', 'statusBadge',
   'personalize', 'explainMissing', 'filterAnsweredMissing', 'showToast',
   'mountDemoBanner', 'mountDemoProgress', 'renderAiFlow', 'updateAiFlow',
   'renderSituationBoard', 'renderEvidenceChain', 'mountFlow', 'mountRelationStrip',
   'bindSceneChips', 'bindEvidenceToggles', 'escapeHtml', 'sourceBlock'].forEach((fn) => {
    check('保留 ' + fn, new RegExp('function ' + fn + '\\s*\\(').test(app));
  });
  check('store 接口不变', /read\(\)/.test(app) && /write\(patch\)/.test(app));
  check('API.scenes 保留', /scenes:/.test(app));
  // 数据与契约
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/guangzhou_elderly_policy_v1.1.json'), 'utf8'));
  check('政策库仍为 10 条', data.policies.length === 10, data.policies.length);
  check('政策字段未新增', Object.keys(data.policies[0]).sort().join(',') ===
    ['application_process','ai_reason','category','conditions','description','keywords',
     'life_scenes','match','missing_information','policy_id','policy_name','region',
     'risk_notice','scene_reason_map','service_note','service_type','source','target_people',
     'verification'].sort().join(','), Object.keys(data.policies[0]).sort().join(','));
}

console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);