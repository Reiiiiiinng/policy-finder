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
PAGES.forEach((page) => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', page), 'utf8');
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
  const src = scripts[page];
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
    if (defined.has(name) || local.has(name)) continue;
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
check('详情页保留五问结构', /qBlock\(1/.test(pol) && /qBlock\(3/.test(pol) && /qBlock\(5/.test(pol));
check('详情页保留来源信任卡', /trust-card/.test(pol));
// P1：出门前清单。低碳落点是「减少无效往返」，不是「电子化更环保」；
// 材料只能从申请条件推导，不能凭空编造证件名目。
check('出门前清单分材料与问题两栏',
  /出门前要带的材料/.test(pol) && /要问清的问题/.test(pol));
check('清单从申请条件推导材料',
  /cond\.hukou_required/.test(pol) && /cond\.insurance_required/.test(pol)
  && /cond\.disability_required/.test(pol));
check('清单声明以受理单位告知为准', /以受理单位告知为准/.test(pol));
check('低碳表述落在减少往返上',
  /少跑一趟/.test(pol) && !/电子化|无纸化|更环保|减少碳排放/.test(pol));
check('清单结尾给官方渠道且不代办',
  /不代办/.test(pol) && /不代为提交材料/.test(pol) && /不做资格认定/.test(pol));
check('详情页保留 to_verify 提示', /来源待核验/.test(pol));

// P2：一句话产品定义（≤30 字）+ 三个亮点的因果链必须落在界面上，不能只写进文档。
{
  const idx = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  const def = (idx.match(/<p class="hero-def">([\s\S]*?)<\/p>/) || [])[1] || '';
  const defText = stripTags(def).trim();
  check('首屏有一句话产品定义', defText.length > 0);
  check('产品定义不超过 30 字', defText.length <= 30, 'len=' + defText.length + ' "' + defText + '"');
  check('产品定义讲机制而非功能罗列',
    /依据|核对/.test(defText) && /发现/.test(defText));
  check('三个亮点串成因果链',
    /chain-card/.test(idx) && /主动发现/.test(idx) && /可解释推荐/.test(idx) && /家庭代查/.test(idx));
  check('因果链写明「因为…所以必须…」',
    (idx.match(/chain-because/g) || []).length >= 3,
    'n=' + (idx.match(/chain-because/g) || []).length);
  check('因果链在说明区而非入口之前',
    idx.indexOf('chain-card') > idx.indexOf('id="entry"'));
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
  check('母题用在首页首屏',
    /renderThread\('独居 · 行动不便'/.test(fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8')));
  check('母题用在详情页首块', /renderThread\(sceneClues\[0\]/.test(fs.readFileSync(path.join(ROOT, 'frontend/policy.html'), 'utf8')));
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
  check('详情页顶部用 renderAxes', /renderAxes\(matchRow/.test(polSrc));
  check('详情页来源核验不再用 badge 药丸',
    !/<span class="badge (pending|verified)">(✓\s*)?(来源待核验|已核验)</.test(polSrc));
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

  // 状态标签尺寸：两维度同名同尺寸，颜色语义唯一
  check('状态标签字号统一', /\.axis-k \{[\s\S]{0,200}?font-size:\s*11px/.test(css));
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
    /符合度/.test(app) && /scorePct/.test(pol));

  // 详情页：标题是 h1.dhead-title，右侧附注用左侧竖线而不是完整边框
  check('详情页标题用 dhead-title', /class="dhead-title"/.test(pol));
  check('详情页附注用竖线语言', /\.dhead-side \{[\s\S]{0,320}?border-left:\s*3px/.test(css));

  // 母题连线：线索让位给权益名，不在中间截断
  check('详情页母题线索让位给权益名',
    /\.detail-thread \.th-clue \{[\s\S]{0,200}?max-width:\s*42%/.test(css)
    && /\.detail-thread \.th-right \{[\s\S]{0,200}?flex:\s*1 1 auto/.test(css));
  // 首页：服务入口指向已有能力，收藏区没有条目不出现
  const idx = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  check('首页有服务入口四项', /class="svc-grid"/.test(idx)
    && /政策匹配/.test(idx) && /政策解读/.test(idx)
    && /办理指引/.test(idx) && /我的收藏/.test(idx));
  check('服务入口都是指向已有能力，不新开页面',
    (idx.match(/class="svc"[^>]*href="#[a-zA-Z]+"/g) || []).length === 4);
  check('我的收藏为空时整块隐藏', /id="savedSec"[^>]*hidden/.test(idx)
    && /\$\{\(?items\.length/.test(idx.replace(/\s+/g, '')) === false
    && /if \(!Array\.isArray\(items\) \|\| !items\.length\) return;/.test(idx));

  // 详情页：收藏星标 + 底部动作条
  check('详情页标题行有收藏星标', /class="dhead-save"/.test(pol) && /aria-pressed="false"/.test(pol));
  check('收藏只存 id/名称/部门，不存个人信息',
    /localStorage\.setItem\('pf_saved'/.test(pol)
    && /id: pid/.test(pol) && /name: p\.policy_name/.test(pol)
    && !/age:|beneficiary:|idcard/i.test((pol.split('function bindSave')[1] || '').slice(0, 4000)));
  check('星标命中区 48px', /\.dhead-save \{[\s\S]{0,120}?width:\s*48px/.test(css));

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
  const mine = fs.readFileSync(path.join(ROOT, 'frontend/mine.html'), 'utf8');
  const cons = fs.readFileSync(path.join(ROOT, 'frontend/consult.html'), 'utf8');
  const idx2 = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  const disc2 = fs.readFileSync(path.join(ROOT, 'frontend/discover.html'), 'utf8');

  // 四个一级页都要挂同一个导航，且各自高亮自己
  check('四个一级页都挂了底部导航',
    /mountTabbar\('home'\)/.test(idx2) && /mountTabbar\('discover'\)/.test(disc2)
    && /mountTabbar\('consult'\)/.test(cons) && /mountTabbar\('mine'\)/.test(mine));
  check('导航项与页面一一对应',
    /key: 'home',[\s\S]{0,80}href: 'index\.html'/.test(app)
    && /key: 'discover',[\s\S]{0,80}href: 'discover\.html'/.test(app)
    && /key: 'consult',[\s\S]{0,80}href: 'consult\.html'/.test(app)
    && /key: 'mine',[\s\S]{0,80}href: 'mine\.html'/.test(app));
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
  check('我的页空收藏与空查询都如实说明',
    /还没有收藏/.test(mine) && /还没有查询过/.test(mine));
  check('我的页读的是同一份收藏，不另存一套',
    /localStorage\.getItem\('pf_saved'\)/.test(mine) && /pf_saved/.test(pol));
  check('咨询页不编造热线号码',
    /未接入在线咨询/.test(cons) && !/0\d{2,3}-\d{7,8}/.test(cons));
  // /api/policies 列表不含 source，直接用它会全部落到兜底文案「主管部门」，
  // 看起来像 10 条政策只有 1 个部门。部门必须从详情接口取。
  // 服务入口四格必须真的把用户送到那个功能上。
  // 三格曾经只是 scrollIntoView 回入口区（等于点了没反应），
  // 「我的收藏」更是在没收藏时整块隐藏，锚点滚不到任何东西。
  check('服务入口四格各有落点标识',
    /data-svc="match"/.test(idx2) && /data-svc="detail"/.test(idx2)
    && /data-svc="guide"/.test(idx2) && /data-svc="saved"/.test(idx2));
  check('收藏区隐藏时改去我的页', /sec && !sec\.hidden/.test(idx2)
    && /location\.href = 'mine\.html'/.test(idx2));
  check('解读与指引送到发现页并消费 intent',
    /pf_svc_intent/.test(idx2) && /function applyServiceIntent/.test(disc2)
    && /sessionStorage\.removeItem\('pf_svc_intent'\)/.test(disc2));
  check('部门取自详情接口而非列表接口',
    /API\.policy\(p\.policy_id\)/.test(cons) && /pd\.source/.test(cons)
    && !/\(p\.source \|\| \{\}\)/.test(cons));

  // ---- 整体检查（第二轮实测发现并修掉的缺陷，逐条防回归）----
  const selfSrc2 = fs.readFileSync(path.join(ROOT, 'frontend/self.html'), 'utf8');
  // 1) 核验状态在 verification.status，source 里没有 pending 字段。
  //    读不存在的字段得到 undefined，会让整库都被算成「已核验」（实测 10/0，真值 8/2）。
  check('咨询页核验计数读 verification.status',
    /verification \|\| \{\}\)\.status === 'verified'/.test(cons)
    && !/src\.pending/.test(cons));
  // 2) 分段点击后高亮必须跟随。停在「全部」会让用户以为筛选没生效。
  check('分段高亮跟随点击', /function bindSegments/.test(app)
    && /classList\.toggle\('is-on'/.test(app));
  check('发现页与本人页都绑定分段', /bindSegments\(\)/.test(disc2) && /bindSegments\(\)/.test(selfSrc2));
  // 3) 收藏行的「取消收藏」不能嵌在 <a> 里：HTML 不允许交互内容嵌在链接内。
  check('收藏行链接与按钮并列不嵌套',
    /<div class="saved-row">/.test(mine) && /class="sr-link"/.test(mine)
    && !/<a class="saved-row"/.test(mine) && !/<\/a>`\)\.join/.test(mine));
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
  check('咨询页三条疑问可就地展开',
    (cons.match(/data-ask="/g) || []).length === 3
    && /aria-expanded/.test(cons) && /csl-answer/.test(cons));
  check('咨询页三条答案都写了真实内容',
    /ansWhy/.test(cons) && /ansQualify/.test(cons) && /ansChannel/.test(cons)
    && /「可能相关」/.test(cons) && /「待确认」/.test(cons));
  // 出门前准备三项是产品主张（少跑一趟）的落点，不能只剩一句口号。
  check('咨询页有出门前的准备清单',
    (cons.match(/class="prep-row"/g) || []).length === 3
    && /政策名称或文件名称/.test(cons) && /需要确认的条件/.test(cons));
  // 通用四问必须与详情页「要问清的问题」同源，而不是另编一套。
  // 两页措辞略有出入（详情页是列表项、咨询页是问句），比对的是同一组要点。
  check('咨询页通用四问与详情页同源',
    /服务覆盖范围/.test(cons) && /申请入口/.test(cons)
    && /需要准备哪些材料|需要哪些材料/.test(cons) && /发放方式/.test(cons)
    && /服务覆盖范围/.test(pol) && /申请入口/.test(pol)
    && /需要哪些材料/.test(pol) && /发放方式/.test(pol));

  // 「我的家庭」只显示本次真实涉及的家人。预置父亲/母亲这类没发生过的成员
  // 会让用户以为自己填过，属于编造事实。
  check('我的家庭不预置没发生过的成员',
    !/父亲（67岁）|母亲（64岁）/.test(mine)
    && /readQuerySession\(\)/.test(mine) && /添加家人/.test(mine));
  // 产品没有账号体系，就不能摆一个点了没反应的「立即登录」。
  // 只看 HTML 里的按钮文字，不看注释——注释里提到这几个字是为了解释为什么不做。
  check('我的页不摆假登录入口',
    !/>\s*(立即登录|去登录|登录)\s*</.test(mine) && /无需登录/.test(mine));
  // 我的服务四格必须都是真链接，不能是 <button> 占位。
  check('我的服务四格都是可点的链接',
    (mine.match(/class="mine-svc-item" href="/g) || []).length === 4);
  check('关于我们默认收起且可展开',
    /id="aboutToggle"[^>]*aria-expanded="false"/.test(mine)
    && /id="aboutBox"[^>]*hidden/.test(mine) && /aria-controls="aboutBox"/.test(mine));
  // 收藏与本次查询都要能清空，且清空只清本机。
  check('我的页能清空本次查询',
    /id="qClear"/.test(mine) && /store\.write\(\{ profile: \{\}, text: '' \}\)/.test(mine));
  check('取消收藏只删这一条不跳页', /e\.stopPropagation\(\)/.test(mine)
    && /filter\(\(x\) => x\.id !== id\)/.test(mine));
}
console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
