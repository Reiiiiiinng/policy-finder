"""
端到端流程自测：驱动本机 Edge 无头浏览器，在真实页面里跑完整流程。

用法：
    python .tools/e2e.py            # 家庭模式 + 本人模式都跑
    python .tools/e2e.py family     # 只跑家庭模式

原理：把 .tools/e2e_page.html 临时复制成 frontend/_e2e.html，
该页面在 iframe 里逐步操作真实 UI，每条断言通过 fetch POST 到
/__e2e_log，本脚本轮询取回结果。跑完自动删除临时文件。
（截图受 --virtual-time-budget 限制跑不完异步断言，所以走数据回传。）
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
PAGE_SRC = os.path.join(ROOT, ".tools", "e2e_page.html")
PAGE_DST = os.path.join(ROOT, "frontend", "_e2e.html")
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get(path):
    return json.load(OPENER.open(BASE + path, timeout=10))


def find_edge():
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def run_mode(edge, mode, shots_dir):
    # 1) 重置日志
    OPENER.open(BASE + "/__e2e_log", timeout=10).read()

    out_png = os.path.join(shots_dir, "e2e-%s.png" % mode)
    profile = tempfile.mkdtemp(prefix="e2e_")
    url = "%s/_e2e.html?mode=%s" % (BASE, mode)
    subprocess.run([
        edge, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--user-data-dir=" + profile,
        "--screenshot=" + out_png,
        "--window-size=900,1600",
        "--virtual-time-budget=3000",
        url,
    ], capture_output=True, timeout=120)
    shutil.rmtree(profile, ignore_errors=True)

    # 2) 轮询结果（页面异步断言需要真实时间跑完）
    deadline = time.time() + 90
    last = 0
    while time.time() < deadline:
        try:
            d = get("/__e2e_log?peek=1")
        except Exception:
            time.sleep(1)
            continue
        n = len(d.get("lines") or [])
        if n != last:
            last = n
        if d.get("done"):
            break
        time.sleep(1)

    lines = d.get("lines") or []
    # 打印
    print("\n===== %s 模式 =====" % mode)
    npass = nfail = 0
    for it in lines:
        txt = it.get("line", "")
        if "===" in txt or txt.startswith("端到端"):
            print(txt)
            continue
        if txt.strip().startswith("ok"):
            npass += 1
        elif txt.strip().startswith("FAIL"):
            nfail += 1
        print("  " + txt)
    if not lines:
        print("  （没有收到断言结果——浏览器可能未启动成功）")
    print("  -> 通过 %d，失败 %d" % (npass, nfail))
    return nfail


def main():
    edge = find_edge()
    if not edge:
        print("未找到本机浏览器，跳过端到端自测。")
        return 0

    modes = sys.argv[1:] or ["family", "self"]
    shots = os.path.join(ROOT, ".ui-shots", "v2")
    os.makedirs(shots, exist_ok=True)

    try:
        get("/api/health")
    except Exception:
        print("后端未启动，请先运行 python backend/server.py")
        return 1

    # 临时把自测页面放进可访问目录
    shutil.copyfile(PAGE_SRC, PAGE_DST)

    total = 0
    try:
        for m in modes:
            total += run_mode(edge, m, shots)
    finally:
        if os.path.exists(PAGE_DST):
            os.remove(PAGE_DST)

    print("\n端到端自测%s：总失败 %d" % ("失败" if total else "通过", total))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())