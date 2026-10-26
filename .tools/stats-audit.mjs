/**
 * 统计口径核对：用真实数据计算页面上出现的每个数字，并逐项固定定义。
 *
 *     node .tools/stats-audit.mjs
 *
 * 为什么需要它：
 *   2026-10 排查发现「23 覆盖生活场景」「10 官方原文链接」「12 标准标签」
 *   这几个数字被混着比较。它们其实是四个不同的东西，任何一个都不该和另一个
 *   对齐。这个脚本把每个数字的计算方式写死，并同时校验页面上的**标签**，
 *   因为口径错误往往先出现在标签上（数字对、说法错）。
 *
 * 退出码非 0 表示数字或标签与数据不符，可直接接进 CI。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

// 优先用构建产物里的引擎数据（与线上完全同一份），没有就直接读源数据
const PAGES_DB = path.join(ROOT, 'build', 'pages', 'data', 'policies.js');
const RAW_DB = path.join(ROOT, 'data', 'guangzhou_elderly_policy_v1.1.json');

function loadDb() {
  if (fs.existsSync(PAGES_DB)) {
    const src = fs.readFileSync(PAGES_DB, 'utf8');
    const m = src.match(/const POLICY_DB = ([\s\S]*?);\n\n/);
    if (!m) throw new Error('无法从 build/pages/data/policies.js 解析 POLICY_DB');
    return { db: JSON.parse(m[1]), from: 'build/pages/data/policies.js' };
  }
  return { db: JSON.parse(fs.readFileSync(RAW_DB, 'utf8')), from: 'data/guangzhou_elderly_policy_v1.1.json' };
}

let PASS = 0;
let FAIL = 0;
function check(name, actual, expected, why) {
  const ok = String(actual) === String(expected);
  if (ok) {
    PASS++;
    console.log(`  ok   ${name} = ${actual}`);
  } else {
    FAIL++;
    console.log(`  FAIL ${name} = ${actual}（期望 ${expected}）${why ? ' — ' + why : ''}`);
  }
}
function checkText(name, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (ok) {
    PASS++;
    console.log(`  ok   ${name}（含「${needle}」）`);
  } else {
    FAIL++;
    console.log(`  FAIL ${name}：页面文案里找不到「${needle}」`);
  }
  return ok;
}

const { db, from } = loadDb();
console.log(`政策库来源：${from}`);
const policies = db.policies || [];
const str = (v) => String(v == null ? '' : v).trim();

/* ------------------------------------------------------------------
   一、条目类数字
   ------------------------------------------------------------------ */

// ① 政策记录数：policies 数组长度
const total = policies.length;
check('① 政策记录数（policies.length）', total, 10);

// ② 已核一手来源：verification.status === 'verified' 的条目数
const verified = policies.filter((p) => ((p.verification || {}).status) === 'verified').length;
check('② 已核验条目数（verification.status === verified）', verified, 8);
check('②-补 待核验条目数（总数 − 已核验）', total - verified, 2);

// ③ 带官方来源的记录数：source.official_url 非空 —— 这是「条」，不是「页」
const urls = policies.map((p) => str((p.source || {}).official_url));
const recordsWithUrl = urls.filter(Boolean).length;
check('③ 带官方来源的记录数（official_url 非空条目数）', recordsWithUrl, 10);

// ④ 去重后的来源页面数：把 official_url 放进 Set —— 这是「页」
const distinctSourcePages = new Set(urls.filter(Boolean)).size;
check('④ 去重来源页面数（distinct official_url）', distinctSourcePages, 7,
  '001/002/004/005 共用《广州市基本养老服务清单（2024年版）》同一页');

// ⑤ 其他链接数：validity.basis.official_url（延期/修改文原文）
const basisUrls = policies.map((p) => str((((p.validity || {}).basis) || {}).official_url)).filter(Boolean);
const distinctBasisPages = new Set(basisUrls).size;
check('⑤ 延期依据文件链接数（basis.official_url 非空条目数）', basisUrls.length, 1,
  '仅 gz_elderly_009 有延期文');
check('⑤-补 去重后的延期依据页面数', distinctBasisPages, 1);

// ⑥ 全部官方页面（来源页 ∪ 延期依据页），去重
const allPages = new Set([...urls.filter(Boolean), ...basisUrls]);
check('⑥ 全部官方原文页数（来源页 ∪ 依据页，去重）', allPages.size, 8,
  '7 + 1：延期文是另一份页面');

/* ------------------------------------------------------------------
   二、标签类数字：life_scenes 与 scene_tag_library 是两个东西
   ------------------------------------------------------------------ */

