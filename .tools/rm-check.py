import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
run(["set", "media", "reduced-motion"], None, 30)
run(["open", "http://127.0.0.1:8000/index.html?t=rm"], None, 40)
time.sleep(0.8)
js = """(() => {
  const el = document.querySelector('.hero');
  const cs = getComputedStyle(el);
  return JSON.stringify({animationDuration: cs.animationDuration, animationName: cs.animationName});
})()"""
print("reduced-motion:", run(["eval", "--stdin"], js, 40).strip())
run(["set", "media", "light"], None, 30)
time.sleep(0.5)
print("normal:", run(["eval", "--stdin"], js, 40).strip())
