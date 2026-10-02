import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

def shot(name):
    run(["screenshot", os.path.join(W, ".ui-shots", name)], None, 60)

run(["set", "viewport", "390", "844"], None, 40)

# 1) 发现页顶部：AI 分析依据卡
run(["open", "http://127.0.0.1:8000/discover.html?t=v1"], None, 45)
time.sleep(1.0)
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.8)
ev("window.scrollTo(0,0); 'ok'")
time.sleep(0.5)
shot("p3-7-basis-card.png")
print("basis:", ev("JSON.stringify([...document.querySelectorAll('.basis-row')].map(r=>r.querySelector('.basis-key').textContent+'='+r.querySelector('.basis-val').textContent.trim()))"))

# 2) 家庭页信息状态卡
run(["open", "http://127.0.0.1:8000/family.html?t=v2"], None, 45)
time.sleep(1.0)
ev("document.getElementById('factList').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.5)
shot("p3-8-family-facts.png")
print("facts:", ev("JSON.stringify([...document.querySelectorAll('.fact-row')].map(r=>r.textContent.replace(/\\s+/g,' ').trim()))"))

# 3) 007 的 ③④ 块
run(["open", "http://127.0.0.1:8000/policy.html?id=gz_elderly_007&t=v3"], None, 45)
time.sleep(2.2)
ev("document.querySelectorAll('.detail-block')[2].scrollIntoView(); 'ok'")
time.sleep(0.5)
shot("p3-9-007-confirm.png")
print("block3:", ev("document.querySelectorAll('.detail-block')[2].textContent.replace(/\\s+/g,' ').trim().slice(0,180)"))
print("block4:", ev("document.querySelectorAll('.detail-block')[3].textContent.replace(/\\s+/g,' ').trim().slice(0,220)"))

# 4) 010 的 ④ 块（已核验流程）
run(["open", "http://127.0.0.1:8000/policy.html?id=gz_elderly_010&t=v4"], None, 45)
time.sleep(2.2)
print("010 block4:", ev("document.querySelectorAll('.detail-block')[3].textContent.replace(/\\s+/g,' ').trim().slice(0,220)"))
