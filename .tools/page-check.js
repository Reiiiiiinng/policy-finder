/*
 * 页面脚本静态检查：把各 HTML 里的内联 <script>抽出来做语法校验，
 * 并核对「页面调用的函数是否都在 app.js 里定义」「app.js 是否有孤儿函数」。
 * 这是在没有浏览器时能做的关键接线检查。
 *   node .tools/page-check.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'family.html', 'discover.html', 'self.html', 'policy.html'];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '');
}

console.log('== 内联脚本语法 ==');
const scripts = {};
const pageSrcs = {};
PAGES.forEach((page) => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', page), 'utf8');
  pageSrcs[page] = [...html.matchAll(/<script[^>]*\bsrc="(assets\/[^"]+)"/g)].map((x) => x[1]);
  const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) { check(page + ' 有内联脚本', false); return; }
  scripts[page] = m[1];
  try {
    new vm.Script(m[1], { filename: page });
    check(page + ' 内联脚本语法正确', true);
  } catch (e) {
    check(page + ' 内联脚本语法正确', false, e.message);
  }
});

console.log('== app.js 导出清单 ==');
const appSrc = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');
const defined = new Set();
(function collect(src) {
  const re = /^(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=|(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm;
  let m;
  while ((m = re.exec(src))) defined.add(m[1] || m[2] || m[3]);
})(appSrc);

// 公共脚本函数按“页面实际加载关系”收集（E001–E004）：
// tcb-ui.js / pf-services.js 仅 index/family/self/policy 四页加载，
// discover.html 只加载 app.js——不能并入全局 defined，否则会把
// discover 对这些函数的真实未定义调用也一并掩盖掉。
// - tcb-ui.js：顶层 function 声明即全局（无 global. 导出）。
// - pf-services.js：IIFE 内定义，页面可见的名字只有 `global.XXX =` 的导出名。
const COMMON_SCRIPT_FNS = {
  'assets/tcb-ui.js': (function () {
    const s = new Set();
    const re = /^\s*function\s+([A-Za-z_$][\w$]*)/gm;
    const src = fs.readFileSync(path.join(ROOT, 'frontend/assets/tcb-ui.js'), 'utf8');
    let m;
    while ((m = re.exec(src))) s.add(m[1]);
    return s;
  })(),
  'assets/pf-services.js': (function () {
    const s = new Set();
    const re = /global\.([A-Za-z_$][\w$]*)\s*=/g;
    const src = fs.readFileSync(path.join(ROOT, 'frontend/assets/pf-services.js'), 'utf8');
    let m;
    while ((m = re.exec(src))) s.add(m[1]);
    return s;
  })(),
};

// 注释里的 `xxx(` 不是调用（如 self.html 注释中的「benKey() 会被覆盖」）：
// 调用扫描前剥离单行/块注释；字符串与模板串用状态机保护，避免误伤内容。
function stripJsComments(src) {
  let out = '', i = 0;
  const n = src.length;
  let quote = null; // 当前所处字符串的引号；null 表示不在字符串里
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

const required = {
  // showDemoConfirm 是 index.html 自己定义的内部函数，不来自 app.js
  'index.html': ['store', 'API', 'escapeHtml'],
  'family.html': ['renderTopbar', 'mountDemoBanner', 'mountDemoProgress', 'mountFlow',
                  'mountRelationStrip', 'store', 'escapeHtml'],
  'discover.html': ['renderTopbar', 'mountDemoBanner', 'mountDemoProgress', 'mountFlow',
                    'mountRelationStrip', 'store', 'API', 'renderAiFlow', 'updateAiFlow',
                    'renderSituationBoard', 'renderResultCards', 'bindSceneChips',
                    'bindEvidenceToggles', 'showToast', 'query'],
  'self.html': ['renderTopbar', 'mountDemoBanner', 'mountFlow', 'mountRelationStrip',
                'store', 'API', 'renderAiFlow', 'updateAiFlow', 'renderSituationBoard',
                'renderResultCards', 'bindSceneChips', 'bindEvidenceToggles', 'showToast', 'query'],
  'policy.html': ['renderTopbar', 'mountDemoBanner', 'mountDemoProgress', 'mountFlow',
                  'mountRelationStrip', 'store', 'API', 'renderEvidenceChain',
                  'filterAnsweredMissing', 'personalize', 'explainMissing', 'statusBadge',
                  'renderValidityNote', 'renderThresholdNote',
                  'showToast', 'escapeHtml', 'query'],
};
Object.keys(required).forEach((page) => {
  (required[page] || []).forEach((fn) => {
    check(page + ' 需要的 ' + fn + ' 已定义', defined.has(fn), '');
  });
});

console.log('== 页面调用的自定义函数都存在 ==');
// 抓取形如 xxx(...) 的调用，排除 JS 关键字、浏览器内建、本页定义的函数与箭头函数形参
const KEYWORD = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await',
  'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'var', 'let', 'const',
  // async 可以出现在 `addEventListener('click', async () => {` 里，紧邻括号但不是函数调用
  'async', 'instanceof', 'yield',
]);
const BUILTIN = new Set([
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'console', 'parseInt', 'parseFloat', 'isNaN',
  'encodeURIComponent', 'decodeURIComponent', 'alert', 'confirm',
  'Number', 'String', 'Array', 'Object', 'JSON', 'Promise', 'Math', 'Date',
  'URL', 'URLSearchParams',
  'Boolean', 'Error', 'RegExp', 'Map', 'Set', 'Symbol', 'Proxy', 'Reflect',
]);
Object.keys(scripts).forEach((page) => {
  // 扫描前剥离注释：注释里的 `xxx(` 不是调用（self.html 的 benKey 即此类误报）
  const src = stripJsComments(scripts[page]);
  // 该页实际加载的公共脚本可见函数（discover 只加载 app.js，不在此列）
  const visible = new Set();
  (pageSrcs[page] || []).forEach((a) => {
    (COMMON_SCRIPT_FNS[a] || []).forEach((n2) => visible.add(n2));
  });
  // 本页定义的函数名 + 箭头函数形参 + 解构出来的变量名，都视为已知
  const local = new Set();
  let m;
  const fre = /function\s+([A-Za-z_$][\w$]*)/g;
  while ((m = fre.exec(src))) local.add(m[1]);
  // 函数形参：function foo(a, b) 与箭头函数 (a, b) =>，都算本页已知名字
  const pare = /function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g;
  while ((m = pare.exec(src))) {
    m[1].split(',').forEach((n) => { n = n.trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) local.add(n); });
  }
  const aore = /\(([^()]*)\)\s*=>/g;
  while ((m = aore.exec(src))) {
    m[1].split(',').forEach((n) => { n = n.trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) local.add(n); });
  }
  const are = /(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
  while ((m = are.exec(src))) {
    m[1].split(',').forEach((part) => {
      const n = part.split(':').pop().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) local.add(n);
    });
  }
  const vre = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = vre.exec(src))) local.add(m[1]);
  // 对象简写方法名
  const mre = /^\s{2,}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
  while ((m = mre.exec(src))) local.add(m[1]);

  const calls = new Set();
  const re = /(?:^|[^.\w$])([a-z_$][\w$]*)\s*\(/gim;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (KEYWORD.has(name) || BUILTIN.has(name)) continue;
    if (defined.has(name) || visible.has(name) || local.has(name)) continue;
    calls.add(name);
  }
  check(page + ' 无未定义函数调用', calls.size === 0, [...calls].join(', '));
});

console.log('== 产品红线扫描（页面文案）==');
// 关键点：必须识别否定语境。「不代办」「不作为资格认定」是合规表述，
// 只看关键词会把正确的免责声明误判成违规。
const FORBIDDEN = [
  [/(?:已获|经)?(?:政府|官方)(?:认证|授权|背书)/, '伪造政府认证'],
  [/(?<!不)(?<!未)(?:自动办理|一键办理|帮您(?:办|申请)|代为办理)/, '暗示代办能力'],
  [/保证(?:您|能|可以)?(?:符合|享受|获得|一定能)/, '政策保证'],
  [/全国(?:均)?覆盖|已覆盖全国|各地均已/, '全国覆盖宣称'],
  [/(?<!不)(?<!不代表)(?<!不作为)符合资格(?![。！])/, '资格认定'],
  [/已(?:为您)?(?:办理|申请|提交)(?:成功|完成)/, '伪造办理结果'],
];
// 否定前缀保护：命中前若同句含这些词，视为合规表述
const NEG = /(不|未|无|非|不会|不代表|不作为|不代办|仅)/;

PAGES.forEach((page) => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', page), 'utf8');
  const text = stripTags(html) + ' ' + (scripts[page] || '');
  // 逐句扫描，句中出现否定词则跳过
  const sentences = text.split(/[。！？\n<>]/);
  const hits = [];
  FORBIDDEN.forEach(([re, name]) => {
    sentences.forEach((s) => {
      if (re.test(s) && !NEG.test(s)) hits.push(name + '→' + s.trim().slice(0, 50));
    });
  });
  check(page + ' 无红线文案', hits.length === 0, hits.join(' | '));
});

console.log('== 免责与来源标注存在性 ==');
PAGES.forEach((page) => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', page), 'utf8');
  const text = stripTags(html) + ' ' + (scripts[page] || '');
  // 每个页面都应至少有一句明确的免责/定位表述
  check(page + ' 保留免责声明',
    /(不代表|不作为|不代表已符合)/.test(text)      // 不代表资格
    || /初步匹配|初步提示/.test(text)                    // 初步匹配定位
    || /仅用于提示/.test(text)
    || /不代办/.test(text),
    '');
});
{
  const pol = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');
  check('详情页保留来源待核验字样', /来源待核验/.test(pol));
  check('详情页保留不代为填写/列出',
    /不代为填写/.test(pol) || /不代为列出/.test(pol) || /不代为列明/.test(pol));
  check('详情页保留仅提示定位',
    /仅提示可能相关的权益|不代表已符合资格/.test(stripTags(pol)));
}

console.log('== 关键交互元素存在性 ==');
const disc = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');
check('发现页有 textarea#situation', /id="situation"/.test(disc));
check('发现页有 #resultArea', /id="resultArea"/.test(disc));
check('发现页绑定 scene chip', /bindSceneChips/.test(disc));
check('发现页处理 focus 参数', /applyFocus/.test(disc));

const pol = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');
check('详情页有第4步进一步确认', /进一步确认|renderFinalStep/.test(pol));
check('详情页有去哪里核实', /去哪里核实/.test(pol));
// B 版详情为单页连续五问（q1-q5 id 锚点供收藏/定位使用），不再拆标签页
check('详情页五问单页连续编号 1-5',
  /qBlock\(1, '这是什么？'/.test(pol) && /qBlock\(2, '为什么推荐给您？'/.test(pol)
  && /qBlock\(3, '还需要确认什么？'/.test(pol) && /qBlock\(4, '去哪里核实？'/.test(pol)
  && /qBlock\(5, '怎么办理？'/.test(pol));
check('详情页保留来源信任卡', /trust-card/.test(pol));
// P1：出门前清单的 B 版承载：consult 页「咨询时建议问清这四件事」，
// 每条都要给到可执行的问询内容，而不是只剩标题。
const consTop = fs.readFileSync(path.join(ROOT, 'frontend/consult.html'), 'utf8');
check('咨询页四件事结构完整（覆盖范围/申请入口/所需材料/适用标准）',
  /咨询时建议问清这四件事/.test(consTop)
  && (consTop.match(/class="where-row"/g) || []).length === 4
  && /① 覆盖范围/.test(consTop) && /② 申请入口/.test(consTop)
  && /③ 所需材料/.test(consTop) && /④ 适用标准/.test(consTop));
check('咨询四件事每条给出可执行的问询内容',
  (consTop.match(/wr-v">[^<]{12,}</g) || []).length === 4);
check('清单声明以主管部门答复为准', /以主管部门答复为准/.test(consTop));
check('低碳语义落在减少往返（少跑腿）上',
  /少跑腿/.test(fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8'))
  && !/电子化|无纸化|更环保|减少碳排放/.test(consTop));
check('咨询页声明不代办且给官方渠道',
  /不代办/.test(consTop) && /不代填/.test(consTop)
  && /不构成政策解释或资格认定/.test(consTop)
  && /consult-official-link/.test(appSrc));
check('详情页保留 to_verify 提示', /来源待核验/.test(pol));

// P2：B 版首屏为欢迎区（home-hello 一句话 + 副标题），替代 partner 的 hero-def。
{
  const idx = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  const helloSub = (idx.match(/<p class="home-hello-sub">([\s\S]*?)<\/p>/) || [])[1] || '';
  check('首屏有一句话产品说明', stripTags(helloSub).trim().length > 0);
  check('产品说明讲机制而非功能罗列',
    /发现/.test(helloSub) && /政策/.test(helloSub) && /可能相关/.test(idx));
  check('首页四个服务入口各有真实说明',
    /发现相关政策/.test(idx) && /政策解读/.test(idx)
    && /办理指引/.test(idx) && /我的权益/.test(idx)
    && (idx.match(/t-sub">[^<]+</g) || []).length >= 4);
  check('宫格副标题说明各入口用途',
    /描述生活变化，开始初步匹配/.test(idx)
    && /依据与解读详见每条权益的详情页/.test(idx)
    && /办理流程与官方渠道详见详情页/.test(idx));
  check('欢迎说明区在服务入口之前',
    idx.indexOf('home-hello') >= 0 && idx.indexOf('home-hello') < idx.indexOf('hg-tile'));
}

// P5：原创视觉母题「一线」——必须有可复用的实现，且真的用在 ≥3 个界面位置上。
{
  const app = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');
  const css0 = fs.readFileSync(path.join(ROOT, 'frontend/assets/style.css'), 'utf8');
  check('母题有独立渲染函数', /function renderThread\s*\(/.test(app));
  check('母题形状由 CSS 承载而非图片',
    /\.th-path/.test(css0) && /border-top:\s*1\.5px dashed/.test(css0) && !/\.thread[^{]*\{[^}]*url\(/.test(css0));
  // ≥3 个界面：首页首屏、详情页首块、证据链顶部
  check('母题用在证据链顶部', /renderThread\(clueText/.test(app) && /thread-head/.test(app));
  // B 版 theme-cb 有自己的视觉骨架：首页 hello+宫格、详情页标题行+星标。
  check('首页使用 theme-cb 视觉骨架（hello+宫格）',
    /home-hello/.test(fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8'))
    && /hg-tile/.test(fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8')));
  check('详情页首块使用 tc-title-row 标题行',
    /tc-title-row/.test(fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8')));
  check('母题至少出现在 3 个渲染点',
    (app.match(/renderThread\(/g) || []).length
      + (fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8').match(/renderThread\(/g) || []).length
      + (fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8').match(/renderThread\(/g) || []).length >= 3,
    'n=' + (app.match(/renderThread\(/g) || []).length);
  check('母题不用外链图片或字体图标',
    !/renderThread[\s\S]{0,400}<img/.test(app));
  check('母题不缺一端就画半条线', /if \(!c \|\| !r\)/.test(app));
}

check('详情页返回区分本人/家庭模式', /backHref = selfMode \? 'self\.html' : 'discover\.html'/.test(pol));

console.log('== CSS 变量与类名一致 ==');
const css = fs.readFileSync(path.join(ROOT, 'frontend/assets/style.css'), 'utf8');
['.flow', '.flow-step', '.flow-dot', '.board', '.scene-chip', '.tier-head', '.tier-head.is-focus',
 '.result-summary', '.more-group', '.more-toggle', '.more-body', '.more-inner',
 '.evidence', '.ev-step', '.ev-cond', '.final-step', '.fs-opt', '.where-row', '.rel-strip',
 '.how-card', '.step-lead',
 '.policy-validity-warn', '.policy-validity-muted',
 '.policy-threshold-note', '.policy-threshold-note.is-hit'].forEach((sel) => {
  check('CSS 定义 ' + sel, css.indexOf(sel) >= 0);
});

console.log('== 步骤指示单一数据源（P4）==');
{
  // 顶栏「第 N 步」曾经是页面里写死的文案，与进度条各说各话。
  // 现在只允许 mountFlow 一处写入，页面不得再传步骤字面量。
  PAGES.forEach((page) => {
    const s = scripts[page] || '';
    const m = s.match(/renderTopbar\([^;\n]*第\s*[0-9一二三四]\s*步/);
    check(page + ' 不向前顶栏传死步骤文案', !m, m && m[0].slice(0, 60));
  });
  check('mountFlow 内同步顶栏徽章',
    /function mountFlow[\s\S]*?syncFlowStepBadge\(/.test(appSrc));
  check('顶栏徽章由 syncFlowStepBadge 创建',
    /function syncFlowStepBadge[\s\S]*?data-step-badge/.test(appSrc));
  check('流程条带 data-flow-current', /data-flow-current=/.test(appSrc));
  check('步骤文案只由 flowStepText 生成',
    (appSrc.match(/['"]第\s*['"]\s*\+\s*n/g) || []).length >= 1);
  // policy 页身份是阶段 3：渲染完成后不得再跳到第 4 步
  const polSrc = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');
  check('详情页不再渲染后跳到第 4 步', !/mountFlow\(\s*4\s*\)/.test(polSrc));
  check('详情页保留阶段 3', /mountFlow\(3\)/.test(polSrc));
}

console.log('== 两个判断维度分离（P7-A）==');
{
  // 匹配层（可能相关）与来源层（已核验）不是一个维度，不得用同款药丸并排
  check('statusBadge 不再输出并排药丸',
    !/badge \$\{cls\}[\s\S]{0,200}badge pending/.test(appSrc));
  check('两个维度各带维度名',
    /axis-k">匹配/.test(appSrc) && /axis-k">来源/.test(appSrc));
  check('app.js 用 renderAxes', /function renderAxes/.test(appSrc));
  const polSrc = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');
  // B 版详情状态走 tc-status 体系，核验状态有意保留统一 badge 徽标
  check('详情页顶部有 tc-status 状态区', /tc-status/.test(polSrc));
  check('详情页核验状态使用统一 badge 徽标',
    /badge pending">待核实/.test(polSrc)
    && /badge verified">✓ 来源已核验/.test(polSrc));
  check('证据链来源核验不再用 badge 药丸',
    !/badge verified">✓ 已核验/.test(appSrc) && /cite-state is-verified/.test(appSrc));
  [
    '.tag-col', '.step-tag',
    '.axes', '.axis', '.axis-k', '.axis-v', '.axis-v.is-maybe', '.axis-v.is-confirm',
    '.axis-v.is-verified', '.axis-v.is-pending', '.cite-state',
  ].forEach((sel) => {
    check('CSS 定义 ' + sel, css.indexOf(sel) >= 0);
  });
  check('CSS 里来源层与匹配层不同形',
    /\.axis-v\.is-verified,/.test(css) && /\.axis-v\.is-maybe \{/.test(css));
}

console.log('== 全局一致性（P7-B）==');
{
  const polSrc = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');
  const disSrc = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');
  const selSrc = fs.readFileSync(path.join(ROOT, 'frontend/self.html'), 'utf8');
  const famSrc = fs.readFileSync(path.join(ROOT, 'frontend/family.html'), 'utf8');

  // 导航语言：返回类动作用「返回」，不再混用「回去」
  const allVisible = [polSrc, disSrc, selSrc, famSrc, appSrc].join('\n');
  check('返回类文案统一用「返回」', !/回去(调整|补充|选择|看看)/.test(allVisible));
  check('详情页回跳按钮用「返回」', /id="fsFixScene">返回调整/.test(polSrc) && /id="fsFixInfo">返回补充/.test(polSrc));
  check('顶栏返回文案统一', /← 返回<\/a>/.test(appSrc));

  // 触达面积：可点控件的 min-height 不得低于 48px
  const smallTargets = [
    ['reason-more', /\.reason-more \{[\s\S]{0,320}?min-height:\s*48px/],
    ['rc-fold-sum', /\.rc-fold-sum \{[\s\S]{0,320}?min-height:\s*48px/],
    ['ev-toggle', /\.ev-toggle \{[\s\S]{0,320}?min-height:\s*48px/],
    ['more-toggle', /\.more-toggle \{[\s\S]{0,400}?min-height:\s*48px/],
    ['alt-toggle', /\.alt-toggle \{[\s\S]{0,320}?min-height:\s*48px/],
    ['bc-btns .btn', /\.bc-btns \.btn \{[\s\S]{0,160}?min-height:\s*48px/],
    ['fs-again .btn', /\.fs-again \.btn \{[\s\S]{0,160}?min-height:\s*48px/],
    ['demo-banner-reset', /\.demo-banner-reset \{[\s\S]{0,400}?min-height:\s*48px/],
    ['.btn', /\.btn \{[\s\S]{0,320}?min-height:\s*56px/],
    ['.choice', /\.choice \{[\s\S]{0,320}?min-height:\s*56px/],
  ];
  smallTargets.forEach(([name, re]) => check('触达面积 ' + name + ' ≥48px', re.test(css)));

  // 触达面积不能用伪元素假装：文字链也必须撑起真实盒高
  check('文字链不靠伪元素撑命中区',
    !/\.reason-more::after/.test(css) && !/\.fs-clear::after/.test(css));

  // 按钮主次：主按钮用 .btn，次要用 .btn.ghost，四页都只用这两套
  check('按钮只有主次两套语义',
    !/class="btn (primary|secondary|danger)"/.test(allVisible));
  check('次按钮统一用 ghost', /\.btn\.ghost \{/.test(css));

  // 间距节奏：卡片内边距与区块间距来自同一组变量
  check('间距走变量而非散落魔数',
    /--radius-sm:/.test(css) && /\.result-card \{[\s\S]{0,200}?padding:\s*16px/.test(css));

  // 状态标签尺寸：两维度同名同尺寸，颜色语义唯一。
  // 字号锁的是「不小于 12px」——11px 对长辈偏小，「匹配／来源」又是
  // 区分两个判断维度的关键词，读不清就看不出这是两层判断。
  // P0-1 后全站字号走 6 档令牌，axis 维度名落在 caption 档（12.5px ≥ 12px）。
  check('状态标签字号统一且不小于 12px',
    /\.axis-k \{[\s\S]{0,240}?font-size:\s*(1[2-9](\.\d+)?px|var\(--fs-caption\))/.test(css));
}

console.log('== UI 重构（按设计参考图） ==');
{
  // 注意：本文件没有 read() 助手，统一用 fs.readFileSync + ROOT
  const app = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');
  const disc = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');
  const pol = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');

  // 结果页页头：匹配完成后才出现，返回键回到描述区而不是上一页
  check('结果页有独立页头', /id="resultHead"/.test(disc) && /class="page-head"/.test(disc));
  check('页头默认隐藏，匹配完才显形', /setResultHead\(true\)/.test(disc) && /\.page-head\[hidden\]/.test(css));
  check('页头返回键命中区 48px', /\.ph-back \{[\s\S]{0,400}?position:\s*relative/.test(css)
    && /\.ph-back::after \{[\s\S]{0,80}?inset:\s*-4px/.test(css));

  // 计数行 + 分段标签：先给总数，再拆成待核验/已核验/信息待补充
  check('结果区有总数与三段计数', /共找到 \$\{list.length\} 条可能相关的政策/.test(app)
    && /待核验/.test(app) && /已核验/.test(app) && /信息待补充/.test(app));
  check('分段标签是同一条列表的定位，不是过滤',
    /scrollIntoView|resultAnchor/.test(app) && /\.seg\.is-on/.test(css));

  // 卡面：推荐给谁 + 符合度，理由摘要一句
  check('卡面标出推荐给谁与符合度', /rc-whofit/.test(app) && /rc-fit/.test(app) && /rc-brief/.test(app));
  check('符合度只展示可计算的百分比，不算出来就不显示',
    /符合度/.test(app) && /rc-fit/.test(app) && /rc-fit-v/.test(app)
    && /\$\{pct\}%/.test(app)
    && /title="同批结果内的相对参考分，不是资格概率"/.test(app));

  // 详情页标题行为 tc-title-row（h2 + 收藏星标），右侧附注语义由 tc 体系承载
  check('详情页标题行含收藏星标（tc-title-row）',
    /tc-title-row/.test(pol) && /dhead-save/.test(pol));
  check('详情页附注用竖线语言', /\.dhead-side \{[\s\S]{0,320}?border-left:\s*3px/.test(css));

  // 母题连线：线索让位给权益名，不在中间截断
  check('详情页母题线索让位给权益名',
    /\.detail-thread \.th-clue \{[\s\S]{0,200}?max-width:\s*42%/.test(css)
    && /\.detail-thread \.th-right \{[\s\S]{0,200}?flex:\s*1 1 auto/.test(css));
  // 首页：服务入口指向已有能力，收藏区没有条目不出现
  const idx = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  // B 版首页为 hg-tile 四宫格（发现相关政策 / 政策解读 / 办理指引 / 我的权益），
  // E031 后四个入口全部有真实点击行为。
  check('首页有服务入口四项', (idx.match(/class="hg-tile[ "]/g) || []).length === 4
    && /发现相关政策/.test(idx) && /政策解读/.test(idx)
    && /办理指引/.test(idx) && /我的权益/.test(idx));
  check('服务入口都有真实点击行为',
    /getElementById\('tileMatch'\)\.addEventListener/.test(idx)
    && /querySelectorAll\('\.hg-tile\.is-todo'\)\.forEach/.test(idx)
    && /getElementById\('tileMine'\)\.addEventListener/.test(idx));
  check('首页不再承载收藏（收藏已并入我的服务）',
    !/pf_saved/.test(idx) && /tileMine/.test(idx));

  // 详情页：收藏星标 + 底部动作条
  check('详情页标题行有收藏星标', /class="dhead-save"/.test(pol) && /aria-pressed="false"/.test(pol));
  // 收藏读写统一走 PFServices 公共接口；页面不得直接读写裸键 pf_saved
  const svcSrc = fs.readFileSync(path.join(ROOT, 'frontend/assets/pf-services.js'), 'utf8');
  const tcbCss = fs.readFileSync(path.join(ROOT, 'frontend/assets/tcb.css'), 'utf8');
  check('收藏只存 id/名称/部门，不存个人信息',
    /PFServices\.toggleFavorite\(/.test(pol)
    && /id: pid/.test(pol) && /name: pol\.policy_name/.test(pol)
    && !/age:|beneficiary:|idcard/i.test((pol.split('function bindSave')[1] || '').slice(0, 4000)));
  check('B 版收藏读写走命名空间键 pf_saved_b（公共层统一实现，A/B 隔离）',
    /localStorage\.setItem\(K\.savedNs/.test(svcSrc)
    && /savedNs:\s*'pf_saved_' \+ NS/.test(svcSrc)
    && !/setItem\('pf_saved'/.test(svcSrc)
    && !/getItem\('pf_saved'/.test(svcSrc)
    && !/localStorage\.[gs]etItem\('pf_saved'/.test(pol));
  check('B 版星标触控区 44px（tcb.css，含 is-on 选中态）',
    /\.dhead-save \{[\s\S]{0,200}?width:\s*44px/.test(tcbCss)
    && /\.dhead-save\.is-on/.test(tcbCss));

  // 结果页：首卡「推荐度高」书签只标一张
  check('首张卡片有推荐度高书签',
    /lead: i === 0/.test(app) && /rc-tier/.test(app) && /推荐度高/.test(app));
  // 分段标签四段都必须有真实落点（曾有三个 href 指向不存在的 id，点了不滚动）
  // 待核验/已核验两组的锚点由模板拼出（id="seg-${key}"），静态锚点是 seg-all 与 seg-needinfo
  check('四个分段各有对应锚点',
    /id="seg-all"/.test(app) && /id="seg-needinfo"/.test(app)
    && /id="seg-\$\{key\}"/.test(app)
    && /verListHtml\(\s*verPending, .pending./.test(app)
    && /verListHtml\(\s*verVerified, .verified./.test(app));
  check('分段 href 与锚点一一对应',
    /href="#seg-\$\{s\.key\}"/.test(app));
  check('计数为 0 的分段降级为不可点',
    /is-empty/.test(app) && /aria-disabled="true"/.test(app)
    && /\.seg\.is-empty/.test(css));
  check('分段不是过滤，列表一条不少',
    /列表内容一条不少/.test(app) && /不是过滤/.test(app));}

console.log('== 底部一级导航与新增一级页 ==');
{
  const app = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');
  const pol = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');
  // 「我的」服务中心已统一为 services.html；mine.html 降级为无脚本兼容中转页
  const mine = fs.readFileSync(path.join(ROOT, 'frontend/mine.html'), 'utf8');
  const svc = fs.readFileSync(path.join(ROOT, 'frontend/services.html'), 'utf8');
  const cons = fs.readFileSync(path.join(ROOT, 'frontend/consult.html'), 'utf8');
  const idx2 = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  const disc2 = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');

  // 一级页导航挂载：theme-cb 各页走 mountBottomNav，discover（partner 皮肤）走 mountTabbar，
  // mine.html 已降级为无脚本兼容中转页，不再挂导航
  check('一级页导航挂载方式与整合后结构一致',
    /mountBottomNav\('home'\)/.test(idx2) && /mountTabbar\('discover'\)/.test(disc2)
    && /mountBottomNav\('consult'\)/.test(cons)
    && !/mountTabbar\(|mountBottomNav\(/.test(mine));
  // 本人页是带导航的二级页：漏掉这一步，用户进到本人模式后就点不回发现页或我的页。
  // 底部导航没有「本人」这一栏，本人发现同属发现权益，因此高亮「发现」。
  const selfSrc3 = fs.readFileSync(path.join(ROOT, 'frontend/self.html'), 'utf8');
  check('本人页也挂了底部导航（高亮发现）',
    /mountBottomNav\('discover'\)/.test(selfSrc3));
  check('导航项与页面一一对应',
    /key: 'home',[\s\S]{0,80}href: 'index\.html'/.test(app)
    && /key: 'discover',[\s\S]{0,80}href: 'discover\.html'/.test(app)
    && /key: 'consult',[\s\S]{0,80}href: 'consult\.html'/.test(app)
    && /key: 'mine',[\s\S]{0,80}href: 'services\.html'/.test(app));
  check('当前页用 aria-current 标注',
    /aria-current="page"/.test(app) && /is-on/.test(app));

  // 遮挡由布局解决：body 加类，CSS 给正文留空间，不靠各页自己记得加 padding
  check('导航遮挡由布局解决',
    /classList\.add\('has-tabbar'\)/.test(app)
    && /body\.has-tabbar \.app \{[\s\S]{0,120}?padding-bottom: calc\(76px/.test(css));
  check('导航固定且有安全区内边距',
    /\.tabbar \{[\s\S]{0,200}?position: fixed/.test(css)
    && /padding-bottom: env\(safe-area-inset-bottom\)/.test(css));
  check('导航每项触达不小于 48px',
    /\.tb-item \{[\s\S]{0,300}?min-height: 52px/.test(css));

  // 详情页是二级页：不挂导航，但要从收藏入口返回时回「我的」
  check('详情页不挂底部导航', !/mountTabbar\(/.test(pol));

  // 空状态：没查过就说没查过，不预置任何结果
  check('发现页有未查询空状态', /还没有发现结果/.test(disc2) && /esStart/.test(disc2));
  check('我的服务页空收藏与空查询都如实说明',
    /还没有收藏/.test(svc) && /还没有查询过/.test(svc));
  check('我的服务页读的是同一份收藏（PFServices 公共接口，pf_saved_b，与详情页同源）',
    /PFServices\.readFavorites\(\)/.test(svc) && /PFServices\.(readFavorites|isFavorite|toggleFavorite)/.test(pol)
    && /function readFavorites/.test(fs.readFileSync(path.join(ROOT, 'frontend/assets/pf-services.js'), 'utf8')));
  check('旧 mine.html 是无脚本兼容中转页（链接到我的服务，不再读写数据）',
    /href="services\.html"/.test(mine) && /进入我的服务/.test(mine)
    && !/pf_saved/.test(mine) && !/<script/.test(mine));
  check('咨询页不编造热线号码',
    /不提供在线咨询、不代办、不代填/.test(cons) && !/0\d{2,3}-\d{7,8}/.test(cons));
  // /api/policies 列表不含 source，直接用它会全部落到兜底文案「主管部门」，
  // 看起来像 10 条政策只有 1 个部门。部门必须从详情接口取。
  // 服务入口四格必须真的把用户送到那个功能上。
  // 三格曾经只是 scrollIntoView 回入口区（等于点了没反应），
  // 「我的收藏」更是在没收藏时整块隐藏，锚点滚不到任何东西。
  check('服务入口四格各有真实落点',
    /discoverRouteTarget\(\)/.test(idx2) && /pf_svc_intent/.test(idx2)
    && /location\.href = 'services\.html'/.test(idx2));
  check('「我的权益」直达我的服务页', /id="tileMine"/.test(idx2)
    && /services\.html/.test(idx2));
  check('解读与指引送到发现页并消费 intent',
    /pf_svc_intent/.test(idx2) && /function applyServiceIntent/.test(disc2)
    && /sessionStorage\.removeItem\('pf_svc_intent'\)/.test(disc2));
  check('部门取自详情接口而非列表接口',
    /API\.policy\(id\)/.test(cons) && /detail\.source/.test(app)
    && !/\(p\.source \|\| \{\}\)/.test(cons));

  // ---- 整体检查（第二轮实测发现并修掉的缺陷，逐条防回归）----
  const selfSrc2 = fs.readFileSync(path.join(ROOT, 'frontend/self.html'), 'utf8');
  // 1) 核验状态在 verification.status，source 里没有 pending 字段。
  //    读不存在的字段得到 undefined，会让整库都被算成「已核验」（实测 10/0，真值 8/2）。
  check('咨询页核验计数读 verification.status',
    /function consultVerification\(/.test(app)
    && /detail\.verification && detail\.verification\.status/.test(app)
    && /consultVerification\(detail\)/.test(app)
    && !/src\.pending/.test(cons));
  // 2) 分段点击后高亮必须跟随。停在「全部」会让用户以为筛选没生效。
  check('分段高亮跟随点击', /function bindSegments/.test(app)
    && /classList\.toggle\('is-on'/.test(app));
  check('发现页与本人页都绑定结果分组', /bindResultGroups\(\)/.test(disc2) && /bindResultGroups\(\)/.test(selfSrc2));
  // 3) 收藏行的「取消收藏」不能嵌在 <a> 里：HTML 不允许交互内容嵌在链接内。
  check('收藏行链接与按钮并列不嵌套（services sv-row）',
    /<div class="sv-row"/.test(svc) && /'<a href="policy\.html\?id='/.test(svc)
    && /data-act="unfav"/.test(svc));
  // 4) 底部动作条不能用负外边距向外撑：父容器内边距为 0 时会顶出 16px 横向滚动。
  const dockCss = (css.match(/\.dock \{[\s\S]*?\n\}/) || [''])[0];
  check('底部动作条不靠负外边距铺满',
    dockCss && /margin: 0;/.test(dockCss) && !/margin: 0 -16px/.test(dockCss));
  // 5) 收起的分组高度为 0，但里面的链接与按钮仍在 Tab 顺序里，
  //    键盘用户会跳进一片看不见的区域。收起时必须 inert。
  check('收起的分组移出焦点与无障碍树',
    /body\.setAttribute\('inert', ''\)/.test(app) && /body\.removeAttribute\('inert'\)/.test(app));

  // ---- 04 咨询与核实 / 05 我的（按 v14 原型这���屏重做）----
  // 「您可能想了解」曾经是三行纯文字，点了没有任何反应。
  // 现在三条各自就地展开答案：用户在这一页问的，答案要落回这一页。
  check('咨询页开头给出诚实能力边界',
    /不提供在线咨询、不代办、不代填/.test(cons) && /不补造信息/.test(cons));
  check('咨询目录给出真实统计口径',
    /consult-summary/.test(app) && /consult-failure/.test(app)
    && /分属 <b>/.test(app));
  // 出门前准备三项是产品主张（少跑一趟）的落点，不能只剩一句口号。
  check('咨询页有按部门分组的政策目录',
    /consult-dept/.test(app) && /consult-policy/.test(app)
    && /consult-official-link/.test(app) && /consult-link-missing/.test(app)
    && /renderConsultDirectory\(/.test(cons));
  // 通用四问必须与详情页「要问清的问题」同源，而不是另编一套。
  // 两页措辞略有出入（详情页是列表项、咨询页是问句），比对的是同一组要点。
  check('咨询页四件事与详情页核实/办理信息语义对应',
    /① 覆盖范围/.test(cons) && /② 申请入口/.test(cons)
    && /③ 所需材料/.test(cons) && /④ 适用标准/.test(cons)
    && /去哪里核实/.test(pol) && /怎么办理/.test(pol));

  // 「我的家庭」只显示本次真实涉及的家人。预置父亲/母亲这类没发生过的成员
  // 会让用户以为自己填过，属于编造事实。
  check('我的家庭不预置没发生过的成员',
    !/父亲（67岁）|母亲（64岁）/.test(svc)
    && /store\.read\(\)/.test(svc) && /添加家人/.test(svc));
  // 产品没有账号体系，就不能摆一个点了没反应的「立即登录」。
  // 只看 HTML 里的按钮文字，不看注释——注释里提到这几个字是为了解释为什么不做。
  check('我的服务页不摆假登录入口',
    !/>\s*(立即登录|去登录|登录)\s*</.test(svc) && /无需登录/.test(svc));
  // 服务入口必须都是真实可点的按钮（五个入口含咨询），不允许占位。
  check('我的服务入口都是真实可点的按钮',
    (svc.match(/class="vf-entry"/g) || []).length === 5
    && /entConsult'\)\.addEventListener/.test(svc));
  check('关于我们默认收起且可展开',
    /id="svcAboutHead"[^>]*aria-expanded="false"/.test(svc)
    && /id="svcAboutBody"[^>]*hidden/.test(svc) && /aria-controls="svcAboutBody"/.test(svc));
  // 收藏与本次查询都要能清空，且清空只清本机。
  check('我的服务页能清空本次查询（不动重置会话）',
    /id="qNowClear"/.test(svc) && /store\.write\(\{ profile: \{\}, text: '' \}\)/.test(svc));
  check('取消收藏只删这一条不跳页（services 委托处理）',
    /x\.id !== id/.test(svc) && /data-act="unfav"/.test(svc)
    && !/localStorage\.setItem\('pf_saved'/.test(svc));

  // ---- 连点两次的竞态（实测复现过，两处都要守住）----
  // 1) 场景 chip 的集合必须以 store 里最新的为准。连点两个 chip 时，
  //    第二次点击发生在结果重渲染之前，用渲染时的 base 会把前一次的新增算掉。
  const chipFn = (app.match(/function bindSceneChips[\s\S]*?\n\}/) || [''])[0];
  // 断言守的是「每次点击都重新读 store」，不是「必须读 profile 这个键」：
  // 本人页把资料存 selfProfile，写死 profile 会让它退回渲染快照，
  // 连点时前一次的选择照样被吃掉。所以这里要求有 profileKey 的分支读取。
  check('场景 chip 读最新 profile 而非渲染时的快照',
    /store\.read\(\)\[profileKey\]/.test(chipFn) && /const latest =/.test(chipFn)
    && !/\(base\.scenes \|\| \[\]\)\.concat/.test(chipFn));
  check('场景 chip 按当前页的存储键取最新值',
    /const profileKey = .*__profileKey.*\|\| 'profile'/.test(chipFn));
  // 本人页必须把自己那一个键传给公共逻辑，否则上面那条分支永远走不到 selfProfile。
  check('本人页告知公共逻辑从 selfProfile 取最新值',
    /__profileKey: 'selfProfile'/.test(selfSrc2));
  // 2) 匹配结果是异步的，慢请求后到会盖掉新结果。序号必须在任何 await 之前领，
  //    并在写 store / 渲染之前认领；只拦渲染不够。
  for (const [name, src] of [['发现页', disc2], ['本人页', selfSrc2]]) {
    const fn = (src.match(/async function runMatch[\s\S]*?\n  \}/) || [''])[0];
    // 只看真正的 await 语句，函数题目注释里也出现了「await」字样，不能当锚点。
    const firstAwait = fn.search(/^\s*(const|let|data|await)\b[^\n]*\bawait\s+API/m);
    check(name + '的匹配请求有序号认领',
      /const (?:mySeq|requestId) = beginMatchRequest\(\)/.test(fn)
      && /if \(!isLatestMatchRequest\((?:mySeq|requestId)\)\) return;/.test(fn)
      && (fn.match(/isLatestMatchRequest\(/g) || []).length >= 3
      && firstAwait > 0
      && fn.indexOf('beginMatchRequest()') < firstAwait);
  }
  check('序号机制定义在公共脚本里',
    /let MATCH_REQUEST_SEQ = 0/.test(app) && /function beginMatchRequest/.test(app)
    && /function isLatestMatchRequest/.test(app));
}

/* ---- 描述自相矛盾时要把矛盾摆到界面上 ---- */
{
  // 末段作用域里拿不到前面的局部变量，就近重读一次
  const app = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'frontend/assets/style.css'), 'utf8');
  check('公共脚本读取矛盾字段',
    app.indexOf('profile.conflicts') >= 0 && app.indexOf('board-conflict') >= 0);
  check('矛盾提示说明不替用户裁决',
    app.indexOf('这一次我们不会替您挑一句') >= 0, '缺少「不替您挑一句」的说明');
  check('矛盾提示排在基础事实之前',
    app.indexOf('${conflictsHtml}') > 0
      && app.indexOf('${conflictsHtml}') < app.indexOf('${factsHtml}'),
    'conflictsHtml=' + app.indexOf('${conflictsHtml}') + ' factsHtml=' + app.indexOf('${factsHtml}'));
  check('矛盾条目转义后再插入',
    app.indexOf('.map(escapeHtml)') >= 0 && app.indexOf('escapeHtml(c.note') >= 0);
  check('矛盾样式已定义', css.indexOf('.board-conflict') >= 0);

  // 两个查询入口必须走同一套矛盾检测：都调 renderSituationBoard、都把整个 profile 交给它。
  // 一旦有人给某一页另写一份提示组件，规则就会分叉。
  const discSrc = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');
  const selfSrc = fs.readFileSync(path.join(ROOT, 'frontend/self.html'), 'utf8');
  check('发现页把画像交给公共确认台',
    /renderSituationBoard\(data\.profile,\s*data\.scene_library/.test(discSrc));
  check('本人页把画像交给公共确认台',
    /renderSituationBoard\(data\.profile,\s*data\.scene_library/.test(selfSrc));
  check('本人页没有另写一份矛盾提示',
    selfSrc.indexOf('board-conflict') < 0 && selfSrc.indexOf('conflicts') < 0,
    '本人页不应自带矛盾提示实现，否则两页规则会分叉');
  check('公共确认台是矛盾提示的唯一实现',
    (app.match(/class="board-conflict"/g) || []).length === 1);

  // 本人页的矛盾提示要跟着输入走：改描述、再点一次匹配，提示必须能出现、能消失、能再出现。
  // 它之所以能同步，是因为确认台每次都拿这次的 profile 重渲染，没有缓存上一次的结论——
  // 一旦有人给它加缓存，或者把提示挂在一次性节点上，就会出现「改好了提示还留着」。
  check('确认台每次按本次画像重渲染矛盾提示',
    /const conflictsHtml = .*conflicts/.test(app)
      || /conflictsHtml.*=.*conflicts/.test(app),
    '矛盾提示应由本次 profile 重新计算，不能缓存');
  check('本人页重匹配后重新绑定，不残留上一次的提示',
    /function bindAll\(data\)/.test(selfSrc) && /renderSituationBoard/.test(app));
  // 引擎侧要真的会把「被否定」和「已经过去」的说法排除掉，
  // 否则界面上守住了，数据源仍然是错的。
  check('矛盾检测排除被否定的说法',
    app.indexOf('_negated') >= 0 || fs.readFileSync(path.join(ROOT, 'backend/policy_engine.py'), 'utf8')
      .indexOf('not _negated(text, w)') >= 0);

  // 详情页要判断「这次是不是本人模式」，靠的是当前生效的查询模式。
  // 两个键（profile / selfProfile）可能同时存在：先做过家庭查询、又做过本人查询，
  // 或者反过来。任何「按存储顺序取值」的写法都被劫持过：
  //   profile || selfProfile  —— 家庭画像劫持本人模式的返回目标（实测复现）；
  //   selfProfile 无条件优先 —— 残留的本人画像劫持家庭模式的详情页。
  // 现行实现：匹配成功时写入 lastQuery，读取侧用 activeQueryMode() 先定模式再取键。
  const polSrc = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');
  check('详情页按当前模式取画像，不按存储顺序',
    /const savedProfile = activeProfile\(\);/.test(polSrc),
    '不能写成 session.profile || session.selfProfile，也不能让 selfProfile 无条件优先');
  check('详情页顶部返回同样按当前模式判定',
    /const _navSelf = activeQueryMode\(\) === 'self'/.test(polSrc),
    '顶部返回曾用 profile || selfProfile 判定，家庭查询后本人模式详情页返回错页');
  check('详情页顶部返回不再按存储顺序取值',
    polSrc.indexOf('_navSession.profile || _navSession.selfProfile') < 0,
    '旧写法 _navSession.profile || _navSession.selfProfile 会劫持本人模式返回');
  check('详情页返回目标跟随模式',
    /const backHref = selfMode \? 'self\.html' : 'discover\.html'/.test(polSrc));
}

/* ---- 双模式会话：当前生效查询必须落库为 lastQuery ---- */
{
  const appM = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');
  const discM = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');
  const selfM = fs.readFileSync(path.join(ROOT, 'frontend/self.html'), 'utf8');
  const mineM = fs.readFileSync(path.join(ROOT, 'frontend/services.html'), 'utf8');
  check('会话模式判定函数存在',
    /function activeQueryMode\(\)/.test(appM) && /function activeProfile\(\)/.test(appM));
  check('模式判定优先认 lastQuery', /s\.lastQuery === 'self' \|\| s\.lastQuery === 'family'/.test(appM));
  check('旧会话按字段推断本人模式', /s\.selfText && !s\.text/.test(appM));
  check('发现页匹配成功写 lastQuery=family', /lastQuery: 'family'/.test(discM));
  check('本人页匹配成功写 lastQuery=self', /lastQuery: 'self'/.test(selfM));
  check('关系条按当前模式取画像', /const p = activeProfile\(\);/.test(appM),
    '固定读 profile 会让家庭关系条出现在本人页');
  // 「我的」页必须认得本人查询：readQuerySession 只认 text 时，
  // 本人查询后这里显示「还没有查询过」，与事实不符（实测复现）。
  check('会话读取同时认得本人查询', /!s\.text && !s\.selfText/.test(appM));
  check('我的服务页本人模式查询显示本人',
    /const mode = \(typeof activeQueryMode === 'function'\) \? activeQueryMode\(\) : 'family';/.test(mineM)
    && /const selfActive = mode === 'self';/.test(mineM));
  check('我的服务页清空按当前模式清对应键', /selfProfile: \{\}, selfText: ''/.test(mineM));
  check('我的服务页同时具备清空查询与会话重置（两者语义不合并）',
    /清空本次查询/.test(mineM) && /store\.clear\(\)/.test(mineM)
    && /确认重置？再次点击执行/.test(mineM));
}

/* ---- 双模式画像严格隔离：缺失即空状态，不跨模式兜底 ---- */
{
  const appS = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');
  const polS = fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8');
  const mineS = fs.readFileSync(path.join(ROOT, 'frontend/services.html'), 'utf8');
  const idxS = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  check('activeProfile 只取当前模式自己的键',
    /const p = activeQueryMode\(\) === 'self' \? s\.selfProfile : s\.profile;/.test(appS),
    '当前模式画像缺失必须返回 null，不得回退另一模式');
  check('activeProfile 把空对象画像视为缺失',
    /Object\.keys\(p\)\.length === 0/.test(appS),
    '清空查询后留下的 {} 占位不能被当成有效画像');
  check('app.js 不再包含跨模式画像兜底',
    !/s\.selfProfile \|\| s\.profile|s\.profile \|\| s\.selfProfile/.test(appS));
  check('关系条本人模式判定只看当前模式（不看画像在不在）',
    /if \(activeQueryMode\(\) === 'self'\) return '';/.test(appS));
  check('详情页取画像同样不跨模式兜底',
    (() => { const code = stripJsComments(polS);
      return code.indexOf('session.selfProfile || session.profile') < 0
        && code.indexOf('session.profile || session.selfProfile') < 0; })());
  check('详情页模式判定不依赖画像存在',
    /const selfMode = activeQueryMode\(\) === 'self';/.test(polS)
    || (/const curMode = activeQueryMode\(\);/.test(polS)
        && /const selfMode = curMode === 'self';/.test(polS)),
    '画像缺失时仍要能按当前模式决定返回目标与称谓');
  check('详情页匹配上下文文本按模式取',
    /selfMode \? session\.selfText : session\.text/.test(polS),
    '不得用 session.text || session.selfText 这种跨模式链');
  check('我的服务页家庭格/本人格按当前模式门控',
    /if \(demo && mode !== 'self'\)/.test(mineS)
    && /else if \(mode === 'self'\)/.test(mineS)
    && /else if \(s\.beneficiary\)/.test(mineS));
  check('我的服务页当前模式无内容时显示空状态',
    /const hasCurrent = selfActive \? !!s\.selfText : !!s\.text;/.test(mineS),
    '不得把另一模式的旧文本当作本次查询');
  check('我的服务页家庭入口绑定只在初始化发生一次',
    (mineS.match(/entFamily'\)\.addEventListener/g) || []).length === 1
    && mineS.indexOf('sessFamily') >= 0,
    '重复绑定会导致一次点击多次跳转');
  check('首页服务入口用统一的模式判定',
    /const isSelf = activeQueryMode\(\) === 'self';/.test(idxS)
    && idxS.indexOf("s && s.target === 'self'") < 0,
    '只看 target 会把恢复方向带错页');
  // 写回会话的合并基线必须取 store 最新值，不能用渲染快照——
  // 否则重匹配在飞时连续作答两项，前一次作答会被后一次的快照覆盖丢失。
  const discS = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');
  const selfS = fs.readFileSync(path.join(ROOT, 'frontend/self.html'), 'utf8');
  const mergeOk = (src, key) => {
    const writes = src.split('store.write({ ' + key + ': profile })').length - 1;
    // 动态读取的两种等价写法都算：store.read().key 与 (store.read() || {}).key
    const n1 = 'const stored = store.read().' + key + ';';
    const n2 = 'const stored = (store.read() || {}).' + key + ';';
    const bases = (src.split(n1).length - 1) + (src.split(n2).length - 1);
    return writes >= 2 && bases >= 2;
  };
  check('发现页确认/事件写入都取 store 最新画像', mergeOk(discS, 'profile'),
    'bindConfirm/bindScenes 用 current.profile 快照合并会丢前一次作答');
  check('本人页确认/事件写入都取 store 最新画像', mergeOk(selfS, 'selfProfile'));
  check('详情页取画像统一走 activeProfile',
    /const savedProfile = activeProfile\(\);/.test(polS),
    'policy 页自己再写一套取值规则会漏掉空对象语义');
}


/* ---- 做过真实查询就必须撤掉演示标记（否则真实结果被说成虚拟案例） ---- */
{
  const app2 = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');
  const disc2 = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');
  const self2 = fs.readFileSync(path.join(ROOT, 'frontend/self.html'), 'utf8');
  check('发现页写匹配结果时同时清演示标记',
    disc2.indexOf('demoBanner: false') >= 0 && /store\.write\(\{\s*text: text/.test(disc2));
  check('本人页写匹配结果时同时清演示标记',
    self2.indexOf('demoBanner: false') >= 0 && self2.indexOf('mountDemoBanner()') >= 0);
  check('横幅挂载函数会按标记撤掉已挂的横幅',
    app2.indexOf("if (shown) shown.remove();") >= 0 && app2.indexOf('const shown = app.querySelector') >= 0);
  check('发现页清标记后重新对一次横幅',
    disc2.indexOf('mountDemoBanner()') >= 0);

  // ---- 静态站引擎必须与后端引擎同步 ----
  // build/engine.js 是 backend/policy_engine.py 的手工移植。
  // 曾经出现过后端修好、静态站还在跑旧逻辑，用户看到的是错的。
  const jsEnginePath = path.join(ROOT, 'build/engine.js');
  if (fs.existsSync(jsEnginePath)) {
    const js = fs.readFileSync(jsEnginePath, 'utf8');
    const py = fs.readFileSync(path.join(ROOT, 'backend/policy_engine.py'), 'utf8');
    check('静态站引擎带否定判断',
      js.indexOf('function _negated') >= 0 && py.indexOf('def _negated') >= 0);
    check('静态站引擎带时态判断',
      js.indexOf('function _superseded') >= 0 && py.indexOf('def _superseded') >= 0);
    check('静态站引擎带程度副词表',
      js.indexOf('DEGREE_WORDS') >= 0 && py.indexOf('DEGREE_WORDS') >= 0);
    check('静态站引擎带矛盾检测',
      js.indexOf('function detectConflicts') >= 0 && py.indexOf('def detect_conflicts') >= 0);
    check('静态站引擎画像带矛盾字段', js.indexOf('conflicts: detectConflicts(text)') >= 0);
    check('静态站引擎场景识别同时过否定与时态两关',
      js.indexOf('hasWord(text, w) && !_negated(text, w) && !_superseded(text, w)') >= 0);
  }
}



// ================================================================
//  第二阶段收尾：桌面结果页分栏 + 风险语义配色
// ================================================================
const stSrc2 = fs.readFileSync(path.join(ROOT, 'frontend/assets/style.css'), 'utf8');
const appSrc2 = fs.readFileSync(path.join(ROOT, 'frontend/assets/app.js'), 'utf8');

check('结果区拆成侧栏与主区两块',
  /<div class="section result-layout">/.test(appSrc2) &&
  /class="rl-side"/.test(appSrc2) &&
  /class="rl-main"/.test(appSrc2));

check('分段筛选放进了侧栏',
  /<div class="rl-seg">\$\{renderSegments\(list\)\}<\/div>/.test(appSrc2));

check('卡片列表放进主区而非侧栏',
  /class="rl-main">[\s\S]{0,200}?class="tier-groups"/.test(appSrc2));

check('窄屏两区仍按文档顺序直排（手机不分成两栏）',
  /\.result-layout \{ display: block; \}/.test(stSrc2));

check('宽屏才启用两栏 grid',
  /\.result-layout \{[\s\S]{0,200}?display: grid;[\s\S]{0,200}?grid-template-columns:/.test(stSrc2));

check('侧栏用了 sticky 跟随滚动',
  /\.rl-side \{[\s\S]{0,120}?position: sticky;/.test(stSrc2));

check('侧栏里的分段改为竖排',
  /\.rl-seg \.seg-nav \{[\s\S]{0,160}?flex-direction: column;/.test(stSrc2));

check('风险红使用指定色值 #a33f37',
  /--risk:\s*#a33f37;/.test(stSrc2));

check('风险浅底使用指定色值 #fbece9',
  /--risk-soft:\s*#fbece9;/.test(stSrc2));

check('矛盾提示块改用风险红而非暖橙',
  /\.board-conflict \{[\s\S]{0,260}?border-left: 3px solid var\(--risk\);[\s\S]{0,160}?background: var\(--risk-soft\);/.test(stSrc2));

check('矛盾提示的标题用风险红文字',
  /\.board-conflict \.bc-t \{[\s\S]{0,160}?color: var\(--risk\);/.test(stSrc2));

check('矛盾标签用风险红而非暖橙',
  /\.board-conflict \.bc-kind \{[\s\S]{0,220}?color: var\(--risk\);/.test(stSrc2));

check('矛盾提示块里不再残留 --warn',
  !/\.board-conflict[^{]*\{[^}]*--warn/.test(stSrc2));

// P0-2 后暖橙文字统一用深一档的 --warn-dark（浅底上对比度 ≥4.5），
// 语义仍是暖橙一族而非风险红，断言随色值同步。
check('普通提醒仍是暖橙（warn 家族而非 risk 红）',
  /\.notice\.warn \{[\s\S]{0,160}?var\(--warn-dark\)/.test(stSrc2)
  && !/\.notice\.warn \{[\s\S]{0,160}?var\(--risk\)/.test(stSrc2));

console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
