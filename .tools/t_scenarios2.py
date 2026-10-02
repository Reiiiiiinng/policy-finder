import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=40):
    return run(["eval", "--stdin"], js, t).strip()

print("=" * 30)
print("场景2复测：户籍是后不再重复问户籍 + toast")
print("=" * 30)
run(["open", "http://127.0.0.1:8000/discover.html?t=s2b"], None, 40)
time.sleep(0.8)
ev("sessionStorage.clear(); document.getElementById('situation').value='我父亲72岁，一个人在广州生活，最近行动不方便'; sessionStorage.setItem('policy_finder_session', JSON.stringify({beneficiary:'父亲', operator:'女儿'})); 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.0)
print("点户籍=是:", ev("document.querySelector('[data-confirm=hukou][data-value=true]').click(); 'ok'"))
time.sleep(0.5)
print("toast(0.5s后):", ev("(() => { const t=document.getElementById('pfToast'); return t && !t.hidden ? t.textContent : '(无)'; })()"))
time.sleep(1.6)
s = ev("""(() => {
  const lz = [...document.querySelectorAll('.result-card')].find(c=>c.textContent.includes('长寿'));
  return JSON.stringify({
    lzMissing: lz ? [...lz.querySelectorAll('.mi-q')].map(x=>x.textContent) : null,
    stillAsksHukou: document.body.textContent.includes('是否具有广州市户籍'),
    y: Math.round(scrollY), docH: document.documentElement.scrollHeight, cards: document.querySelectorAll('.result-card').length
  });
})()""")
print("户籍=是之后:", s)

print()
print("=" * 30)
print("场景3：本人模式，检查「老人」文案")
print("=" * 30)
run(["open", "http://127.0.0.1:8000/index.html?t=s3"], None, 40)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.querySelector('.choice.entry[data-target=self]').click(); 'ok'")
time.sleep(1.0)
print("当前页:", ev("location.pathname"))
ev("document.getElementById('situation').value='我72岁，一个人在广州生活，最近行动不方便'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.2)
s3 = ev("""(() => {
  const area = document.getElementById('resultArea');
  const txt = area.textContent;
  const olds = (txt.match(/老人/g) || []).length;
  const first = document.querySelector('.result-card');
  return JSON.stringify({
    profileTitle: document.querySelector('.section-title').textContent,
    serviceTarget: [...document.querySelectorAll('.role-row')].slice(0,1).map(r=>r.textContent.replace(/\\s+/g,' ').trim()),
    老人出现次数: olds,
    老人上下文: olds ? (txt.match(/.{6}老人.{6}/g) || []).slice(0,4) : [],
    firstReasons: first ? [...first.querySelectorAll('.reason-list li')].slice(0,2).map(x=>x.textContent) : null,
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
  });
})()""")
print("场景3结果:", s3)
p = os.path.join(W, ".ui-shots", "p2-self.png")
run(["eval", "document.querySelector('.result-card').scrollIntoView(); 'ok'"], None, 30)
run(["screenshot", p], None, 60)
