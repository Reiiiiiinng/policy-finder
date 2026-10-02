import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
def ev(js, t=40): return run(["eval", "--stdin"], js, t).strip()
js = """(() => {
  const names = [...document.querySelectorAll('.result-name')].map(x => x.textContent);
  return JSON.stringify({changhuxian: names.filter(n => n.indexOf('长护') >= 0).length, all: names});
})()"""
print(ev(js))
