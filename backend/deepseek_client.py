"""Shared stdlib-only DeepSeek client; no server, UI wiring or secret logging."""
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import socket
import ssl
from urllib import error, request
from urllib.parse import urlsplit

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_KEYS = ("DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "DEEPSEEK_API_KEY")


class DeepSeekError(Exception):
    """Only fixed, safe messages: never include raw server bodies or credentials."""
    def __init__(self, code, message, status=None):
        super().__init__(message)
        self.code = code
        self.status = status


def read_local_config(env_path=None, environ=None):
    """Minimal literal .env reader. Existing process values take precedence.

    Only the three DeepSeek settings are read; no eval, interpolation, shell
    execution, process-environment mutation or changes to PORT/POLICY_DB.
    """
    values = {}
    path = Path(env_path) if env_path is not None else PROJECT_ROOT / ".env"
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []
    except (OSError, UnicodeError):
        raise DeepSeekError("CONFIG_READ", "本地 .env 无法读取，请检查文件权限与 UTF-8 编码。") from None
    for number, line in enumerate(lines, 1):
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        if text.startswith("export "):
            text = text[7:].strip()
        key, sep, value = text.partition("=")
        if key.strip() not in CONFIG_KEYS:
            continue
        if not sep:
            raise DeepSeekError("CONFIG_FORMAT", f".env 第 {number} 行格式有误，需要 KEY=value。")
        value = value.strip()
        if value.startswith(("'", '"')):
            if len(value) < 2 or value[-1] != value[0]:
                raise DeepSeekError("CONFIG_FORMAT", f".env 第 {number} 行引号未闭合。")
            value = value[1:-1]
        values[key.strip()] = value
    source = os.environ if environ is None else environ
    for key in CONFIG_KEYS:
        if key in source:
            values[key] = source[key]
    return values


@dataclass(frozen=True)
class DeepSeekConfig:
    base_url: str
    model: str
    api_key: str = field(repr=False)
    timeout: float = 30.0

    @classmethod
    def load(cls, env_path=None, environ=None, timeout=30):
        values = read_local_config(env_path, environ)
        config = cls(values.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/"),
                     values.get("DEEPSEEK_MODEL", "deepseek-flash"),
                     values.get("DEEPSEEK_API_KEY", "").strip(), timeout)
        config.validate()
        return config

    def validate(self):
        try:
            u = urlsplit(self.base_url)
            valid = (u.scheme == "https" and u.hostname == "api.deepseek.com"
                     and u.port in (None, 443) and not u.username and not u.password
                     and not u.query and not u.fragment and u.path in ("", "/v1"))
        except ValueError:
            valid = False
        if not valid:
            raise DeepSeekError("CONFIG_URL", "BASE_URL 必须使用官方 HTTPS 地址 https://api.deepseek.com。")
        if self.model != "deepseek-flash":
            raise DeepSeekError("CONFIG_MODEL", "本轮配置要求 DEEPSEEK_MODEL=deepseek-flash，不自动切换模型。")
        if not self.api_key:
            raise DeepSeekError("CONFIG_MISSING_KEY", "DEEPSEEK_API_KEY 尚未填写；请仅在本地 .env 中填写。")
        if any(ch.isspace() for ch in self.api_key) or not self.api_key.isascii():
            raise DeepSeekError("CONFIG_KEY_FORMAT", "API Key 含空白或非 ASCII 字符，请在本地检查粘贴内容。")
        if not 1 <= self.timeout <= 120:
            raise DeepSeekError("CONFIG_TIMEOUT", "超时应为 1～120 秒。")


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class DeepSeekClient:
    def __init__(self, config):
        config.validate()
        self.config = config
        self.last_response_model = None
        self._opener = request.build_opener(_NoRedirect())

    @classmethod
    def from_env(cls, env_path=None, environ=None, timeout=30):
        return cls(DeepSeekConfig.load(env_path, environ, timeout))

    def chat_json(self, messages, max_tokens=512):
        """One non-streaming, non-thinking request. No automatic billable retries.

        Returns parsed JSON object only. Prompts and raw responses are not logged.
        """
        if not isinstance(messages, list) or not messages or not all(
            isinstance(m, dict) and m.get("role") in ("system", "user", "assistant")
            and isinstance(m.get("content"), str) for m in messages
        ):
            raise DeepSeekError("INVALID_MESSAGES", "messages 必须为非空文本消息列表。")
        if not isinstance(max_tokens, int) or not 1 <= max_tokens <= 4096:
            raise DeepSeekError("INVALID_TOKENS", "本地客户端输出长度须为 1～4096 tokens。")
        self.last_response_model = None
        payload = {"model": self.config.model,
                   "messages": [{"role": "system", "content": "Return only one valid JSON object, no markdown."}] + messages,
                   "thinking": {"type": "disabled"},
                   "response_format": {"type": "json_object"},
                   "max_tokens": max_tokens, "stream": False}
        req = request.Request(self.config.base_url + "/chat/completions",
                              data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                              headers={"Authorization": "Bearer " + self.config.api_key,
                                       "Content-Type": "application/json"}, method="POST")
        try:
            with self._opener.open(req, timeout=self.config.timeout) as res:
                body = res.read(2_000_001)
        except error.HTTPError as exc:
            status = exc.code
            exc.close()  # Never read/log a possibly credential-reflecting error body.
            messages_by_status = {
                400: "请求参数或模型配置被拒绝，请检查配置。",
                401: "认证失败，请在本地检查 API Key。",
                402: "账户余额不足，请检查 DeepSeek 控制台。",
                403: "请求无权限，请检查账户和密钥权限。",
                404: "接口或模型不可用，请检查官方配置。",
                429: "请求限流，请稍后手动重试。",
            }
            code = "REDIRECT_REJECTED" if 300 <= status < 400 else "HTTP_ERROR"
            raise DeepSeekError(code, messages_by_status.get(status, "上游服务未成功响应，请稍后重试。"), status) from None
        except (TimeoutError, socket.timeout):
            raise DeepSeekError("TIMEOUT", "DeepSeek 请求超时，请稍后手动重试。") from None
        except error.URLError as exc:
            timed_out = isinstance(exc.reason, (TimeoutError, socket.timeout))
            raise DeepSeekError("TIMEOUT" if timed_out else "NETWORK_ERROR",
                                "请求超时。" if timed_out else "网络或 TLS 连接失败，请检查网络与证书。") from None
        except (OSError, ssl.SSLError):
            raise DeepSeekError("NETWORK_ERROR", "网络或 TLS 连接失败，请检查网络与证书。") from None
        if len(body) > 2_000_000:
            raise DeepSeekError("RESPONSE_TOO_LARGE", "上游响应超过本地限制。")
        try:
            data = json.loads(body)
            choice = data["choices"][0]
            content = choice["message"]["content"]
            if choice.get("finish_reason") != "stop":
                raise DeepSeekError("INCOMPLETE_RESPONSE", "输出未正常完成，未当作 JSON 成功结果。")
            if not isinstance(content, str) or not content.strip():
                raise DeepSeekError("EMPTY_RESPONSE", "上游返回空内容，未当作成功；可手动重试。")
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                raise DeepSeekError("INVALID_JSON", "上游未返回 JSON 对象。")
            reported = data.get("model")
            if reported == self.config.model:
                self.last_response_model = reported
            elif isinstance(reported, str):
                self.last_response_model = "different_model"
            return parsed
        except DeepSeekError:
            raise
        except (ValueError, KeyError, IndexError, TypeError):
            raise DeepSeekError("INVALID_RESPONSE", "上游响应结构或 JSON 格式不正确。") from None
