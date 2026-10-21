import sys, os, time
W = r"D:/Codex/policy-finder/政策找人"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
# 首页重设计后入口分流验证（2026-10-20 适配新结构）：
# - 旧三纵卡（我的父母/我的长辈/我自己）已由家庭画像卡主按钮（data-target="parents"，
#   跳 family.html）与「为自己查找」（data-target="self"，跳 self.html）承接；
# - 「我的长辈」语义由 family.html「其他关系」折叠区承接，不再有独立
#   data-target="family"，故 targets 由 3 项改为 2 项（断言语义等价：
#   两条跳转契约都必须真实可达）。
# 运行前提：本地服务已启动（python backend/server.py）。
# 已知限制：依赖 agent-browser CLI，当前机器未安装时无法执行
#（改前基线 2026-10-20 已记录该既有失败，非本次改动引入）。
targets = [("parents", "family.html"), ("self", "self.html")]
fails = 0
for t, expect in targets:
    run(["open", "http://127.0.0.1:8000/index.html?t=route"], None, 40)
    run(["eval", "document.querySelector('[data-target=%s]').click(); 'clicked'" % t], None, 40)
    time.sleep(1.2)
    url = run(["eval", "location.pathname"], None, 40).strip()
    ok = expect in url
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + t + " -> " + url + " (期望含 " + expect + ")")
print("通过 %d，失败 %d" % (len(targets) - fails, fails))
sys.exit(1 if fails else 0)
