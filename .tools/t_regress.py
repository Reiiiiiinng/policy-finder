import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=40):
    return run(["eval", "--stdin"], js, t).strip()

run(["set", "viewport", "390", "844"], None, 30)

# 1) 从发现页进详情再返回：家庭页状态条应反映已答事实
run(["open", "http://127.0.0.1:8000/discover.html?t=rg"], None, 40)
time.sleep(0.8)
ev("sessionStorage.clear(); document.getElementById('situation').value='我父亲72岁，一个人在广州生活，最近行动不方便'; sessionStorage.setItem('policy_finder_session', JSON.stringify({beneficiary:'父亲', operator:'女儿'})); 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(2.0)
ev("document.querySelector('[data-confirm=hukou][data-value=true]').click(); 'ok'")
time.sleep(1.6)
ev("document.querySelector('[data-confirm=insurance][data-value=false]').click(); 'ok'")
time.sleep(1.6)
print("答完户籍=是/医保=否后，卡上是否还问医保:", ev("document.body.textContent.includes('是否参加广州市社会医疗保险')"))
run(["open", "http://127.0.0.1:8000/family.html?t=rg"], None, 40)
time.sleep(0.8)
print("返回家庭页状态条:", ev("JSON.stringify([...document.querySelectorAll('.fact-row')].map(r=>r.textContent.replace(/\\s+/g,' ').trim()))"))

# 2) 四页横向滚动与最小按钮高度总检
for page in ["index.html", "family.html", "discover.html", "self.html", "policy.html?id=gz_elderly_001"]:
    run(["open", "http://127.0.0.1:8000/%s&t=rg" % page], None, 40)
    time.sleep(1.0)
    r = ev("""(() => {
      const hs = document.documentElement.scrollWidth > innerWidth + 1;
      const btns = [...document.querySelectorAll('.btn')].map(b => Math.round(b.getBoundingClientRect().height));
      const minBtn = btns.length ? Math.min(...btns) : null;
      return JSON.stringify({page: location.pathname, hScroll: hs, minBtnH: minBtn, docH: document.documentElement.scrollHeight});
    })()""")
    print(r)
