"""
把 build/pages/（build_pages.py 的产物）同步到部署仓工作目录。

    python .tools/sync_deploy.py <部署仓根目录>

部署仓（zhaohan94s666/policy-finder）根目录即 build/pages 的内容：
7 个页面 + assets/ + data/policies.js + .nojekyll + 404.html。
本脚本只做产物复制，不做任何内容改写；内容差异以 git diff 审阅。
"""

import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "pages")

# 产物里与部署仓无关的临时文件不出现在 pages 里，这里不需要排除名单。


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    dst = os.path.abspath(sys.argv[1])
    if not os.path.isdir(dst):
        print("部署目录不存在：%s" % dst)
        return 1
    if not os.path.isdir(SRC):
        print("产物缺失，请先运行： python build/build_pages.py")
        return 1

    n = 0
    for base, _dirs, files in os.walk(SRC):
        rel = os.path.relpath(base, SRC)
        target_dir = dst if rel == "." else os.path.join(dst, rel)
        os.makedirs(target_dir, exist_ok=True)
        for f in files:
            shutil.copyfile(os.path.join(base, f), os.path.join(target_dir, f))
            n += 1
    print("已同步 %d 个文件 -> %s" % (n, dst))
    print("请在部署仓用 git diff 审阅内容差异后再决定是否提交。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
