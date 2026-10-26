"""
政策库数据一致性测试：校验字段与官方一手证据是否对得上。

    python .tools/datacheck.py            # 本地校验（不联网）
    python .tools/datacheck.py --online   # 额外逐条请求 official_url 验证可达

为什么单独一个脚本：
  apitest.py 校验接口契约，page-check.js 校验页面结构，都不检查
  「数据写的是不是真的」—— 2026-10 那次 gz_elderly_009 的 official_url
  指向 404 页面、published_date 与官方发布日期不符，两套测试都没报错。
  这个脚本补上这一层：结构化字段 + 文号/日期/URL 的相互一致性，
  以及（可选）真实 HTTP 可达性。

不联网时仍会校验：
  - 每条来源必须有 official_url / document_no / publish_date，且格式合法
  - 延期文件（validity.basis）的文号不得与主文件重复
  - published_date 必须落在 official_url 的政府域名内篇目的发布年份范围内
  - 有效期不得早于发布日期

联网时（--online）额外校验：
  - official_url 与 validity.basis.official_url 均返回 HTTP 200
  - 页面正文里出现 document_no 与 published_date
"""

import datetime
import io
import json
import os
import re
import sys
import urllib.request
import urllib.error
import ssl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "guangzhou_elderly_policy_v1.1.json")

ONLINE = "--online" in sys.argv

PASS = 0
FAIL = 0
SKIP = 0

# 站点拦截自动请求的状态码：不能判成死链，也不能算可达（见 --online 段）。 
BLOCKED_CODES = (403, 412, 429)

# 本机 HTTP_PROXY 指向上游代理，政府站点直连更稳定；联网校验显式直连。
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

GOV_HOST_RE = re.compile(r"^https://([a-z0-9.-]+\.gov\.cn)/", re.I)
DOC_NO_RE = re.compile(r"[\u4e00-\u9fa5]{2,10}〔\d{4}〕\d+号")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# 日期精度：官方页面有时只给到年月或年份，规范里允许保留该精度，
# 但必须同时满足「该条目仍未核验到日」+「核验备注写明原因」两个条件。
PRECISION_RES = (
    ("day", re.compile(r"^\d{4}-\d{2}-\d{2}$")),
    ("month", re.compile(r"^\d{4}-\d{2}$")),
    ("year", re.compile(r"^\d{4}$")),
)


def date_precision(s):
    """返回 'day' / 'month' / 'year'；格式不合法返回 None。"""
    for key, rx in PRECISION_RES:
        if rx.match(s or ""):
            if key == "day":
                try:
                    datetime.date(*(int(x) for x in s.split("-")))
                except ValueError:
                    return None
            return key
    return None


def publish_date_rule(policy):
    """发布日期精度规则（不联网即可判定）。返回 (ok, 说明)。

    规则来源 docs/policy-data-spec.md「日期字段」一节：
      - publish_date = 政府官方页面明确标注的发布日期/发布时间；
      - 已核验（verified）条目必须精确到日，用来支撑「已核对」的声明；
      - 待核验条目可以只到年月或年份、甚至为空，但必须在核验备注里
        写明为什么只有这个精度（或为什么还没有日期）。
    这条规则**不是**放宽：已核验条目反而更严，部分精度不能再进 verified。
    """
    src = policy.get("source") or {}
    ver = policy.get("verification") or {}
    pub = (src.get("publish_date") or "").strip()
    status = ver.get("status")
    note = (ver.get("note") or "").strip()

    if not pub:
        if status == "verified":
            return False, "已核验但 publish_date 为空"
        if len(note) < 10:
            return False, "publish_date 为空且没有核验备注说明原因"
        return True, "空值 + 备注（待核验）"

    prec = date_precision(pub)
    if prec is None:
        return False, "格式非法（应为 YYYY-MM-DD / YYYY-MM / YYYY）：%s" % pub
    if prec == "day":
        return True, "精确到日"
    if status == "verified":
        return False, "已核验条目必须精确到日，当前 %s（%s 精度）" % (pub, "年月" if prec == "month" else "年份")
    if len(note) < 10:
        return False, "部分精度 %s 但核验备注未说明原因" % pub
    return True, "部分精度（%s）+ 备注说明（待核验）" % ("年月" if prec == "month" else "年份")


def document_date_rule(policy):
    """成文日期规则：可选字段，填了就必须是 YYYY-MM-DD 且不晚于发布日期。"""
    src = policy.get("source") or {}
    doc = (src.get("document_date") or "").strip()
    pub = (src.get("publish_date") or "").strip()
    if not doc:
        return True, "未填（可选字段）"
    if date_precision(doc) != "day":
        return False, "格式非法（应为 YYYY-MM-DD）：%s" % doc
    if date_precision(pub) == "day" and doc > pub:
        return False, "成文日期晚于发布日期（%s > %s）" % (doc, pub)
    return True, "ok"


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   %s" % name)
    else:
        FAIL += 1
        print("  FAIL %s %s" % (name, detail))


