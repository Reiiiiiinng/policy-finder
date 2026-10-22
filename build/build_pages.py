"""
构建 GitHub Pages 静态产物。

GitHub Pages 只能托管静态文件，跑不了 Python。这里把后端的职责
（政策库读取 + 匹配引擎）整体搬到浏览器，生成一个纯静态目录：

    build/pages/
        index.html discover.html self.html policy.html
        consult.html mine.html family.html
        assets/  (app.js 改成走本地引擎、style.css 等)
        data/policies.js  (政策库 + 引擎，内联成一个脚本)

为什么内联而不是 fetch：file:// 直接打开也要能用，fetch 本地 JSON
会被 CORS 挡住；内联成 <script> 就没有这个问题。

本地后端模式（python backend/server.py）完全不受影响，产出的目录
只用于发布。
"""

import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
BUILD = os.path.join(ROOT, "build")
OUT = os.path.join(BUILD, "pages")
DB_PATH = os.path.join(ROOT, "data", "guangzhou_elderly_policy_v1.1.json")

PAGES = [
    "index.html", "discover.html", "self.html", "policy.html",
    "consult.html", "mine.html", "family.html",
]


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def load_db():
    with open(DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def build_app_js(db):
    """
    把 app.js 的 API 层从 fetch 换成浏览器里的引擎。

    只替换 API 对象那 20 行，其余前端逻辑一个字都不动 —— 页面上的
    renderResultCards / 证据链 / 折叠 / 分段筛选全部原样复用。
    """
    src = read(os.path.join(FRONTEND, "assets", "app.js"))

    old_api = re.search(
        r"const API = \{.*?\n\};\n",
        src,
        re.S,
    )
    if not old_api:
        raise SystemExit("没找到 app.js 里的 API 对象，构建中止")

    new_api = """/**
 * 接口封装（GitHub Pages 静态版）
 *
 * 原版走同源 /api。静态托管没有后端，这里把同样的 6 个方法接到
 * 浏览器里的本地引擎（data/policies.js 里的 localApi）。
 * 方法名、参数、返回结构保持与后端完全一致，页面代码无需改动。
 */
const API = {
  _api() {
    if (!this.__api) {
      if (typeof localApi !== 'function' || typeof POLICY_DB === 'undefined') {
        throw new Error('政策库未加载，请刷新页面重试');
      }
      this.__api = localApi(POLICY_DB);
    }
    return this.__api;
  },
  async get(path) {
    const u = new URL(path, location.origin + '/');
    if (u.pathname === '/api/health') return this._api().health();
    if (u.pathname === '/api/policies') return this._api().policies();
    if (u.pathname === '/api/tiers') return this._api().tiers();
    if (u.pathname === '/api/scenes') {
      const raw = u.searchParams.get('profile');
      let profile = null;
      if (raw) {
        try { profile = JSON.parse(raw); } catch (e) { profile = null; }
      }
      return this._api().scenes(profile);
    }
    if (u.pathname.startsWith('/api/policy/')) {
      const id = decodeURIComponent(u.pathname.slice('/api/policy/'.length));
      return this._api().policy(id);
    }
    throw new Error('未知接口：' + u.pathname);
  },
  async post(path, body) {
    const u = new URL(path, location.origin + '/');
    if (u.pathname === '/api/profile') return this._api().profile(body);
    if (u.pathname === '/api/match') return this._api().match(body);
    if (u.pathname === '/api/explain') return this._api().explain(body);
    throw new Error('未知接口：' + u.pathname);
  },
  health: () => API.get('/api/health'),
  match: (payload) => API.post('/api/match', payload),
  policy: (id) => API.get('/api/policy/' + encodeURIComponent(id)),
  explain: (policyId, profile) => API.post('/api/explain', { policy_id: policyId, profile }),
  scenes: (profile) => API.get('/api/scenes'
    + (profile ? '?profile=' + encodeURIComponent(JSON.stringify(profile)) : '')),
};
"""
    return src[:old_api.start()] + new_api + src[old_api.end():]


def build_policies_js(db):
    """
    政策库 + 引擎合成一个文件，页面里先于 app.js 加载。

    引擎源码直接读 build/engine.js，不做转译 —— 它本来就是这个仓库里
    唯一的实现，改一处两边同时生效，不存在「同步忘了改」的问题。
    """
    engine_src = read(os.path.join(BUILD, "engine.js"))
    db_json = json.dumps(db, ensure_ascii=False, indent=0)
    return (
        "/* 由 build/build_pages.py 生成，请勿手改。 */\n"
        "/* 政策库来自 data/guangzhou_elderly_policy_v1.1.json */\n"
        "const POLICY_DB = " + db_json + ";\n\n"
        + engine_src
        + "\n"
    )


def patch_html(name, text):
    """
    在 </body> 前插入引擎脚本，并去掉只对后端有意义的引用。
    """
    if 'data/policies.js' in text:
        return text
    tag = '  <script src="data/policies.js"></script>\n'
    if "</body>" not in text:
        raise SystemExit("%s 里没有 </body>，构建中止" % name)
    # 放在 app.js 之前：app.js 顶层会读 localStorage 但不立刻调 API，
    # 保险起见仍排在所有脚本之前。
    first_script = text.find("<script")
    if first_script != -1:
        text = text[:first_script] + tag + text[first_script:]
    else:
        text = text.replace("</body>", tag + "</body>")
    return text


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

    db = load_db()

    # 1) 静态资源
    shutil.copytree(os.path.join(FRONTEND, "assets"), os.path.join(OUT, "assets"))

    # 2) app.js 换成静态版
    write(os.path.join(OUT, "assets", "app.js"), build_app_js(db))

    # 3) 政策库 + 引擎
    write(os.path.join(OUT, "data", "policies.js"), build_policies_js(db))

    # 4) 页面
    for name in PAGES:
        src = read(os.path.join(FRONTEND, name))
        write(os.path.join(OUT, name), patch_html(name, src))

    # 5) 禁止 Jekyll 处理，避免 _ 开头文件被吞；加 404 回落
    write(os.path.join(OUT, ".nojekyll"), "")
    write(os.path.join(OUT, "404.html"),
          read(os.path.join(FRONTEND, "index.html")) if False else
          '<!DOCTYPE html><meta charset="utf-8">'
          '<meta http-equiv="refresh" content="0; url=./index.html">'
          '<p>页面不存在，正在返回<a href="./index.html">首页</a>。</p>')

    # 6) 统计
    total = 0
    for base, _dirs, files in os.walk(OUT):
        for f in files:
            total += os.path.getsize(os.path.join(base, f))
    print("产出 build/pages/，%d 个页面 + 引擎，合计 %.1f KB"
          % (len(PAGES), total / 1024.0))


if __name__ == "__main__":
    main()
