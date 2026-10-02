import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
def ev(js, t=40): return run(["eval", "--stdin"], js, t).strip()
run(["set", "viewport", "390", "844"], None, 30)
run(["open", "http://127.0.0.1:8000/discover.html?t=last"], None, 40)
time.sleep(0.8)
ev("sessionStorage.clear(); document.getElementById('situation').value='我父亲72岁，一个人在广州生活，最近行动不方便'; sessionStorage.setItem('policy_finder_session', JSON.stringify({beneficiary:'父亲', operator:'女儿'})); 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.0)
ev("document.querySelector('[data-confirm=hukou][data-value=true]').click(); 'ok'")
time.sleep(1.5)
ev("document.querySelector('[data-confirm=insurance][data-value=false]').click(); 'ok'")
time.sleep(1.5)
print("结果卡里的待确认项是否还包含户籍/医保问题:",
      ev("JSON.stringify({hukou: [...document.querySelectorAll('.mi-q')].some(x=>x.textContent.includes('户籍')), yibao: [...document.querySelectorAll('.mi-q')].some(x=>x.textContent.includes('医保'))})"))
print("长护险是否被正确排除（医保=否）:", ev("JSON.stringify([...document.querySelectorAll('.result-name')].map(x=>x.textContent).filter(n=>n.includes('长护')).length"))
p = os.path.join(W, ".ui-shots", "p2-final.png")
run(["eval", "document.querySelector('.result-card').scrollIntoView(); 'ok'"], None, 30)
run(["screenshot", p], None, 60)
