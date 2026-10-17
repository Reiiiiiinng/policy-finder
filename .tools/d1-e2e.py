"""
D1 专项实测驱动：出门前清单在真实数据上的渲染。
用法：python .tools/d1-e2e.py gz_elderly_010   （广州库，默认服务即可）
      python .tools/d1-e2e.py fs_med_002      （需 POLICY_DB=foshan 启动服务）
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:8000"
PAGE_SRC = os.path.join(ROOT, ".tools", "d1_page.html")
PAGE_DST = os.path.join(ROOT, "frontend", "_d1.html")

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get(path):
    return json.load(OPENER.open(BASE + path, timeout=10))


def main():
    pid = sys.argv[1] if len(sys.argv) > 1 else "gz_elderly_010"
    edge = next((p for p in EDGE_CANDIDATES if os.path.exists(p)), None)
    if not edge:
        print("未找到本机浏览器。")
        return 1
    try:
        get("/api/health")
    except Exception:
        print("后端未启动，请先运行： python backend/server.py")
        return 1

    shutil.copyfile(PAGE_SRC, PAGE_DST)
    get("/__e2e_log")   # 重置

    profile = tempfile.mkdtemp(prefix="d1_")
    print("启动无头浏览器（390×844）…")
    try:
        subprocess.run([
            edge, "--headless=new", "--disable-gpu", "--no-sandbox",
            "--user-data-dir=" + profile,
            "--window-size=390,844",
            "--virtual-time-budget=120000",
            BASE + "/_d1.html?pid=" + pid,
        ], capture_output=True, timeout=240)
    finally:
        shutil.rmtree(profile, ignore_errors=True)

    deadline = time.time() + 60
    d = {"lines": [], "done": False}
    while time.time() < deadline:
        try:
            d = get("/__e2e_log?peek=1")
        except Exception:
            time.sleep(1); continue
        if d.get("done"):
            break
        time.sleep(1)

    if os.path.exists(PAGE_DST):
        os.remove(PAGE_DST)

    npass = nfail = 0
    for it in d.get("lines") or []:
        txt = it.get("line", "")
        s = txt.strip()
        if s.startswith("ok"):
            npass += 1
        elif s.startswith("FAIL"):
            nfail += 1
        print(txt)

    if not (d.get("lines") or []):
        print("未收到断言结果——浏览器可能未成功启动。")

    print("\nD1 清单实测（%s）：通过 %d，失败 %d" % (pid, npass, nfail))
    return 1 if nfail else 0


if __name__ == "__main__":
    sys.exit(main())
