import sys, os, time, json
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

run(["set", "viewport", "390", "844"], None, 30)
run(["open", "http://127.0.0.1:8000/discover.html?t=p2"], None, 40)
time.sleep(0.8)
# 直接触发，不等 UI 点击
js_fill = """(() => {
  document.getElementById('situation').value = '我父亲72岁，一个人在广州生活，最近行动不方便';
  sessionStorage.setItem('policy_finder_session', JSON.stringify({beneficiary:'父亲', operator:'女儿'}));
  return 'ok';
})()"""
print("fill:", run(["eval", "--stdin"], js_fill, 30).strip())

# 点击后立刻采样 AI 流程状态（抢在任何 await 完成前不一定成功，先看最终 DOM）
run(["eval", "document.getElementById('discoverBtn').click(); 'clicked'"], None, 30)
time.sleep(2.0)

check = """(() => {
  const card = document.querySelector('.result-card');
  const src = document.querySelector('.rc-block.is-trust');
  const miss = document.querySelector('.rc-block.is-warm');
  const strip = document.querySelector('.ai-done-strip');
  return JSON.stringify({
    cards: document.querySelectorAll('.result-card').length,
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
    aiStrip: strip ? strip.textContent.replace(/\\s+/g,' ').trim().slice(0,80) : null,
    badges: card ? [...card.querySelectorAll('.badge')].map(b => b.textContent) : null,
    hasReason: !!document.querySelector('.rc-block .rc-label'),
    labels: [...document.querySelectorAll('.rc-label')].slice(0,3).map(x => x.textContent),
    missWhy: miss ? miss.querySelector('.mi-why').textContent : null,
    srcRows: src ? [...src.querySelectorAll('.src-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim()) : null,
    foot: card ? card.querySelector('.result-foot').textContent.replace(/\\s+/g,' ').trim() : null,
    btnMinH: (() => { const b = document.querySelector('.btn'); return b ? Math.round(b.getBoundingClientRect().height) : null; })(),
  });
})()"""
print(run(["eval", "--stdin"], check, 40).strip())
p = os.path.join(W, ".ui-shots", "p2-card.png")
run(["eval", "document.querySelector('.result-card').scrollIntoView(); 'ok'"], None, 30)
run(["screenshot", p], None, 60)
