import sys, os, time, json
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=40):
    return run(["eval", "--stdin"], js, t).strip()

print("=" * 30)
print("场景1：首页 → 我的父母 → 家庭协助 → 发现")
print("=" * 30)
run(["open", "http://127.0.0.1:8000/index.html?t=s1"], None, 40)
time.sleep(0.8)
ev("sessionStorage.clear(); 'cleared'")
print("点击 我的父母:", ev("document.querySelector('.choice.entry[data-target=parents]').click(); 'ok'"))
time.sleep(1.0)
print("当前页:", ev("location.pathname"))
# 家庭协助：选女儿/父亲 → 下一步
ev("document.querySelector('#operatorGrid .choice[data-role=女儿]').click(); 'ok'")
ev("document.querySelector('#beneficiaryGrid .choice[data-role=父亲]').click(); 'ok'")
time.sleep(0.3)
print("下一步:", ev("document.getElementById('nextBtn').click(); 'ok'"))
time.sleep(1.0)
print("当前页:", ev("location.pathname"))
# 输入并开始发现
ev("document.getElementById('situation').value = '我父亲72岁，一个人在广州生活，最近行动不方便'; 'ok'")
print("开始发现:", ev("document.getElementById('discoverBtn').click(); 'ok'"))
time.sleep(2.2)
api_calls = ev("JSON.stringify(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/api/')).map(n=>n.split('/api/')[1]))")
print("实际发出的接口:", api_calls)
s1 = ev("""(() => {
  const first = document.querySelector('.result-card');
  return JSON.stringify({
    profileWho: document.querySelector('.role-val') ? document.querySelectorAll('.role-val')[0].textContent : null,
    profileBeneficiary: (JSON.parse(sessionStorage.getItem('policy_finder_session')||'{}').profile||{}).beneficiary_label,
    cards: document.querySelectorAll('.result-card').length,
    aiStrip: !!document.querySelector('.ai-done-strip'),
    firstCard: first ? {
      name: first.querySelector('.result-name').textContent,
      badges: [...first.querySelectorAll('.badge')].map(b=>b.textContent),
      srcRows: [...first.querySelectorAll('.src-row')].map(r=>r.textContent.replace(/\\s+/g,' ').trim()),
    } : null,
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
  });
})()""")
print("场景1结果:", s1)

print()
print("=" * 30)
print("场景2：补充信息 户籍是 / 医保是 / 失能不确定")
print("=" * 30)
btns = ev("""(() => {
  const b = document.querySelector('[data-confirm=hukou][data-value=true]');
  if (!b) return 'no-btn';
  return JSON.stringify({y: Math.round(scrollY), btnTop: Math.round(b.getBoundingClientRect().top), docH: document.documentElement.scrollHeight});
})()""")
print("点击前:", btns)
print("点户籍=是:", ev("document.querySelector('[data-confirm=hukou][data-value=true]').click(); 'ok'"))
time.sleep(1.8)
after1 = ev("""(() => {
  const t = document.getElementById('pfToast');
  return JSON.stringify({y: Math.round(scrollY), toast: t && !t.hidden ? t.textContent : '(已消失)', docH: document.documentElement.scrollHeight, cards: document.querySelectorAll('.result-card').length});
})()""")
print("点击后:", after1)
print("点医保=是:", ev("document.querySelector('[data-confirm=insurance][data-value=true]').click(); 'ok'"))
time.sleep(1.8)
print("点失能=不确定:", ev("document.querySelector('[data-confirm=disability][data-value=null]').click(); 'ok'"))
time.sleep(1.8)
s2 = ev("""(() => {
  const p = JSON.parse(sessionStorage.getItem('policy_finder_session')||'{}').profile||{};
  const lz = [...document.querySelectorAll('.result-card')].find(c=>c.textContent.includes('长寿'));
  return JSON.stringify({hukou:p.hukou, insurance:p.insurance, disability:p.disability, cards: document.querySelectorAll('.result-card').length, y: Math.round(scrollY),
    lzBadges: lz ? [...lz.querySelectorAll('.badge')].map(b=>b.textContent) : null,
    lzMissing: lz ? [...lz.querySelectorAll('.mi-q')].map(x=>x.textContent) : null});
})()""")
print("三项回答后:", s2)