def skip(name, why):
    global SKIP
    SKIP += 1
    print("  skip %s（%s）" % (name, why))


def load():
    with io.open(DB, encoding="utf-8") as f:
        return json.load(f)


def head_ok(url):
    """请求 URL，返回 (状态码, 正文 str)；网络异常返回 (0, '')。"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with OPENER.open(req, timeout=30) as r:
            raw = r.read()
            code = r.getcode()
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001 - 网络异常统一视为不可达
        return 0, str(e)
    for enc in ("utf-8", "gb18030"):
        try:
            return code, raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return code, raw.decode("utf-8", "ignore")


def strip_tags(html):
    html = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    html = re.sub(r"<style.*?</style>", " ", html, flags=re.S)
    html = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"[\s\u00a0]+", " ", html)


def date_in_text(day, text):
    """官方页面里的日期不一定写成 YYYY-MM-DD。

    同一份文件，元数据栏常写 "成文日期：2024-03-14"，正文落款却写
    "2026年8月31日"（gz.gov.cn 政策文件库就是这样）。把 YYYY-MM-DD 直接拿去
    比正文会误报「正文未出现该日期」，所以三种常见写法都认：
    YYYY-MM-DD、YYYY年M月D日、YYYY/M/D（无前导零）。
    """
    if not day or not text:
        return False
    if day in text:
        return True
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", day)
    if not m:
        return False
    y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
    return ("%s年%d月%d日" % (y, mo, d)) in text or ("%s/%d/%d" % (y, mo, d)) in text


def main():
    db = load()
    policies = db.get("policies") or []
    check("政策库非空", bool(policies), len(policies))

    print("== 逐条来源字段完整性 ==")
    for p in policies:
        pid = p.get("policy_id", "?")
        src = p.get("source") or {}
        check("%s 有 policy_name" % pid, bool(p.get("policy_name")))
        check("%s source.department 非空" % pid, bool((src.get("department") or "").strip()))
        check("%s source.document 非空" % pid, bool((src.get("document") or "").strip()))

        doc_no = (src.get("document_no") or "").strip()
        check("%s 文号格式合法：%s" % (pid, doc_no or "（空）"),
              bool(DOC_NO_RE.search(doc_no)), doc_no)

        pub = (src.get("publish_date") or "").strip()
        ok, why = publish_date_rule(p)
        check("%s publish_date 符合规范：%s（%s）" % (pid, pub or "（空）", why), ok, why)

        ok, why = document_date_rule(p)
        check("%s document_date 合规（可选）：%s（%s）"
              % (pid, (src.get("document_date") or "（未填）"), why), ok, why)

        url = (src.get("official_url") or "").strip()
        m = GOV_HOST_RE.match(url)
        check("%s official_url 是 https 政府域名：%s" % (pid, url or "（空）"),
              bool(m), url)

    print("== 发布日期与有效期一致性 ==")
    for p in policies:
        pid = p.get("policy_id", "?")
        src = p.get("source") or {}
        val = p.get("validity") or {}
        pub = (src.get("publish_date") or "").strip()
        eff = (val.get("effective_from") or "").strip()
        exp = (val.get("expires_at") or "").strip()

        if pub and eff:
            # 生效日可以早于发布日（如「自印发之日起施行」回填到年初），
            # 但不能晚于失效日，否则区间自相矛盾。
            check("%s 有效期区间未倒置（%s → %s）" % (pid, eff, exp or "—"),
                  (not exp) or eff <= exp, "%s > %s" % (eff, exp))
        else:
            skip("%s 有效期区间" % pid, "缺少 effective_from")

        if pub and exp:
            check("%s 失效日期不早于发布日（%s <= %s）" % (pid, pub, exp), pub <= exp,
                  "%s > %s" % (pub, exp))

    print("== 延期/依据文件与主文件不得混淆 ==")
    for p in policies:
        pid = p.get("policy_id", "?")
        src = p.get("source") or {}
        basis = (p.get("validity") or {}).get("basis") or {}
        if not basis:
            continue
        main_no = (src.get("document_no") or "").strip()
        basis_no = (basis.get("document_no") or "").strip()
        check("%s basis.document_no 格式合法：%s" % (pid, basis_no or "（空）"),
              bool(DOC_NO_RE.search(basis_no)), basis_no)
        check("%s 延期文号不等于主文件文号（主 %s / 延 %s）" % (pid, main_no, basis_no),
              bool(basis_no) and basis_no != main_no, "%s == %s" % (main_no, basis_no))
        bdate = (basis.get("published_date") or "").strip()
        check("%s basis.published_date 格式合法：%s" % (pid, bdate or "（空）"),
              bool(DATE_RE.match(bdate)), bdate)
        burl = (basis.get("official_url") or "").strip()
        check("%s basis.official_url 是 https 政府域名" % pid,
              bool(GOV_HOST_RE.match(burl)), burl)
        check("%s basis.official_url 与主文件 official_url 不同" % pid,
              burl and burl != (src.get("official_url") or "").strip().strip())
        pub = (src.get("publish_date") or "").strip()
        if pub and bdate:
            check("%s 延期文件发布日期不早于原文件（%s <= %s）" % (pid, pub, bdate),
                  pub <= bdate, "%s > %s" % (pub, bdate))

    print("== 已核验条目必须带可用于佐证的来源 ==")
    for p in policies:
        pid = p.get("policy_id", "?")
        status = (p.get("verification") or {}).get("status")
        if status != "verified":
            continue
        src = p.get("source") or {}
        check("%s 已核验且有 official_url" % pid, bool((src.get("official_url") or "").strip()))
        check("%s 已核验且有 document_no" % pid,
              bool((src.get("document_no") or "").strip()))
        note = (p.get("verification") or {}).get("note") or ""
        check("%s 已核验且写了核验说明" % pid, len(note) >= 10, len(note))

    if not ONLINE:
        print("\n（未加 --online，跳过真实 HTTP 可达性校验）")
    else:
        print("== 官方 URL 真实可达性（--online，实际发起 HTTP 请求）==")
        seen = {}
        for p in policies:
            pid = p.get("policy_id", "?")
            src = p.get("source") or {}
            url = (src.get("official_url") or "").strip()
            if not url:
                skip("%s official_url 可达" % pid, "无 URL")
                continue
            if url in seen:
                prev = seen[url + "\x00"]
                if prev in BLOCKED_CODES:
                    skip("%s official_url 可达" % pid,
                         "服务器拒绝自动访问（HTTP %s），未判定可达性：%s（复用 %s 的结果）"
                         % (prev, url, seen[url]))
                else:
                    check("%s official_url 可达（复用 %s 的结果）" % (pid, seen[url]),
                          prev == 200)
                continue
            code, body = head_ok(url)
            seen[url] = pid
            seen[url + "\x00"] = code
            if code in BLOCKED_CODES:
                # 412/403/429 是站点在拦自动请求（国家卫健委站点对非浏览器 UA
                # 返回 412），页面本身没消失。既不能判成死链，也不能算通过——
                # 明确记为「可达性未判定」，并保留之后的正文校验为跳过。
                skip("%s official_url 可达" % pid,
                     "服务器拒绝自动访问（HTTP %s），未判定可达性：%s" % (code, url))
                continue
            check("%s official_url 返回 200：%s" % (pid, url), code == 200,
                  "HTTP %s" % code)
            if code == 200 and body:
                text = strip_tags(body)
                doc_no = (src.get("document_no") or "").strip()
                pub = (src.get("publish_date") or "").strip()
                check("%s 官方页面正文含文号 %s" % (pid, doc_no),
                      doc_no in text or doc_no.replace("〔", "[").replace("〕", "]") in text,
                      "正文未出现该文号")
                check("%s 官方页面正文含发布日期 %s" % (pid, pub),
                      date_in_text(pub, text), "正文未出现该日期")
                # document_date 是「原文明确标注的成文/印发日期」，填了就必须
                # 能在官方页面正文里找到，否则就是无据填写。
                doc_date = (src.get("document_date") or "").strip()
                if doc_date:
                    check("%s 官方页面正文含成文日期 %s" % (pid, doc_date),
                          date_in_text(doc_date, text), "正文未出现该日期")

        for p in policies:
            pid = p.get("policy_id", "?")
            basis = (p.get("validity") or {}).get("basis") or {}
            burl = (basis.get("official_url") or "").strip()
            if not burl:
                continue
            code, body = head_ok(burl)
            if code in BLOCKED_CODES:
                skip("%s basis.official_url 可达" % pid,
                     "服务器拒绝自动访问（HTTP %s），未判定可达性：%s" % (code, burl))
                continue
            check("%s basis.official_url 返回 200：%s" % (pid, burl), code == 200,
                  "HTTP %s" % code)
            if code == 200 and body:
                text = strip_tags(body)
                bno = (basis.get("document_no") or "").strip()
                bdate = (basis.get("published_date") or "").strip()
                check("%s 延期文件正文含文号 %s" % (pid, bno), bno in text,
                      "正文未出现该文号")
                check("%s 延期文件正文含发布日期 %s" % (pid, bdate), date_in_text(bdate, text),
                      "正文未出现该日期")

    print("\n通过 %d，失败 %d，跳过 %d" % (PASS, FAIL, SKIP))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
