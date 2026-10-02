import sys, os, time, json
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

# 1. 打开发现页并输入
run(["open", "http://127.0.0.1:8000/discover.html?t=flow"], None, 40)
time.sleep(1.0)
fill = "document.getElementById('situation').value='我父亲72岁，一个人在广州生活，最近行动不方便，有高血压。'; 'ok'"
print("fill:", run(["eval", fill], None, 30).strip())
print("click:", run(["eval", "document.getElementById('discoverBtn').click(); 'ok'"], None, 30).strip())
time.sleep(2.0)

check = """(() => {
  const cards = document.querySelectorAll('.result-card').length;
  const first = document.querySelector('.result-card .result-name');
  const badge = document.querySelector('.result-card .badge');
  const confirmBtns = document.querySelectorAll('[data-confirm]').length;
  return JSON.stringify({cards, firstName: first ? first.textContent : null, badge: badge ? badge.textContent : null, confirmBtns});
})()"""
print("results:", run(["eval", "--stdin"], check, 40).strip())

# 2. 点一个「是」验证补充信息交互仍然工作（滚动修复逻辑）
before = run(["eval", "JSON.stringify({y: scrollY, h: document.documentElement.scrollHeight})"], None, 30).strip()
click_yes = """(() => {
  const b = document.querySelector('[data-confirm="hukou"][data-value="true"]');
  if (!b) return 'no-btn';
  const r = b.getBoundingClientRect();
  window.__vpy = r.top;
  b.click();
  return 'clicked@' + Math.round(r.top);
})()"""
print("yes:", run(["eval", "--stdin"], click_yes, 40).strip())
time.sleep(2.0)
after = run(["eval", """(() => {
  const b = document.querySelector('[data-confirm="hukou"][data-value="true"]');
  return JSON.stringify({y: scrollY, h: document.documentElement.scrollHeight, vp: b ? Math.round(b.getBoundingClientRect().top) : null, val: b ? b.closest('.card').querySelector('.role-val').textContent : null});
})()"""], None, 40).strip()
print("before:", before)
print("after: ", after)
