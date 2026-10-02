import sys, os
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
js = "window.scrollTo(0, %s); window.scrollY" % sys.argv[1]
print(run(["eval", js], None, 40))
p = os.path.join(W, ".ui-shots", sys.argv[2])
print(run(["screenshot", p], None, 60))
