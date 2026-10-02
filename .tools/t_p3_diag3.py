import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

run(["open", "http://127.0.0.1:8000/family.html?t=p3f"], None, 45)
time.sleep(1.0)
print("A count .fact-row:", ev("document.querySelectorAll('.fact-row').length"))
print("B count #factList .fact-row:", ev("document.querySelectorAll('#factList .fact-row').length"))
print("C factList children:", ev("document.getElementById('factList').children.length"))
print("D body contains 查询关系:", ev("document.body.textContent.includes('查询关系')"))
print("E factList parent chain:", ev("(()=>{let e=document.getElementById('factList'),out=[];while(e&&out.length<6){out.push(e.tagName+'.'+(e.className||''));e=e.parentElement}return JSON.stringify(out)})()"))