const library = db.scene_tag_library || [];
const usedScenes = new Set();
for (const p of policies) for (const s of (p.life_scenes || [])) usedScenes.add(s);
const libSet = new Set(library);
const outside = [...usedScenes].filter((s) => !libSet.has(s));
const unused = library.filter((s) => !usedScenes.has(s));

// ⑦ 政策侧实际挂上去的标签（去重字符串）——决定了「23」这个数
check('⑦ life_scenes 去重标签数（数据里实际出现的不同字符串）', usedScenes.size, 23);

// ⑧ 受控词表大小 —— 决定了「12」这个数，与 ⑦ 不同口径
check('⑧ scene_tag_library 标准标签数（受控词表长度）', library.length, 12);

// ⑨ 词表外的标签：这些是合法数据（引擎会把并集纳入事件清单），但说明「23」
//    里有近义词，不能当「覆盖了 23 种不同的生活处境」读。
check('⑨ 不在受控词表内的标签数', outside.length, 12);
check('⑨-补 词表里未被使用的标签数', unused.length, 1);

console.log('\n  词表外标签（数据在用、词表未收）：');
for (const s of outside) console.log(`    · ${s}`);
console.log('  词表内未使用标签：');
for (const s of unused) console.log(`    · ${s}`);

/* ------------------------------------------------------------------
   三、页面上的标签文案（数字对但说法错，也是口径错误）
   ------------------------------------------------------------------ */

console.log('\n== 首页可信度条（frontend/index.html）==');
const indexHtml = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
checkText('首页第 1 格标签', indexHtml, '<span class="trust-label">收录政策</span>');
checkText('首页第 2 格标签', indexHtml, '<span class="trust-label">已核一手来源</span>');
// ③ 必须是「页」的口径：标签写「不同官方原文页」，取数走 Set 去重。
//    曾经的标签是「官方原文链接」，配 10 这个条目数，会让人以为有 10 个不同页面。
checkText('首页第 3 格标签按「页」表述', indexHtml, '<span class="trust-label">不同官方原文页</span>');
checkText('首页第 3 格取数按 URL 去重', indexHtml, 'const distinctPages = urlSet.size;');
check('首页第 3 格不再用条目数', indexHtml.includes('statSources\').textContent = withUrl'), false);

console.log('\n== 展板统计块（deliverable/poster-1080x1920.html）==');
const posterHtml = path.join(ROOT, '..', 'deliverable', 'poster-1080x1920.html');
if (!fs.existsSync(posterHtml)) {
  FAIL++;
  console.log(`  FAIL 展板 HTML 不存在：${posterHtml}`);
} else {
  const html = fs.readFileSync(posterHtml, 'utf8');
  const stats = [...html.matchAll(/<div class="stat"><b>(\d+)<\/b><span>([^<]+)<\/span><\/div>/g)];
  check('展板统计卡数量', stats.length, 3);
  // 展板第 3 卡写的是 ⑦（23 个生活场景标签），标签必须说清是「标签」，
  // 不能写成「覆盖生活场景」——那会让 23 这个含近义词的字符串计数
  // 被读成「覆盖了 23 种不同处境」。
  const want = [
    ['真实政策条目', String(total)],
    ['已核官方来源', String(verified)],
    ['生活场景标签', String(usedScenes.size)],
  ];
  want.forEach(([label, val], i) => {
    const got = stats[i] ? stats[i][2] : '（缺）';
    const num = stats[i] ? stats[i][1] : '（缺）';
    check(`展板第 ${i + 1} 卡标签`, got, label);
    check(`展板第 ${i + 1} 卡数值（${label}）`, num, val);
  });
}

/* ------------------------------------------------------------------
   四、口径对照表（打印出来，避免下次再拿两个数字互相印证）
   ------------------------------------------------------------------ */

console.log('\n== 口径对照（四个数字互不相同，也不该相同）==');
console.log(`  政策记录数                    = ${total}   （policies 数组长度）`);
console.log(`  带官方来源的记录数            = ${recordsWithUrl}   （official_url 非空的「条」）`);
console.log(`  去重后的来源页面数            = ${distinctSourcePages}   （official_url 去重的「页」）`);
console.log(`  延期依据页面数                = ${distinctBasisPages}   （validity.basis.official_url）`);
console.log(`  全部官方原文页数              = ${allPages.size}   （来源页 ∪ 依据页）`);
console.log(`  life_scenes 去重标签字符串数  = ${usedScenes.size}   （展板第 3 卡）`);
console.log(`  scene_tag_library 标准标签数  = ${library.length}   （受控词表）`);
console.log('  首页刻意不展示生活场景数：life_scenes 是政策侧描述字段，');
console.log('  同一条政策挂多个标签、命名不统一（词表外 ' + outside.length + ' 个），');
console.log('  相加不能当「覆盖广度」，所以首页改列核验/类别分布。');

console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
