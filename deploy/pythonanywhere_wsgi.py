# PythonAnywhere WSGI 配置
#
# 用法：PythonAnywhere 后台 → Web → Add a new web app → 选 Manual configuration →
# 选 Python 3.10（或你实际用的版本）→ 在页面的 "WSGI configuration file" 链接里
# 把整个文件内容替换成下面这段（把 USERNAME 改成你的用户名）。
#
# 这个文件不用提交到仓库，PUT_HERE 只是留个备份和说明。

import sys

# 把仓库根目录加进模块搜索路径。PythonAnywhere 里仓库一般放在 ~/policy-finder。
# 下面两行二选一：克隆在 home 下用第一行；放在别的路径就改第一行。
PROJECT_DIR = "/home/USERNAME/policy-finder"

if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

# 让 server.py 能 import 到同目录的 policy_engine
BACKEND_DIR = PROJECT_DIR + "/backend"
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# 公网部署：关掉 /__e2e_log 调试端点（本地测试不受影响）
import os
os.environ.setdefault("POLICY_ENV", "production")

from server import application  # noqa: E402
