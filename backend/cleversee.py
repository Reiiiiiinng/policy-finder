"""Single-request CleverSee Generic adapter for the loopback search page."""

from collections import deque
from datetime import datetime, timezone
from http.client import HTTPException
import json
import os
import re
import ssl
from threading import Lock
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener,
)


ENDPOINT = "https://cloud-iqs.aliyuncs.com/search/unified"
MAX_QUERY = 120
MAX_RESPONSE = 1024 * 1024

ERRORS = {
    "invalid_query": (400, "请输入 1 至 120 字的公开政策关键词。"),
    "forbidden": (403, "请从本地查政策页面发起搜索。"),
    "missing_key": (503, "联网搜索尚未配置 API Key，请检查后端设置。"),
    "disabled": (503, "联网搜索尚未启用。你仍可查询已收录政策。"),
    "configuration": (503, "联网搜索配置无效，请检查后端设置。"),
    "busy": (429, "已有搜索正在进行，请稍后再试。"),
    "rate_limit": (429, "搜索太频繁，请稍后再试。"),
    "quota": (503, "联网搜索额度不足或已到期，请检查服务额度。"),
    "authorization": (503, "联网搜索鉴权失败，请检查服务权限和 API Key。"),
    "timeout": (504, "联网搜索超时，请稍后重试。"),
    "network": (502, "暂时无法连接搜索服务，请检查网络或代理后重试。"),
    "upstream": (502, "搜索服务暂时无法返回结果，请稍后重试。"),
}


class SearchError(Exception):
    def __init__(self, code):
        self.code = code
        self.status, message = ERRORS[code]
        super().__init__(message)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def safe_url(value):
    if (not isinstance(value, str) or len(value) > 2048
            or re.search(r"[\\\x00-\x20\x7f]", value)):
        return None
    try:
        parts = urlsplit(value)
        if (parts.scheme not in ("http", "https") or not parts.hostname
                or parts.username is not None or parts.port not in (None, 80, 443)):
            return None
        host = parts.hostname.lower().rstrip(".")
        if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", host):
            return None
        return parts
    except ValueError:
        return None


def source_type(parts, item):
    host = parts.hostname.lower().rstrip(".")
    segments = set(parts.path.lower().split("/"))
    if host.endswith(".gov.cn"):
        if segments & {"zcjdzl", "zcjd", "bmjd", "zcjdjd"}:
            return "government_explainer", "政府域名及政策解读栏目"
        if segments & {"gfxwj", "zcfgk", "zfwj", "zcwj", "bmwj"}:
            return "government_policy", "政府域名及政策文件栏目"
        return "government_information", "政府域名，文件类别待核实"
    tags = item.get("tags")
    if (any(host == site or host.endswith("." + site) for site in ("nfnews.com", "sohu.com", "bendibao.com"))
            or isinstance(tags, dict) and tags.get("genre") == "NewsPortal"):
        return "third_party_information", "媒体站点域名或搜索服务媒体分类"
    return "unknown", "缺少可判定的来源依据"


def text_field(value, limit):
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def published_date(value):
    # This provider field describes the webpage, not the policy document.
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?", value
    ):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def normalize(payload, limit, retrieved_at):
    if not isinstance(payload, dict) or not isinstance(payload.get("pageItems"), list):
        raise SearchError("upstream")
    results = []
    seen = set()
    for item in payload["pageItems"]:
        if not isinstance(item, dict):
            continue
        parts = safe_url(item.get("link"))
        title = text_field(item.get("title"), 300)
        if not parts or not title:
            continue
        url = parts._replace(fragment="").geturl()
        if url in seen:
            continue
        seen.add(url)
        kind, basis = source_type(parts, item)
        results.append({
            "title": title,
            "snippet": text_field(item.get("snippet"), 280),
            "url": url,
            "source_name": text_field(item.get("hostname"), 100) or parts.hostname,
            "source_host": parts.hostname,
            "source_type": kind,
            "source_basis": basis,
            "published_at": published_date(item.get("publishedTime")),
            "retrieved_at": retrieved_at,
            "verification_status": "pending",
        })
        if len(results) == limit:
            break
    return results


def read_json(response, limit):
    raw = response.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("Response exceeds size limit")
    return json.loads(raw)


def upstream_error(exc):
    try:
        with exc:
            data = read_json(exc, 8192)
        code = (data.get("code") or data.get("Code")) if isinstance(data, dict) else None
    except (OSError, HTTPException, ValueError, TypeError):
        code = None
    if exc.code == 402 or code in (
        "Retrieval.Arrears", "Retrieval.TestUserPeriodExpired", "Retrieval.TestUserQueryExceeded",
    ):
        return SearchError("quota")
    if exc.code in (401, 403) or code == "InvalidAccessKeyId.NotFound":
        return SearchError("authorization")
    if exc.code == 429:
        return SearchError("rate_limit")
    if exc.code == 504:
        return SearchError("timeout")
    return SearchError("upstream")


