"""Offline regression tests. Uses synthetic credentials; never loads real .env."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError, URLError
from deepseek_client import DeepSeekClient, DeepSeekConfig, DeepSeekError

SYNTHETIC_KEY = "unit-test-credential-not-a-real-key"


class StubOpener:
    def __init__(self, body=None, exception=None):
        self.body = body
        self.exception = exception
        self.calls = []

    def open(self, req, timeout):
        self.calls.append((req, timeout))
        if self.exception:
            raise self.exception
        return io.BytesIO(self.body)


def response(content='{"ok":true}', finish="stop"):
    return json.dumps({"choices": [{"message": {"content": content}, "finish_reason": finish}]}).encode()


class DeepSeekTests(unittest.TestCase):
    def client(self, opener):
        client = DeepSeekClient(DeepSeekConfig("https://api.deepseek.com", "deepseek-flash", SYNTHETIC_KEY))
        client._opener = opener
        return client

    def test_config_precedence_and_no_environment_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / ".env"
            file.write_text('DEEPSEEK_BASE_URL=https://api.deepseek.com\nDEEPSEEK_MODEL=deepseek-flash\nDEEPSEEK_API_KEY="file-test-key"\nPORT=9999\n', encoding="utf-8")
            env = {"DEEPSEEK_API_KEY": SYNTHETIC_KEY, "PORT": "8000"}
            config = DeepSeekConfig.load(file, env)
            self.assertEqual(config.api_key, SYNTHETIC_KEY)
            self.assertEqual(env["PORT"], "8000")
            self.assertNotIn(SYNTHETIC_KEY, repr(config))

    def test_missing_key_before_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(DeepSeekError) as ctx:
                DeepSeekConfig.load(Path(tmp) / "missing", {})
            self.assertEqual(ctx.exception.code, "CONFIG_MISSING_KEY")

    def test_non_thinking_json_request_and_official_path(self):
        opener = StubOpener(response())
        result = self.client(opener).chat_json([{"role": "user", "content": "Test JSON"}], 128)
        self.assertEqual(result, {"ok": True})
        req, timeout = opener.calls[0]
        body = json.loads(req.data)
        self.assertEqual(req.full_url, "https://api.deepseek.com/chat/completions")
        self.assertEqual(body["model"], "deepseek-flash")
        self.assertEqual(body["thinking"], {"type": "disabled"})
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertEqual(timeout, 30)
        self.assertEqual(len(opener.calls), 1)

    def test_http_failures_do_not_echo_bodies_or_retry(self):
        for status in [302, 400, 401, 402, 403, 404, 429, 500, 503]:
            with self.subTest(status=status):
                exc = HTTPError("https://api.deepseek.com/chat/completions", status, SYNTHETIC_KEY, {}, io.BytesIO(SYNTHETIC_KEY.encode()))
                opener = StubOpener(exception=exc)
                with self.assertRaises(DeepSeekError) as ctx:
                    self.client(opener).chat_json([{"role": "user", "content": "JSON"}])
                self.assertNotIn(SYNTHETIC_KEY, str(ctx.exception))
                self.assertEqual(ctx.exception.status, status)
                self.assertEqual(len(opener.calls), 1)

    def test_network_errors_and_timeouts_redacted(self):
        for exc in [TimeoutError(SYNTHETIC_KEY), URLError(TimeoutError(SYNTHETIC_KEY)), URLError(SYNTHETIC_KEY)]:
            with self.subTest(kind=type(exc).__name__):
                with self.assertRaises(DeepSeekError) as ctx:
                    self.client(StubOpener(exception=exc)).chat_json([{"role": "user", "content": "JSON"}])
                self.assertNotIn(SYNTHETIC_KEY, str(ctx.exception))
                self.assertIn(ctx.exception.code, ("TIMEOUT", "NETWORK_ERROR"))

    def test_invalid_empty_truncated_and_non_object_results(self):
        for body in [b"not json", b"{}", response(" "), response("[]"), response("{bad"), response('{"ok":true}', "length")]:
            with self.subTest(body_length=len(body)):
                with self.assertRaises(DeepSeekError):
                    self.client(StubOpener(body)).chat_json([{"role": "user", "content": "JSON"}])

    def test_key_cannot_be_sent_to_other_origins(self):
        for base in ["http://api.deepseek.com", "https://example.com", "https://api.deepseek.com@evil.invalid", "https://api.deepseek.com/?token=hidden"]:
            with self.subTest(base=base):
                with self.assertRaises(DeepSeekError):
                    DeepSeekClient(DeepSeekConfig(base, "deepseek-flash", SYNTHETIC_KEY))


if __name__ == "__main__":
    unittest.main()
