from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import os
from pathlib import Path
import sys
from threading import Event
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import cleversee as search


class CleverSeeTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {"CLEVERSEE_MAX_RESULTS": "5"}))

    def assert_code(self, code, call, *args):
        with self.assertRaises(search.SearchError) as raised:
            call(*args)
        self.assertEqual(raised.exception.code, code)
        return str(raised.exception)

    def test_request_matches_validated_contract(self):
        opener = Mock()
        opener.open.return_value = BytesIO(b'{"pageItems":[]}')
        with patch.object(search, "build_opener", return_value=opener) as build:
            self.assertEqual(search.send("助餐", 5, "unit-test-key", "http://127.0.0.1:1234"), {"pageItems": []})
        req, = opener.open.call_args.args
        self.assertEqual(opener.open.call_args.kwargs, {"timeout": 8})
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.full_url, search.ENDPOINT)
        self.assertEqual(req.host, "127.0.0.1:1234")
        self.assertEqual(req.get_header("Authorization"), "Bearer unit-test-key")
        self.assertEqual(json.loads(req.data), {
            "query": "助餐", "engineType": "Generic",
            "contents": {"mainText": False, "markdownText": False, "summary": False},
            "advancedParams": {"numResults": "5"},
        })
        self.assertTrue(build.call_args.args[1]._context.check_hostname)
        self.assertEqual(build.call_args.args[1]._context.verify_mode, search.ssl.CERT_REQUIRED)
        self.assertIsNone(build.call_args.args[2].redirect_request(None, None, 307, "", {}, "https://example.org"))

    def test_invalid_queries_never_reach_transport(self):
        transport = Mock()
        service = search.SearchService(transport)
        for value in (None, [], {}, {"query": []}, {"query": " "}, {"query": "a" * 121}, {"query": "a\x00"}):
            self.assert_code("invalid_query", service.search, value)
        transport.assert_not_called()

    def test_missing_key_and_disabled_mode_are_safe(self):
        with patch.dict(os.environ, {"CLEVERSEE_ENABLED": "1", "CLEVERSEE_API_KEY": ""}):
            self.assert_code("missing_key", search.SearchService().search, {"query": "助餐"})
        with patch.dict(os.environ, {"CLEVERSEE_ENABLED": "0", "CLEVERSEE_API_KEY": "unit-test-key"}):
            self.assert_code("disabled", search.SearchService().search, {"query": "助餐"})

    def test_failure_mapping_and_single_attempt(self):
        cases = [
            (URLError("unit-test-key"), "network"),
            (URLError(TimeoutError()), "timeout"),
            (TimeoutError(), "timeout"),
            (HTTPError(search.ENDPOINT, 403, "", {}, BytesIO(b'{"Code":"Retrieval.Arrears"}')), "quota"),
            (HTTPError(search.ENDPOINT, 429, "", {}, BytesIO(b'{"code":"Retrieval.TestUserQueryExceeded"}')), "quota"),
            (HTTPError(search.ENDPOINT, 429, "", {}, BytesIO(b"unit-test-key")), "rate_limit"),
            (HTTPError(search.ENDPOINT, 401, "", {}, BytesIO(b"unit-test-key")), "authorization"),
            (HTTPError(search.ENDPOINT, 307, "", {}, BytesIO(b"unit-test-key")), "upstream"),
        ]
        for exc, code in cases:
            with self.subTest(code=code), patch.object(search, "build_opener") as build:
                attempt = build.return_value.open
                attempt.side_effect = exc
                message = self.assert_code(code, search.send, "助餐", 5, "unit-test-key", "")
                self.assertNotIn("unit-test-key", message)
                self.assertEqual(attempt.call_count, 1)

    def test_normalization_and_conservative_classification(self):
        payload = {"pageItems": [
            {"title": "通知", "link": "https://www.foshan.gov.cn/gfxwj/example", "publishedTime": "2026-04-16T00:40:27+08:00"},
            {"title": "解读", "link": "http://www.chancheng.gov.cn/zwgk/zcjdzl/bmjd/example"},
            {"title": "政府通知", "link": "http://mz.foshan.gov.cn/gkmlpt/example"},
            {"title": "资讯", "link": "https://pc.nfnews.com/example", "publishedTime": "2026-02-30"},
            {"title": "政府正式通知", "link": "https://foshan.gov.cn.example.org/gfxwj/example"},
            {"title": "重复", "link": "https://www.foshan.gov.cn/gfxwj/example#foo"},
            {"title": "脚本", "link": "javascript:alert(1)"},
            {"title": "冒用身份", "link": "https://www.foshan.gov.cn@example.org/"},
            {"title": "反斜线", "link": "https://example.org\\@foshan.gov.cn/"},
        ]}
        rows = search.normalize(payload, 10, "test-time")
        self.assertEqual([r["source_type"] for r in rows], [
            "government_policy", "government_explainer", "government_information",
            "third_party_information", "unknown",
        ])
        self.assertTrue(all(r["verification_status"] == "pending" and r["retrieved_at"] == "test-time" for r in rows))
        self.assertEqual(rows[0]["published_at"], "2026-04-16")
        self.assertIsNone(rows[3]["published_at"])
        self.assertIsNone(rows[4]["published_at"])

    def test_maximum_result_count_and_empty(self):
        payload = {"pageItems": [{"title": str(i), "link": f"https://example.org/{i}"} for i in range(12)]}
        self.assertEqual(len(search.SearchService(Mock(return_value=payload)).search({"query": "助餐"})["results"]), 5)
        with patch.dict(os.environ, {"CLEVERSEE_MAX_RESULTS": "10"}):
            self.assertEqual(len(search.SearchService(Mock(return_value=payload)).search({"query": "助餐"})["results"]), 10)
        with patch.dict(os.environ, {"CLEVERSEE_MAX_RESULTS": "11"}):
            self.assert_code("configuration", search.SearchService(Mock()).search, {"query": "助餐"})
        self.assertEqual(search.SearchService(Mock(return_value={"pageItems": []})).search({"query": "助餐"})["results"], [])
        self.assert_code("upstream", search.normalize, {"pageItems": None}, 5, "now")

    def test_concurrency_and_rate_limit(self):
        started, release = Event(), Event()
        times = [0]

        def fake_transport(*args):
            started.set()
            if not release.wait(2):
                raise AssertionError("Timed out waiting for test")
            return {"pageItems": []}

        service = search.SearchService(Mock(side_effect=fake_transport), clock=lambda: times[0])
        query = {"query": "助餐"}
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(service.search, query)
            try:
                self.assertTrue(started.wait(2))
                self.assert_code("busy", service.search, query)
            finally:
                release.set()
            self.assertEqual(first.result()["results"], [])
        self.assert_code("rate_limit", service.search, query)
        for second in range(1, 6):
            times[0] = second
            service.search(query)
        times[0] = 6
        self.assert_code("rate_limit", service.search, query)
        times[0] = 60
        service.search(query)
        self.assertEqual(service.transport.call_count, 7)

    def test_upstream_echoed_key_does_not_enter_results(self):
        with patch.dict(os.environ, {"CLEVERSEE_ENABLED": "1", "CLEVERSEE_API_KEY": "unit-test-key", "CLEVERSEE_PROXY": ""}):
            with patch.object(search, "send", return_value={"pageItems": [
                {"title": "unit-test-key", "link": "https://example.org/"},
            ]}):
                message = self.assert_code("upstream", search.SearchService().search, {"query": "助餐"})
                self.assertNotIn("unit-test-key", message)
