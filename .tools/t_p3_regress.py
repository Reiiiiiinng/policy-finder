import sys, os, time, json
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

def shot(name):
    run(["screenshot", os.path.join(W, ".ui-shots", name)], None, 60)

run(["set", "viewport", "390", "844"], None, 40)

print("== 回归1：非广州户籍 → 长寿金应被排除 ==")
run(["open", "http://127.0.0.1:8000/index.html?t=r1"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=family]').click(); 'ok'")
time.sleep(1.0)
ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'ok'")
ev("document.querySelector('#beneficiaryGrid .choice[data-role=\"父亲\"]').click(); 'ok'")
ev("document.getElementById('nextBtn').click(); 'ok'")
time.sleep(1.2)
ev("document.getElementById('situation').value='我父亲80岁，在佛山住，最近行动不方便'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(3.0)
print("卡数(非穗户籍):", ev("document.querySelectorAll('.result-card').length"),
      "含长寿:", ev("document.body.textContent.includes('长寿保健金')"))

print()
print("== 回归2：补充信息点击后滚动位置保持 + 分析依据同步 ==")
run(["open", "http://127.0.0.1:8000/index.html?t=r2"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=family]').click(); 'ok'")
time.sleep(1.0)
ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'ok'")
ev("document.querySelector('#beneficiaryGrid .choice[data-role=\"父亲\"]').click(); 'ok'")
ev("document.getElementById('nextBtn').click(); 'ok'")
time.sleep(1.2)
ev("document.getElementById('situation').value='我父亲72岁，广州户籍，最近行动不方便'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(3.0)
btn = ev("""(() => {
  const b = document.querySelector('[data-confirm=hukou][data-value=true]');
  b.scrollIntoView({block:'center'});
  return Math.round(b.getBoundingClientRect().top);
})()""")
print("点击前按钮视口Y:", btn)
ev("""(() => {
  const b = document.querySelector('[data-confirm=hukou][data-value=true]');
  window.__vy = b.getBoundingClientRect().top;
  b.click(); return 'ok';
})()""")
time.sleep(2.2)
print("点击后按钮视口Y:", ev("(() => { const b = document.querySelector('[data-confirm=hukou][data-value=true]'); return b ? Math.round(b.getBoundingClientRect().top) : 'gone'; })()"),
      " 基准:", ev("Math.round(window.__vy)"))
print("toast:", ev("(() => { const t=document.getElementById('pfToast'); return t ? t.textContent : '(无)'; })()"))
print("basis含户籍:", ev("(() => { const r=[...document.querySelectorAll('.basis-row')]; const x=r.find(e=>e.querySelector('.basis-key').textContent.includes('户籍')); return x ? x.querySelector('.basis-val').textContent : '(无该行)'; })()"))
print("长寿金卡不再问户籍:", ev("!(() => { const c=[...document.querySelectorAll('.result-card')].find(c=>c.textContent.includes('长寿')); return c ? [...c.querySelectorAll('.mi-q')].some(x=>x.textContent.includes('户籍')) : false; })()"))

# 分析依据卡尾部（todo 状态 + 底注）
ev("document.querySelector('.basis-card').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.5)
shot("p3-11-basis-tail.png")
