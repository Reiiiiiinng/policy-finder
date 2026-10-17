"""
D2 专项 390×844 实测：结果卡内嵌控件（折叠摘要 / 理由展开 / 证据链按钮）
与整卡点击、键盘导航的事件冲突。把 .tools/fold_page.html 临时放进 frontend/，
用本机 Edge 无头模式跑完，断言经 /__e2e_log 回传。

    python .tools/fold-e2e.py

需要先启动服务：python backend/server.py
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
PAGE_SRC = os.path.join(ROOT, ".tools", "fold_page.html")
PAGE_DST = os.path.join(ROOT, "frontend", "_fold.html")
SHOT_DIR = os.path.join(ROOT, ".ui-shots", "fold")

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get(path):
    return json.load(OPENER.open(BASE + path, timeout=10))


def main():
    edge = next((p for p in EDGE_CANDIDATES if os.path.exists(p)), None)
    if not edge:
        print("未找到本机浏览器（msedge.exe / chrome.exe），无法实测。")
        return 1

    try:
        get("/api/health")
    except Exception:
        print("后端未启动，请先运行： python backend/server.py")
        return 1

    os.makedirs(SHOT_DIR, exist_ok=True)
    shutil.copyfile(PAGE_SRC, PAGE_DST)
    get("/__e2e_log")   # 重置

    profile = tempfile.mkdtemp(prefix="fold_")
    out_png = os.path.join(SHOT_DIR, "fold-run.png")
    print("启动无头浏览器（390×844）…")
    try:
        subprocess.run([
            edge, "--headless=new", "--disable-gpu", "--no-sandbox",
            "--user-data-dir=" + profile,
            "--window-size=390,844",
            "--screenshot=" + out_png,
            # 虚拟时间预算必须覆盖整条异步断言链（页面 sleep 走虚拟时间，
            # fetch 走真实网络；预算耗尽会立刻退出、截断断言链）。
            "--virtual-time-budget=120000",
            BASE + "/_fold.html",
        ], capture_output=True, timeout=240)
    finally:
        shutil.rmtree(profile, ignore_errors=True)

    deadline = time.time() + 120
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

    print("\nD2 交互实测：通过 %d，失败 %d" % (npass, nfail))
    return 1 if nfail else 0


if __name__ == "__main__":
    sys.exit(main())
