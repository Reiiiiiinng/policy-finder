import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

def shot(name):
    run(["screenshot", os.path.join(W, ".ui-shots", name)], None, 60)

run(["set", "viewport", "390", "844"], None, 40)
run(["open", "http://127.0.0.1:8000/index.html?t=v5"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=family]').click(); 'ok'")
time.sleep(1.0)
ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'ok'")
ev("document.querySelector('#beneficiaryGrid .choice[data-role=\"母亲\"]').click(); 'ok'")
ev("document.getElementById('confirmCheck').click(); 'ok'")
ev("document.getElementById('nextBtn').click(); 'ok'")
time.sleep(1.2)
ev("document.getElementById('situation').value='我母亲75岁，在广州天河区住，最近记性变差，去医院看了'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(3.0)
ev("window.scrollTo(0,0); 'ok'")
time.sleep(0.6)
shot("p3-10-basis-card2.png")
print("basis:", ev("JSON.stringify([...document.querySelectorAll('.basis-row')].map(r=>r.querySelector('.basis-key').textContent+'='+r.querySelector('.basis-val').textContent.trim()))"))
