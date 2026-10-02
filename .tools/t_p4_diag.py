import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

run(["set", "viewport", "390", "844"], None, 40)
run(["open", "http://127.0.0.1:8000/index.html?t=d1"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=family]').click(); 'ok'")
time.sleep(1.0)
ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'ok'")
ev("document.querySelector('#beneficiaryGrid .choice[data-role=\"父亲\"]').click(); 'ok'")
ev("document.getElementById('nextBtn').click(); 'ok'")
time.sleep(1.2)
ev("window.__e=[]; window.onerror=(m,s,l)=>{window.__e.push(String(m)+'@'+l)}; 'ok'")
ev("document.getElementById('situation').value='我父亲在佛山住，最近身体还行'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(3.0)
print("卡片数:", ev("document.querySelectorAll('.result-card').length"))
print("空态按钮:", ev("document.querySelectorAll('[data-empty-act]').length"))
print("caseBtn 存在:", ev("!!document.getElementById('caseBtn')"))
print("直接看 caseBtn 点击前 input:", ev("document.getElementById('situation').value"))
print("模拟 demo 分支:", ev("""(() => {
  try {
    document.getElementById('caseBtn').click();
    return 'clicked';
  } catch (e) { return 'ERR ' + e.message; }
})()"""))
time.sleep(3.5)
print("errors:", ev("JSON.stringify(window.__e||[])"))
print("点击后 input:", ev("document.getElementById('situation').value"))
print("点击后卡片数:", ev("document.querySelectorAll('.result-card').length"))
print("点击后 resultArea 前120字:", ev("document.getElementById('resultArea').textContent.replace(/\\s+/g,' ').trim().slice(0,120)"))
