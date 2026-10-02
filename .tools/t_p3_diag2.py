import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

run(["open", "http://127.0.0.1:8000/family.html?t=p3e"], None, 45)
time.sleep(1.0)
print("factList exists:", ev("!!document.getElementById('factList')"))
print("factList html len:", ev("document.getElementById('factList').innerHTML.length"))
print("err hook:", ev("window.__e=[];window.onerror=function(m){window.__e.push(String(m))}; 'ok'"))
print("click op:", ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'ok'"))
time.sleep(0.3)
print("errors:", ev("JSON.stringify(window.__e)"))
print("factList html:", ev("document.getElementById('factList').innerHTML.slice(0,200)"))
print("typeof factRow:", ev("typeof factRow"))
print("typeof escapeHtml:", ev("typeof escapeHtml"))
