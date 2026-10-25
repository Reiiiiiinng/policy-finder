/**
 * 统计口径核对：用真实引擎计算首页与展板上的每个数字，并逐项说明定义。
 *
 *     node .tools/stats-audit.mjs
 *
 * 为什么需要它：
 *   2026-10 排查发现「23 覆盖生活场景」与「10 官方原文链接」被误当成同一口径
 *   比较，实际是两个完全不同的指标（life_scenes 去重标签数 vs official_url
 *   非空条目数）。这个脚本把每个数字的计算过程固定下来，改数据或改标签
 *   都会立刻看出差异。
 *
 * 退出码非 0 表示有数字与数据不符（或标签缺失），可直接接进 CI。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

// 优先用构建产物里的引擎（与线上完全同一份实现），没有就直接读源数据 + engine.js
const PAGES_DB = path.join(ROOT, 'build', 'pages', 'data', 'policies.js');
const RAW_DB = path.join(ROOT, 'data', 'guangzhou_elderly_policy_v1.1.json');
const ENGINE = path.join(ROOT, 'build', 'engine.js');

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

const { db, from } = loadDb();
console.log(`政策库来源：${from}`);
const policies = db.policies || [];

console.log('\n== 首页数据可信度条（frontend/index.html loadTrustStrip）==');
// ① 收录政策 = /api/policies 的 total
const total = policies.length;
check('① 收录政策（条目总数）', total, 10);

// ② 已核一手来源 = verification.status === 'verified'
const verified = policies.filter((p) => ((p.verification || {}).status) === 'verified').length;
check('② 已核一手来源（verified 条目数）', verified, 8);

// ③ 官方原文链接 = source.official_url 非空条目数
//    注意：这是「条目数」，不是「去重 URL 数」。gz_elderly_001/002/004/005
//    共用同一份《广州市基本养老服务清单》，所以条目数是 10、去重 URL 数是 7。
const withUrl = policies.filter((p) => String(((p.source || {}).official_url) || '').trim()).length;
check('③ 官方原文链接（official_url 非空条目数）', withUrl, 10);

const distinctUrls = new Set(
  policies.map((p) => String(((p.source || {}).official_url) || '').trim()).filter(Boolean),
).size;
check('③-补 去重后不同原文 URL 数（页面未展示，仅作口径说明）', distinctUrls, 7);

console.log('\n== 展板统计块（deliverable/poster-1080x1920.html）==');
// 展板写的是「真实政策条目 / 已核官方来源 / 覆盖生活场景」
const posterHtml = path.join(ROOT, '..', 'deliverable', 'poster-1080x1920.html');
const sceneSet = new Set();
for (const p of policies) for (const s of (p.life_scenes || [])) sceneSet.add(s);
const sceneCount = sceneSet.size;
check('展板「覆盖生活场景」（life_scenes 去重标签数）', sceneCount, 23);

if (fs.existsSync(posterHtml)) {
  const html = fs.readFileSync(posterHtml, 'utf8');
  const stats = [...html.matchAll(/<div class="stat"><b>(\d+)<\/b><span>([^<]+)<\/span><\/div>/g)];
  check('展板统计卡数量', stats.length, 3);
  const want = [
    ['真实政策条目', String(total)],
    ['已核官方来源', String(verified)],
    ['覆盖生活场景', String(sceneCount)],
  ];
  want.forEach(([label, val], i) => {
    const got = stats[i] ? stats[i][2] : '（缺）';
    const num = stats[i] ? stats[i][1] : '（缺）';
    check(`展板第 ${i + 1} 卡标签`, got, label);
    check(`展板第 ${i + 1} 卡数值（${label}）`, num, val);
  });
} else {
  FAIL++;
  console.log(`  FAIL 展板 HTML 不存在：${posterHtml}`);
}

console.log('\n== 口径对照（两组数字定义不同，不可强行对齐）==');
console.log(`  首页第 3 格「官方原文链接」= ${withUrl}（条目数，含共用同一文件的 4 条）`);
console.log(`  展板第 3 格「覆盖生活场景」= ${sceneCount}（life_scenes 去重标签数）`);
console.log(`  去重原文 URL 数            = ${distinctUrls}（页面未展示）`);
console.log('  首页刻意不展示「生活场景数」：life_scenes 是政策侧描述字段，');
console.log('  同一条政策挂多个标签、各条命名不统一，加起来不能当「覆盖广度」。');

console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
process.exit(FAIL ? 1 : 0);