def send(query, limit, key, proxy):
    body = json.dumps({
        "query": query,
        "engineType": "Generic",
        "contents": {"mainText": False, "markdownText": False, "summary": False},
        "advancedParams": {"numResults": str(limit)},
    }, ensure_ascii=False).encode("utf-8")
    req = Request(ENDPOINT, data=body, headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
    }, method="POST")
    if proxy:
        req.set_proxy(urlsplit(proxy).netloc, "http")
    handler = ProxyHandler({}) if proxy else ProxyHandler()
    opener = build_opener(handler, HTTPSHandler(context=ssl.create_default_context()), NoRedirect())
    try:
        with opener.open(req, timeout=8) as response:
            return read_json(response, MAX_RESPONSE)
    except HTTPError as exc:
        raise upstream_error(exc) from None
    except URLError as exc:
        raise SearchError("timeout" if isinstance(exc.reason, TimeoutError) else "network") from None
    except TimeoutError:
        raise SearchError("timeout") from None
    except (OSError, HTTPException):
        raise SearchError("network") from None
    except (ValueError, TypeError):
        raise SearchError("upstream") from None


def classify_results(results, *, live):
    # Match only exact links in the curated catalogue. Domain and provider snippets
    # alone can establish a lead, never a benefit or its validity.
    verified = {}
    if live and results:
        from policy_assessment import _evidence_state
        from semantic_discovery import REGIONS, _catalog
        for region in REGIONS:
            for policy in _catalog(region):
                evidence = _evidence_state(policy)
                if evidence["official_source_verified"] and evidence["validity_status"] == "active":
                    verified[evidence["official_url"]] = policy

    ranks = {"verified_official": 0, "official_lead": 1, "third_party": 2, "unverified": 3}
    for row in results:
        policy = verified.get(row["url"])
        if policy is not None:
            row["group"] = "verified_official"
            row["verification_status"] = "catalogue_verified"
            row["source_basis"] = "链接与本地已核验的当前政策原文一致"
            row["title"] = policy["source"].get("document") or policy["policy_name"]
            row["snippet"] = policy.get("benefit_summary") or policy.get("description") or ""
            row["verified_at"] = policy["verification"].get("checked_at")
        elif row["source_type"].startswith("government_"):
            row["group"] = "official_lead"
        elif row["source_type"] == "third_party_information":
            row["group"] = "third_party"
        else:
            row["group"] = "unverified"
    results.sort(key=lambda row: ranks[row["group"]])
    return "has_official" if any(ranks[row["group"]] <= 1 for row in results) else "no_reliable_result"


class SearchService:
    def __init__(self, transport=None, clock=monotonic):
        self.transport = transport
        self.clock = clock
        self.lock = Lock()
        self.started = deque()
        self.active = False

    def search(self, payload):
        query = payload.get("query") if isinstance(payload, dict) else None
        if (not isinstance(query, str) or len(query) > MAX_QUERY or not query.strip()
                or re.search(r"[\x00-\x1f\x7f\ud800-\udfff]", query)):
            raise SearchError("invalid_query")
        query = " ".join(query.split())
        try:
            limit = int(os.getenv("CLEVERSEE_MAX_RESULTS", "5"))
            if not 1 <= limit <= 10:
                raise ValueError
        except ValueError:
            raise SearchError("configuration") from None
        key = ""
        proxy = ""
        if self.transport is None:
            if os.getenv("CLEVERSEE_ENABLED") != "1":
                raise SearchError("disabled")
            key = os.getenv("CLEVERSEE_API_KEY", "").strip()
            if not key:
                raise SearchError("missing_key")
            if not re.fullmatch(r"[!-~]+", key):
                raise SearchError("configuration")
            proxy = os.getenv("CLEVERSEE_PROXY", "").strip()
            if proxy:
                try:
                    parts = urlsplit(proxy)
                    if (parts.scheme != "http" or not parts.hostname or not parts.port or parts.username
                            or parts.password or parts.path not in ("", "/") or parts.query or parts.fragment
                            or re.search(r"[\s\\]", proxy)):
                        raise ValueError
                except ValueError:
                    raise SearchError("configuration") from None
        with self.lock:
            if self.active:
                raise SearchError("busy")
            now = self.clock()
            while self.started and now - self.started[0] >= 60:
                self.started.popleft()
            if self.started and (len(self.started) >= 6 or now - self.started[-1] < 1):
                raise SearchError("rate_limit")
            self.started.append(now)
            self.active = True
        try:
            response = (self.transport or send)(query, limit, key, proxy)
            retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            results = normalize(response, limit, retrieved_at)
            search_status = classify_results(results, live=self.transport is None)
            if key and any(key in str(item) for item in results):
                raise SearchError("upstream")
            return {"results": results, "retrieved_at": retrieved_at, "status": search_status,
                    "mode": "mock" if self.transport else "live"}
        finally:
            with self.lock:
                self.active = False
