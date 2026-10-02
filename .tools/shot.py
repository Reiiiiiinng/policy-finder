import sys, os
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
name = sys.argv[1] if len(sys.argv) > 1 else "shot.png"
p = os.path.join(W, ".ui-shots", name)
print(run(["screenshot", p], None, 60))
print("exists", os.path.exists(p), os.path.getsize(p) if os.path.exists(p) else 0)
