import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
run(["set", "viewport", "390", "844"], None, 30)
run(["open", "http://127.0.0.1:8000/family.html?t=p2"], None, 40)
time.sleep(0.8)

check = """(() => {
  const g = (s) => document.querySelector(s);
  return JSON.stringify({
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
    steps: [...document.querySelectorAll('#stepsBar .step')].map(s => ({
      n: s.dataset.step, active: s.classList.contains('active'), done: s.classList.contains('done')
    })),
    facts: [...document.querySelectorAll('.fact-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim()),
    opName: g('#operatorVal').textContent,
    benName: g('#beneficiaryVal').textContent,
    nextDisabled: g('#nextBtn').disabled,
    nextBtnH: Math.round(g('#nextBtn').getBoundingClientRect().height),
    gridBtnH: Math.round(document.querySelector('#operatorGrid .choice').getBoundingClientRect().height),
  });
})()"""
print("初始:", run(["eval", "--stdin"], check, 40).strip())

# 选择女儿 + 父亲
run(["eval", "document.querySelector('#operatorGrid .choice[data-role=女儿]').click(); 'ok'"], None, 30)
run(["eval", "document.querySelector('#beneficiaryGrid .choice[data-role=父亲]').click(); 'ok'"], None, 30)
time.sleep(0.4)
print("选择后:", run(["eval", "--stdin"], check, 40).strip())

# 勾选确认
run(["eval", "document.getElementById('confirmCheck').click(); 'ok'"], None, 30)
time.sleep(0.3)
print("勾选后:", run(["eval", "--stdin"], check, 40).strip())
p = os.path.join(W, ".ui-shots", "p2-family.png")
run(["screenshot", p], None, 60)
