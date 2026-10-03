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
]);
const BUILTIN = new Set([
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'console', 'parseInt', 'parseFloat', 'isNaN',
  'encodeURIComponent', 'decodeURIComponent', 'alert', 'confirm',
  'Number', 'String', 'Array', 'Object', 'JSON', 'Promise', 'Math', 'Date',
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
check('详情页保留 to_verify 提示', /来源待核验/.test(pol));
check('详情页返回区分本人/家庭模式', /backHref = selfMode \? 'self\.html' : 'discover\.html'/.test(pol));

console.log('== CSS 变量与类名一致 ==');
const css = fs.readFileSync(path.join(ROOT, 'frontend/assets/style.css'), 'utf8');
['.flow', '.flow-step', '.flow-dot', '.board', '.scene-chip', '.tier-head', '.tier-head.is-focus',
 '.result-summary', '.more-group', '.more-toggle', '.more-body', '.more-inner',
 '.evidence', '.ev-step', '.ev-cond', '.final-step', '.fs-opt', '.where-row', '.rel-strip',
 '.how-card', '.step-lead'].forEach((sel) => {
  check('CSS 定义 ' + sel, css.indexOf(sel) >= 0);
});

console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);