"""
给「带着刚才查看的政策返回」截一张 390 宽的效果图。

    python .tools/return-shot.py

需要先启动服务：python backend/server.py
产出：.ui-shots/fix/return-bar.png
"""

import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:8000"
PAGE_DST = os.path.join(ROOT, "frontend", "_shot.html")
OUT = os.path.join(ROOT, ".ui-shots", "fix", "return-bar.png")

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]

# 先落到一个中转页：写好会话再跳到发现权益，并带上 back 参数
REDIRECT_PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script>
sessionStorage.setItem('policy_finder_session', JSON.stringify({
  target:'parents', operator:'\u5973\u513f', beneficiary:'\u7236\u4eb2', confirmed:true,
  text:'\u6211\u7236\u4eb272\u5c81\uff0c\u4e00\u4e2a\u4eba\u5728\u5e7f\u5dde\u751f\u6d3b\uff0c\u6700\u8fd1\u884c\u52a8\u4e0d\u4fbf\u3002',
  profile:{}, demo:false, demoBanner:false}));
location.replace('/discover.html?focus=scene&back=gz_elderly_002');
</script></body></html>
"""


def main():
    edge = next((p for p in EDGE_CANDIDATES if os.path.exists(p)), None)
    if not edge:
        print("未找到本机浏览器")
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(PAGE_DST, "w", encoding="utf-8") as f:
        f.write(REDIRECT_PAGE)

    # 不清理临时 profile（避免触发批量删除），交给系统临时目录自行回收
    profile = tempfile.mkdtemp(prefix="rshot_")
    subprocess.run([
        edge, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--user-data-dir=" + profile,
        "--window-size=390,2100",
        "--virtual-time-budget=30000",
        "--screenshot=" + OUT,
        BASE + "/_shot.html",
    ], capture_output=True, timeout=180)

    if os.path.exists(PAGE_DST):
        os.remove(PAGE_DST)

    print("截图：" + OUT if os.path.exists(OUT) else "截图未生成")
    return 0 if os.path.exists(OUT) else 1


if __name__ == "__main__":
    sys.exit(main())
