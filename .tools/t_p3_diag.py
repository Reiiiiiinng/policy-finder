import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

run(["open", "http://127.0.0.1:8000/index.html?t=p3d"], None, 45)
time.sleep(0.8)
run(["set", "viewport", "390", "844"], None, 40)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=parents]').click(); 'ok'")
time.sleep(1.2)
print("page:", ev("location.pathname"))
print("viewport:", ev("JSON.stringify({iw:innerWidth, docW:document.documentElement.scrollWidth, ih:innerHeight})"))
print("click1:", ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'clicked-op'"))
print("click2:", ev("document.querySelector('#beneficiaryGrid .choice[data-role=\"父亲\"]').click(); 'clicked-be'"))
time.sleep(0.5)
print("operatorVal:", ev("document.getElementById('operatorVal').textContent"))
print("beneficiaryVal:", ev("document.getElementById('beneficiaryVal').textContent"))
print("factRows:", ev("JSON.stringify([...document.querySelectorAll('.fact-row')].map(r=>r.textContent.replace(/\\s+/g,' ').trim()))"))
print("nextBtn disabled:", ev("document.getElementById('nextBtn').disabled"))
