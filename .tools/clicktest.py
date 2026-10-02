import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
# 依次验证三个入口的目标页
targets = ["parents", "family", "self"]
for t in targets:
    run(["open", "http://127.0.0.1:8000/index.html?t=route"], None, 40)
    run(["eval", "document.querySelector('.choice.entry[data-target=%s]').click(); 'clicked'" % t], None, 40)
    time.sleep(1.2)
    url = run(["eval", "location.pathname"], None, 40).strip()
    print(t, "->", url)
