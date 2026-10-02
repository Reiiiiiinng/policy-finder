import sys, os, time, json
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

# 冷启动：清缓存 + 强刷
run(["open", "http://127.0.0.1:8000/discover.html?t=cold1"], None, 45)
time.sleep(0.8)
ev("sessionStorage.clear(); 'ok'")
ev("window.__err=[]; window.onerror=(m,s,l,c,e)=>{window.__err.push(String(m)+' @'+l+':'+c)}; 'ok'")
ev("location.reload(true); 'ok'")
time.sleep(2.5)
print("reloaded page:", ev("location.pathname + location.search"))
print("errors:", ev("JSON.stringify(window.__err || [])"))
print("situation exists:", ev("!!document.getElementById('situation')"))
ev("document.getElementById('situation').value='父亲现年88岁现居越秀区洪桥街，需申请高龄重度失能老人照顾看护': 'ok'")
ev("document.getElementById('discoverBtn').click(); 'ok'")
time.sleep(3.5)
print("errors2:", ev("JSON.stringify(window.__err || [])"))
print("cards:", ev("document.querySelectorAll('.result-card').length"))

# 全量 dump AI 区域
print("---- resultAnchor 之后、第一张卡之前的 DOM ----")
print(ev("""(() => {
  const anchor = document.getElementById('resultAnchor');
  if (!anchor) return 'no anchor';
  let out = [], n = anchor.nextElementSibling;
  let guard = 0;
  while (n && !n.classList.contains('result-card') && guard++ < 12) {
    out.push(n.className + ' :: ' + n.outerHTML.replace(/\\s+/g,' ').slice(0, 400));
    n = n.nextElementSibling;
  }
  return JSON.stringify(out, null, 1);
})()"""))
print("---- JS 静态检查：全文是否含 a:1 ----")
print(ev("""(() => {
  const hits = [];
  performance.getEntriesByType('resource').forEach(r => {
    if (!/\.js$/.test(r.name)) return;
    hits.push(r.name);
  });
  return JSON.stringify({isRefresh:false, scripts: hits});
})()"""))
