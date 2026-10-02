import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

def shot(name):
    run(["screenshot", os.path.join(W, ".ui-shots", name)], None, 60)

def layout():
    return ev("JSON.stringify({hScroll: document.documentElement.scrollWidth > innerWidth + 1, minBtn: Math.min(...[...document.querySelectorAll('button')].map(b=>Math.round(b.getBoundingClientRect().height)))})")

run(["set", "viewport", "390", "844"], None, 40)

print("=" * 30)
print("1. 首页演示按钮 → 弹出确认卡（不跳转）")
print("=" * 30)
run(["open", "http://127.0.0.1:8000/index.html?t=p6a"], None, 45)
time.sleep(1.4)
ev("sessionStorage.clear(); 'ok'")
run(["open", "http://127.0.0.1:8000/index.html?t=p6a2"], None, 45)
time.sleep(1.4)
ev("document.getElementById('demoEntry').click(); 'ok'")
time.sleep(0.6)
print("落地(应仍在首页):", ev("location.pathname"))
print("确认卡存在:", ev("!!document.getElementById('demoOverlay')"))
print("确认卡内容:", ev("""(() => {
  const c = document.querySelector('.demo-confirm-card');
  if (!c) return 'NO';
  return JSON.stringify({
    title: c.querySelector('.demo-confirm-title').textContent,
    rows: [...c.querySelectorAll('.dc-row')].map(r => r.querySelector('.k').textContent + '=' + r.querySelector('.v').textContent),
    note: c.querySelector('.demo-confirm-note').textContent.replace(/\\s+/g,' ').trim(),
    confirmBtn: document.getElementById('demoConfirmBtn').textContent,
    cancelBtn: document.getElementById('demoCancelBtn').textContent
  });
})()"""))
print("布局:", layout())
shot("p6-1-confirm.png")

print()
print("=" * 30)
print("2. 取消 → 确认卡移除")
print("=" * 30)
ev("document.getElementById('demoCancelBtn').click(); 'ok'")
time.sleep(0.4)
print("确认卡移除:", ev("!document.getElementById('demoOverlay')"))

print()
print("=" * 30)
print("3. 确认 → 家庭页（进度①高亮 + banner）")
print("=" * 30)
ev("document.getElementById('demoEntry').click(); 'ok'")
time.sleep(0.5)
ev("document.getElementById('demoConfirmBtn').click(); 'ok'")
time.sleep(1.4)
print("落地:", ev("location.pathname"))
print("banner:", ev("!!document.querySelector('.demo-banner')"))
print("banner含「虚拟」:", ev("(document.querySelector('.demo-banner-note')||{}).textContent"))
print("重置按钮:", ev("!!document.getElementById('demoResetBtn')"))
print("进度条:", ev("""(() => {
  const p = document.querySelector('.demo-progress');
  if (!p) return 'NO';
  const steps = [...p.querySelectorAll('.dstep')];
  return JSON.stringify({
    count: steps.length,
    labels: steps.map(s=>s.querySelector('.dstep-label').textContent),
    active: steps.find(s=>s.classList.contains('active'))?.querySelector('.dstep-label').textContent,
    done: steps.filter(s=>s.classList.contains('done')).length
  });
})()"""))
print("operator回填:", ev("document.querySelector('#operatorGrid .choice.selected')?.dataset.role"))
print("布局:", layout())
ev("document.querySelector('.demo-progress').scrollIntoView({block:'start'}); 'ok'")
time.sleep(0.4)
shot("p6-3-family.png")

print()
print("=" * 30)
print("4. 下一步 → 发现页（进度②高亮 + 填入不跑）")
print("=" * 30)
ev("document.getElementById('nextBtn').click(); 'ok'")
time.sleep(1.4)
print("落地:", ev("location.pathname"))
print("进度active:", ev("document.querySelector('.dstep.active .dstep-label')?.textContent"))
print("input:", ev("document.getElementById('situation').value"))
print("卡片数(应=0):", ev("document.querySelectorAll('.result-card').length"))
print("布局:", layout())
ev("document.getElementById('situation').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.4)
shot("p6-4-discover.png")

print()
print("=" * 30)
print("5. 开始发现 → 进度③高亮")
print("=" * 30)
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(3.4)
print("卡片数:", ev("document.querySelectorAll('.result-card').length"))
print("进度active:", ev("document.querySelector('.dstep.active .dstep-label')?.textContent"))
print("进度done数:", ev("document.querySelectorAll('.dstep.done').length"))
print("布局:", layout())

print()
print("=" * 30)
print("6. 点结果卡 → 详情页（进度④高亮）")
print("=" * 30)
ev("document.querySelector('.result-card').click(); 'ok'")
time.sleep(2.4)
print("落地:", ev("location.pathname + location.search"))
print("进度active:", ev("document.querySelector('.dstep.active .dstep-label')?.textContent"))
print("五问:", ev("JSON.stringify([...document.querySelectorAll('.q-title')].map(x=>x.textContent))"))
print("布局:", layout())
ev("document.querySelector('.demo-progress').scrollIntoView({block:'start'}); 'ok'")
time.sleep(0.4)
shot("p6-6-detail.png")

print()
print("=" * 30)
print("7. 重新体验 → 清session回首页")
print("=" * 30)
ev("document.getElementById('demoResetBtn').click(); 'ok'")
time.sleep(1.4)
print("落地(应首页):", ev("location.pathname"))
print("banner(应无):", ev("!!document.querySelector('.demo-banner')"))
print("进度条(应无):", ev("!!document.querySelector('.demo-progress')"))
print("session已清:", ev("JSON.stringify(sessionStorage.getItem('policy_finder_session'))"))

print()
print("=" * 30)
print("8. 正常用户流程不受影响")
print("=" * 30)
run(["open", "http://127.0.0.1:8000/index.html?t=p6b"], None, 45)
time.sleep(1.0)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=parents]').click(); 'ok'")
time.sleep(1.2)
print("正常入口落地:", ev("location.pathname"))
print("banner(应无):", ev("!!document.querySelector('.demo-banner')"))
print("进度条(应无):", ev("!!document.querySelector('.demo-progress')"))
