/**
 * 引擎移植对照测试：node build/compare.js
 *
 * 把 build/expected.json（Python 版跑出来的标准答案）喂给 build/engine.js，
 * 逐字段比对。任何差异都直接失败，不放过。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadEngine(dbJson) {
  const code = fs.readFileSync(path.join(ROOT, 'build', 'engine.js'), 'utf8');
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Number,
    Array,
    Object,
    String,
    Set,
    Map,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'engine.js' });
  // DB 在页面里由脚本注入，这里同样注入
  vm.runInContext('var DB = ' + JSON.stringify(dbJson) + ';', sandbox);
  vm.runInContext('var api = localApi(DB);', sandbox);
  return sandbox;
}

const fails = [];
let checks = 0;

function cmp(label, a, b, trail) {
  checks += 1;
  const where = trail ? trail : label;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa === sb) return;
  // 逐层定位差异，报出具体字段而不是整块
  if (a && b && typeof a === 'object' && typeof b === 'object'
      && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        cmp(label, a[k], b[k], where + '.' + k);
        return;
      }
    }
  }
  fails.push({
    where,
    expected: sb && sb.length > 400 ? sb.slice(0, 400) + '…' : sb,
    actual: sa && sa.length > 400 ? sa.slice(0, 400) + '…' : sa,
  });
}

function main() {
  const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'expected.json'), 'utf8'));
  const db = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'guangzhou_elderly_policy_v1.1.json'), 'utf8'));
  const sandbox = loadEngine(db);

  // 1) 画像 + 匹配 + 分层 + 生活事件库
  for (const c of expected.cases) {
    const got = sandbox.api.match(c.input);
    cmp(c.name, c.profile, got.profile, c.name + ' profile');
    cmp(c.name, c.results, got.results, c.name + ' results');
    cmp(c.name, c.tier_summary, got.tier_summary, c.name + ' tier_summary');
    cmp(c.name, c.scene_library, got.scene_library, c.name + ' scene_library');
  }

  // 2) 详情（rag_text / validity）
  for (const pid of Object.keys(expected.details)) {
    const got = sandbox.api.policy(pid);
    cmp(pid, expected.details[pid].rag_text, got.rag_text, pid + ' rag_text');
    cmp(pid, expected.details[pid].validity, got.validity, pid + ' validity');
  }

  // 3) 列表精简字段
  const briefs = sandbox.api.policies();
  cmp('policies', expected.briefs, briefs.policies, 'policies');
  cmp('policies.total', expected.briefs.length, briefs.total, 'policies.total');

  // 4) health
  const h = sandbox.api.health();
  cmp('health.policy_count', expected.briefs.length, h.policy_count, 'health.policy_count');

  // 5) 生活事件库（无画像）
  const scenes = sandbox.api.scenes(null);
  const pyScenes = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'build', 'expected_scenes.json'), 'utf8'));
  cmp('scenes', pyScenes, scenes.scenes, 'scenes');

  console.log('对照项 %d 个，差异 %d 处', checks, fails.length);
  if (fails.length) {
    console.log('\n前 12 处差异：');
    fails.slice(0, 12).forEach((f) => {
      console.log('  ✗ ' + f.where);
      console.log('      Python: ' + f.expected);
      console.log('      JS    : ' + f.actual);
    });
    process.exit(1);
  }
  console.log('引擎移植与 Python 版逐字段一致。');
}

main();
