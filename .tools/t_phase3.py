import sys, os, time, json
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

SHOT = os.path.join(W, ".ui-shots")
os.makedirs(SHOT, exist_ok=True)


def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()


def shot(name):
    run(["screenshot", os.path.join(SHOT, name)], None, 60)


print("=" * 34)
print("第三阶段 · 家庭模式全流程 390x844")
print("=" * 34)
run(["open", "http://127.0.0.1:8000/index.html?t=p3a"], None, 45)
time.sleep(0.8)
run(["set", "viewport", "390", "844"], None, 40)
ev("sessionStorage.clear(); 'ok'")
print("首页 -> " + ev("document.querySelector('.choice.entry[data-target=parents]').click(); location.pathname"))
time.sleep(1.0)
print("当前页:", ev("location.pathname"))

ev("document.querySelector('#operatorGrid .choice[data-role=\"女儿\"]').click(); 'ok'")
ev("document.querySelector('#beneficiaryGrid .choice[data-role=\"父亲\"]').click(); 'ok'")
ev("document.getElementById('confirmCheck').click(); 'ok'")
time.sleep(0.4)
print("关系条:", ev("JSON.stringify([...document.querySelectorAll('.fact-row')].map(r=>r.textContent.replace(/\\s+/g,' ').trim()))"))
shot("p3-1-family.png")

ev("document.getElementById('nextBtn').click(); 'ok'")
time.sleep(1.2)
print("到发现页:", ev("location.pathname"))
ev("document.getElementById('situation').value='我父亲72岁，广州户籍，一个人在家里住，最近走路不太稳，洗澡也困难'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.6)

base = ev("""(() => {
  const rows = [...document.querySelectorAll('.basis-row')].map(r => ({
    cls: r.className.replace('basis-row ',''),
    k: r.querySelector('.basis-key').textContent,
    v: r.querySelector('.basis-val').textContent
  }));
  return JSON.stringify({
    profileTitle: document.querySelectorAll('.section-title')[0].textContent,
    strip: (document.querySelector('.ai-done-strip')||{}).textContent,
    basisRows: rows,
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
    cards: document.querySelectorAll('.result-card').length
  });
})()""")
print("分析依据区:", base)
shot("p3-2-discover-top.png")

# 点第一张政策卡 -> 详情页
ev("document.querySelector('.result-card').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.3)
ev("document.querySelector('.result-card').click(); 'ok'")
time.sleep(2.2)
print("到详情页:", ev("location.pathname + location.search"))

d = ev("""(() => {
  const q = [...document.querySelectorAll('.q-title')].map(x=>x.textContent);
  const tc = document.querySelector('.trust-card');
  const rows = tc ? [...tc.querySelectorAll('.tc-row')].map(r=>r.querySelector('.k').textContent + '=' + r.querySelector('.v').textContent.trim()) : [];
  return JSON.stringify({
    headings: q,
    hasTrustCard: !!tc,
    tcRows: rows,
    tcStatus: tc ? tc.querySelector('.tc-status').textContent.replace(/\\s+/g,' ').trim() : null,
    tcLink: tc ? ((tc.querySelector('.tc-link')||{}).href || tc.querySelector('.tc-none').textContent.replace(/\\s+/g,' ').trim()) : null,
    badge: (document.querySelector('.card .badge')||{}).textContent,
    minBtn: Math.min(...[...document.querySelectorAll('button, .tc-link')].map(b=>Math.round(b.getBoundingClientRect().height))),
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
    docW: document.documentElement.scrollWidth
  });
})()""")
print("详情页:", d)
shot("p3-3-policy-top.png")
ev("document.querySelector('.trust-card').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.4)
shot("p3-4-policy-source.png")

print()
print("=" * 34)
print("待核验政策（007 老年人健康管理）来源卡片")
print("=" * 34)
run(["open", "http://127.0.0.1:8000/policy.html?id=gz_elderly_007&t=p3b"], None, 45)
time.sleep(2.2)
d2 = ev("""(() => {
  const tc = document.querySelector('.trust-card');
  return JSON.stringify({
    headings: [...document.querySelectorAll('.q-title')].map(x=>x.textContent),
    verBadge: tc.querySelector('.tc-status .badge').textContent,
    rows: [...tc.querySelectorAll('.tc-row')].map(r=>r.querySelector('.k').textContent + '=' + r.querySelector('.v').textContent.trim()),
    linkNone: (tc.querySelector('.tc-none')||{}).textContent ? tc.querySelector('.tc-none').textContent.replace(/\\s+/g,' ').trim() : null,
    processWarn: (document.querySelector('.detail-block.is-warm ~ .detail-block .q-lead, .detail-block .q-lead')||{}).textContent
  });
})()""")
print("007:", d2)
ev("document.querySelector('.trust-card').scrollIntoView({block:'center'}); 'ok'")
time.sleep(0.4)
shot("p3-5-policy-007.png")

print()
print("=" * 34)
print("本人模式详情页：不得出现「老人」")
print("=" * 34)
run(["open", "http://127.0.0.1:8000/self.html?t=p3c"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("document.getElementById('situation').value='我72岁，广州户籍，最近走路不太稳，洗澡也困难'; 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.6)
s3 = ev("""(() => {
  const rows = [...document.querySelectorAll('.basis-row')].map(r=>r.querySelector('.basis-key').textContent + '=' + r.querySelector('.basis-val').textContent.trim());
  return JSON.stringify(rows);
})()""")
print("本人模式分析依据:", s3)
ev("document.querySelector('.result-card').click(); 'ok'")
time.sleep(2.2)
s4 = ev("""(() => {
  const txt = document.getElementById('content').textContent;
  return JSON.stringify({
    老人次数: (txt.match(/老人/g)||[]).length,
    上下文: (txt.match(/.{8}老人.{8}/g)||[]).slice(0,3),
    为什么推荐标题: [...document.querySelectorAll('.q-title')].map(x=>x.textContent)[1],
    miWhys: [...document.querySelectorAll('.mi-why')].slice(0,2).map(x=>x.textContent),
    hScroll: document.documentElement.scrollWidth > innerWidth + 1
  });
})()""")
print("本人模式详情页:", s4)
shot("p3-6-policy-self.png")
