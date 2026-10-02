import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
js = """(() => {
  const out = {};
  out.hasHScroll = document.documentElement.scrollWidth > innerWidth + 1;
  out.docH = document.documentElement.scrollHeight;
  const cs = (s, props) => { const el = document.querySelector(s); if (!el) return null;
    const c = getComputedStyle(el); const o = {}; props.forEach(p => o[p] = c[p]); return o; };
  out.topH1 = cs('.topbar h1', ['color','fontSize']);
  out.back = cs('.back-link', ['color']);
  out.tag = cs('.theme-tag', ['color','backgroundColor']);
  out.body = cs('body', ['backgroundColor']);
  out.btnCount = document.querySelectorAll('.btn').length;
  out.choiceCount = document.querySelectorAll('.choice').length;
  const btn = document.querySelector('.btn');
  out.btnStyle = btn ? cs('.btn', ['backgroundColor','color','minHeight']) : null;
  return JSON.stringify(out);
})()"""
for page in ["family.html", "discover.html", "self.html", "policy.html?id=gz_elderly_001"]:
    run(["open", "http://127.0.0.1:8000/%s&t=ui1" % page], None, 40)
    time.sleep(1.2)
    r = run(["eval", "--stdin"], js, 40).strip()
    name = page.split('?')[0].replace('.html','')
    print("=====", name, "=====")
    print(r[:900])
    p = os.path.join(W, ".ui-shots", "reg-%s.png" % name)
    run(["screenshot", p], None, 60)
    time.sleep(0.3)
