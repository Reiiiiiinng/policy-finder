import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=40):
    return run(["eval", "--stdin"], js, t).strip()

# 场景3复测
run(["open", "http://127.0.0.1:8000/self.html?t=f"], None, 40)
time.sleep(0.8)
ev("sessionStorage.clear(); document.getElementById('situation').value='我72岁，一个人在广州生活，最近行动不方便'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.2)
print("本人模式「老人」出现次数:", ev("(document.getElementById('resultArea').textContent.match(/老人/g)||[]).length"))
print("本人模式接口:", ev("JSON.stringify(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/api/')).map(n=>n.split('/api/')[1]))"))
p = os.path.join(W, ".ui-shots", "p2-self.png")
run(["eval", "document.querySelector('.result-card').scrollIntoView(); 'ok'"], None, 30)
run(["screenshot", p], None, 60)

# 真实点击路径的滚动保持验证（按钮可见时点击）
run(["open", "http://127.0.0.1:8000/discover.html?t=f2"], None, 40)
time.sleep(0.8)
ev("sessionStorage.clear(); document.getElementById('situation').value='我父亲72岁，一个人在广州生活，最近行动不方便'; sessionStorage.setItem('policy_finder_session', JSON.stringify({beneficiary:'父亲', operator:'女儿'})); 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.0)
# 滚到按钮可见位置再点
prep = ev("""(() => {
  const b = document.querySelector('[data-confirm=hukou][data-value=true]');
  b.scrollIntoView({block:'center'});
  return JSON.stringify({y: Math.round(scrollY), vp: Math.round(b.getBoundingClientRect().top)});
})()""")
print("滚动到按钮:", prep)
ev("document.querySelector('[data-confirm=hukou][data-value=true]').click(); 'ok'")
time.sleep(1.8)
print("点击后:", ev("""(() => {
  const b = document.querySelector('[data-confirm=hukou][data-value=true]');
  return JSON.stringify({y: Math.round(scrollY), vp: b ? Math.round(b.getBoundingClientRect().top) : null});
})()"""))
