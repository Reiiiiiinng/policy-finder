"""
顶部返回导航压力验证（390×844）。
把 .tools/backnav_page.html 临时放进 frontend/，用本机 Edge 无头模式跑，
断言经 /__e2e_log 回传。

    python .tools/backnav-e2e.py

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
PAGE_SRC = os.path.join(ROOT, ".tools", "backnav_page.html")
PAGE_DST = os.path.join(ROOT, "frontend", "_backnav.html")
SHOT_DIR = os.path.join(ROOT, ".ui-shots", "fix")
NO_SHOT = "--noshot" in sys.argv[1:]

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

CLEANUP_MAX_RETRIES = 8        # 有限重试：最多 8 次
CLEANUP_RETRY_DELAY = 0.5      # 每次间隔 500ms


def get(path):
    return json.load(OPENER.open(BASE + path, timeout=10))


def _is_owned_profile(profile, leaf):
    """校验目录仍是本次测试亲自创建的专属临时 profile。

    条件：位于系统临时目录内、叶子名带 bn_ 前缀、与创建时记录的叶子名一致。
    """
    if not leaf.startswith("bn_"):
        return False
    try:
        resolved = os.path.realpath(profile)
    except OSError:
        return False
    if os.path.basename(resolved) != leaf:
        return False
    temp_root = os.path.realpath(tempfile.gettempdir())
    return resolved.startswith(temp_root + os.sep)


def cleanup_profile(profile):
    """安全清理本次测试创建的临时 Edge profile。

    调用时机：subprocess.run 已返回，即 Edge 主进程确认退出；但其子进程
    （crashpad 等）可能仍短暂占用文件，故有限重试。每次重试前重新验证
    目标身份；清理结果只作警告报告，不影响页面测试通过与退出码。
    不使用通配符，不结束任何浏览器进程，不触碰其他测试的 profile。
    """
    leaf = os.path.basename(profile)
    if not _is_owned_profile(profile, leaf):
        print("清理跳过：目标不是本次测试创建的 bn_ 临时 profile：%s" % profile)
        return
    last_err = None
    for attempt in range(1, CLEANUP_MAX_RETRIES + 1):
        if not os.path.isdir(profile):
            print("临时 profile 已不存在（第 %d 次检查）：%s" % (attempt, profile))
            return
        if not _is_owned_profile(profile, leaf):
            print("清理中止：目标目录身份已变化，停止清理：%s" % profile)
            return
        try:
            shutil.rmtree(profile)
            print("临时 profile 已清理（第 %d 次尝试）：%s" % (attempt, profile))
            return
        except Exception as e:  # 延迟释放：EBUSY / EPERM / EACCES 等
            last_err = e
            print("临时 profile 清理失败（第 %d/%d 次，间隔 %.1fs）：%s -> %s"
                  % (attempt, CLEANUP_MAX_RETRIES, CLEANUP_RETRY_DELAY, profile, e))
            if attempt < CLEANUP_MAX_RETRIES:
                time.sleep(CLEANUP_RETRY_DELAY)
    print("警告：临时 profile 重试 %d 次后仍残留：%s（原因：%s；可稍后手动删除）"
          % (CLEANUP_MAX_RETRIES, profile, last_err))


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

    shutil.copyfile(PAGE_SRC, PAGE_DST)
    get("/__e2e_log")   # 重置

    profile = tempfile.mkdtemp(prefix="bn_")
    out_png = os.path.join(profile, "backnav-run.png")
    print("启动无头浏览器（390×844）…")
    try:
        browser_args = [
            edge, "--headless=new", "--disable-gpu", "--no-sandbox",
            "--user-data-dir=" + profile,
            "--window-size=390,844",
            "--virtual-time-budget=180000",
            BASE + "/_backnav.html",
        ]
        if not NO_SHOT:
            browser_args.insert(-2, "--screenshot=" + out_png)
        proc = subprocess.run(browser_args, capture_output=True, timeout=300)
    finally:
        cleanup_profile(profile)

    deadline = time.time() + 180
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
        if proc.returncode:
            print("Edge 退出码：%d" % proc.returncode)
        return 1

    print("\n390×844 实测：通过 %d，失败 %d" % (npass, nfail))
    return 1 if nfail else 0


if __name__ == "__main__":
    sys.exit(main())
