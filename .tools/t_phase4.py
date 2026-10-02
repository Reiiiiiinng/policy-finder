import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

def shot(name):
    run(["screenshot", os.path.join(W, ".ui-shots", name)], None, 60)

def flowinfo(tag):
    return ev("JSON.stringify({hScroll: document.documentElement.scrollWidth > innerWidth + 1, docW: document.documentElement.scrollWidth, iw: innerWidth, minBtn: Math.min(...[...document.querySelectorAll('button')].map(b=>Math.round(b.getBoundingClientRect().height)))})")

run(["set", "viewport", "390", "844"], None, 40)

print("=" * 32)
print("测试1：首页核心理念区 + 演示入口")
print("=" * 32)
run(["open", "http://127.0.0.1:8000/index.html?t=p4a"], None, 45)
time.sleep(1.0)
ev("sessionStorage.clear(); 'ok'")
run(["open", "http://127.0.0.1:8000/index.html?t=p4a2"], None, 45)
time.sleep(1.6)
print("理念卡:", ev("""(() => {
  const c = document.querySelector('.idea-card');
  if (!c) return 'NO CARD';
  return JSON.stringify({
    title: c.querySelector('.idea-title').textContent,
    beforeTag: c.querySelector('.idea-row:not(.is-now) .idea-tag').textContent,
    beforeName: c.querySelector('.idea-row:not(.is-now) .idea-name').textContent,
    nowTag: c.querySelector('.idea-row.is-now .idea-tag').textContent,
    nowName: c.querySelector('.idea-row.is-now .idea-name').textContent,
    shift: c.querySelector('.idea-shift').textContent.trim(),
    foot: c.querySelector('.idea-foot').textContent.replace(/\\s+/g,' ').trim()
  });
})()"""))
print("演示入口:", ev("document.getElementById('demoEntry').textContent.replace(/\\s+/g,' ').trim()"))
print("布局:", flowinfo("index"))
ev("document.querySelector('.idea-card').scrollIntoView({block:'start'}); 'ok'")
time.sleep(0.5)
shot("p4-1-idea.png")
ev("document.getElementById('demoEntry').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.4)
shot("p4-2-demo-entry.png")

print()
print("=" * 32)
print("测试2：首页演示入口一键直达结果")
print("=" * 32)
ev("document.getElementById('demoEntry').click(); 'ok'")
time.sleep(3.2)
print("落地页:", ev("location.pathname"))
print("已填入:", ev("document.getElementById('situation').value"))
print("自动匹配结果数:", ev("document.querySelectorAll('.result-card').length"))
print("场景区:", ev("""(() => {
  const b = document.querySelector('.scene-box');
  if (!b) return 'NO SCENE BOX';
  return JSON.stringify({
    lead: b.querySelector('.scene-lead').textContent.trim(),
    groups: [...b.querySelectorAll('.scene-row')].map(r => ({
      name: r.querySelector('.scene-name').textContent.replace(/\\s+/g,' ').trim(),
      types: (r.querySelector('.scene-types')||{}).textContent,
      policies: [...r.querySelectorAll('.scene-policies span')].map(s=>s.textContent)
    }))
  });
})()"""))
print("布局:", flowinfo("discover"))
ev("document.querySelector('.scene-box').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.5)
shot("p4-3-scenes.png")

print()
print("=" * 32)
print("测试3：空状态（外地描述）")
print("=" * 32)
run(["open", "http://127.0.0.1:8000/index.html?t=p4b"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=family]').click(); 'ok'")
time.sleep(1.0)
ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'ok'")
ev("document.querySelector('#beneficiaryGrid .choice[data-role=\"父亲\"]').click(); 'ok'")
ev("document.getElementById('nextBtn').click(); 'ok'")
time.sleep(1.2)
ev("document.getElementById('situation').value='我父亲在佛山住，最近身体还行'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(3.0)
print("卡片数:", ev("document.querySelectorAll('.result-card').length"))
print("空状态卡:", ev("""(() => {
  const c = document.querySelector('.empty-card');
  if (!c) return 'NO EMPTY CARD';
  return JSON.stringify({
    title: c.querySelector('.empty-title').textContent,
    sub: c.querySelector('.empty-sub').textContent.replace(/\\s+/g,' ').trim(),
    labels: [...c.querySelectorAll('.empty-block-label')].map(x=>x.textContent),
    reasons: [...c.querySelectorAll('.empty-block')[0].querySelectorAll('.reason-key')].map(x=>x.textContent),
    nextCount: c.querySelectorAll('.empty-block')[1].querySelectorAll('li').length,
    actions: [...c.querySelectorAll('[data-empty-act]')].map(b=>b.dataset.emptyAct + ':' + b.textContent.trim())
  });
})()"""))
print("布局:", flowinfo("empty"))
ev("document.querySelector('.empty-card').scrollIntoView({block:'start'}); 'ok'")
time.sleep(0.5)
shot("p4-4-empty.png")

print()
print("=" * 32)
print("测试4：空状态按钮「用演示案例试试」")
print("=" * 32)
ev("document.querySelector('[data-empty-act=demo]').click(); 'ok'")
time.sleep(3.2)
print("点击后卡片数:", ev("document.querySelectorAll('.result-card').length"))
print("场景区存在:", ev("!!document.querySelector('.scene-box')"))

print()
print("=" * 32)
print("测试5：本人模式演示案例 + 无「老人」")
print("=" * 32)
run(["open", "http://127.0.0.1:8000/self.html?t=p4c"], None, 45)
time.sleep(1.0)
ev("sessionStorage.clear(); 'ok'")
run(["open", "http://127.0.0.1:8000/self.html?t=p4c2"], None, 45)
time.sleep(1.2)
print("案例卡存在:", ev("!!document.getElementById('caseBtn')"))
ev("document.getElementById('caseBtn').click(); 'ok'")
time.sleep(3.2)
print("本人模式结果数:", ev("document.querySelectorAll('.result-card').length"))
print("场景区:", ev("(document.querySelector('.scene-lead')||{}).textContent"))
print("结果区含「老人」次数:", ev("""(() => {
  const a = document.getElementById('resultArea');
  return (a.textContent.match(/老人/g)||[]).length;
})()"""))
print("布局:", flowinfo("self"))
ev("document.querySelector('.scene-box').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.5)
shot("p4-5-self-scenes.png")
