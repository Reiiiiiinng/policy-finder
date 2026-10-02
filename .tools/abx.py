"""agent-browser 执行器：脚本从文件读入进程 stdin，输出重定向到临时文件。
   规避 Windows 下 agent-browser daemon 持有管道导致的假死问题。"""
import subprocess, sys, os, time, shutil, tempfile

NODE_BIN = r"C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-3"
os.environ["PATH"] = os.environ.get("PATH", "") + os.pathsep + NODE_BIN

def run(args, script=None, timeout=60):
    exe = shutil.which("agent-browser")
    outp = os.path.join(tempfile.gettempdir(), "ab_out.txt")
    inp = None
    if script is not None:
        inp = tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".js")
        inp.write(script); inp.close()
    try:
        if os.path.exists(outp): os.remove(outp)
        fo = open(outp, "w", encoding="utf-8", errors="replace")
        fi = open(inp.name, "r", encoding="utf-8") if inp else subprocess.DEVNULL
        p = subprocess.Popen([exe] + args, stdin=fi, stdout=fo, stderr=subprocess.STDOUT)
        try:
            p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill(); time.sleep(0.5)
        fo.close()
        try:
            fi.close()
        except Exception:
            pass
        time.sleep(0.2)
        return open(outp, encoding="utf-8", errors="replace").read() if os.path.exists(outp) else ""
    finally:
        if inp:
            try: os.remove(inp.name)
            except Exception: pass

if __name__ == "__main__":
    if sys.argv[1] == "evalf":
        js = open(sys.argv[2], encoding="utf-8").read()
        print(run(["eval", "--stdin"], js, int(sys.argv[3]) if len(sys.argv) > 3 else 60))
    else:
        print(run(sys.argv[1:], None, 90))
