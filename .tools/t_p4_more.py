import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

def shot(name):
    run(["screenshot", os.path.join(W, ".ui-shots", name)], None, 60)

run(["set", "viewport", "390", "844"], None, 40)

# 空状态 edit 按钮
run(["open", "http://127.0.0.1:8000/index.html?t=e1"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=family]').click(); 'ok'")
time.sleep(1.0)
ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'ok'")
ev("document.querySelector('#beneficiaryGrid .choice[data-role=\"父亲\"]').click(); 'ok'")
ev("document.getElementById('nextBtn').click(); 'ok'")
time.sleep(1.2)
ev("document.getElementById('situation').value='我父亲在佛山住，最近身体还行'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(3.0)
ev("window.scrollTo(0, 4000); 'ok'")
time.sleep(0.3)
ev("document.querySelector('[data-empty-act=edit]').click(); 'ok'")
time.sleep(1.2)
print("edit按钮：聚焦元素 =", ev("document.activeElement.id"),
      "| 输入框在视口内 =", ev("(() => { const r = document.getElementById('situation').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 5; })()"))

# 详情页回归（第三阶段五问结构不得被破坏）
run(["open", "http://127.0.0.1:8000/index.html?t=e2"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.getElementById('demoEntry').click(); 'ok'")
time.sleep(3.4)
ev("document.querySelector('.result-card').click(); 'ok'")
time.sleep(2.4)
print("详情页标题:", ev("JSON.stringify([...document.querySelectorAll('.q-title')].map(x=>x.textContent))"))
print("信任卡:", ev("!!document.querySelector('.trust-card')"),
      "| 信任卡行数:", ev("document.querySelectorAll('.tc-row').length"),
      "| hScroll:", ev("document.documentElement.scrollWidth > innerWidth + 1"),
      "| minBtn:", ev("Math.min(...[...document.querySelectorAll('button')].map(b=>Math.round(b.getBoundingClientRect().height)))"))
ev("document.querySelector('.trust-card').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.5)
shot("p4-6-detail-regress.png")

# 首页整页观感（顶部）
run(["open", "http://127.0.0.1:8000/index.html?t=e3"], None, 45)
time.sleep(1.6)
shot("p4-7-home-top.png")
