"""Loopback acceptance preview with synthetic members and an isolated SQLite v5 database."""

from contextlib import contextmanager
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys
from threading import Thread
import time
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("PF_V33_PORT", "8147"))
ORIGIN = f"http://{HOST}:{PORT}"
ISSUER = "https://v33-preview.invalid"
AUDIENCE = "policy-v33-review"


@contextmanager
def database_lease(path):
    """Hold an OS lock for the lifetime of the instance, including on Windows."""
    with path.open("a+b") as lock:
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main(ai_client_factory=None):
    instance = os.environ.get("PF_V33_INSTANCE", "manual")
    if not instance.isascii() or not instance.replace("-", "").isalnum():
        raise ValueError("Invalid V3.3 instance")
    mode = os.environ.get("PF_V33_SEARCH_MODE", "mock")
    if mode not in ("mock", "live"):
        raise ValueError("PF_V33_SEARCH_MODE must be mock or live")
    run = ROOT / "data" / "private-migration" / ("v33-" + instance)
    database = (run / "acceptance.db").resolve()
    if database != run / "acceptance.db" or not database.is_file() or database.stat().st_nlink != 1:
        raise SystemExit("Prepare the named isolation database explicitly before startup.")
    with database_lease(run / ".service.lock"):
        _serve(instance, mode, run, database, ai_client_factory)


def _serve(instance, mode, run, database, ai_client_factory):
    key = secrets.token_hex(32)
    os.environ.update(PORT=str(PORT), POLICY_ENV="production", POLICY_DB="guangzhou",
                      PF_FOLLOWUP_SQLITE="1", PF_FOLLOWUP_DB=str(database), AI_ANALYSIS_ENABLED="1",
                      PF_FOLLOWUP_IDENTITY_MODE="gateway", PF_IDENTITY_ISSUER=ISSUER,
                      PF_IDENTITY_AUDIENCE=AUDIENCE, PF_IDENTITY_GATEWAY_KEY=key)
    sys.path.insert(0, str(ROOT / "backend"))
    import followup_db
    followup_db.bind_preview_database(database)
    import household_analysis
    import server
    from deepseek_client import DeepSeekClient
    config = ROOT.parent / "home-ui-review" / ".env"
    household_analysis.client_factory = ai_client_factory or (lambda: DeepSeekClient.from_env(config, timeout=24))
    if mode == "mock":
        from preview_search_fixture import mock_transport
        server.WEB_SEARCH = server.cleversee.SearchService(transport=mock_transport)
    loopback = build_opener(ProxyHandler({}))

    # Both cities use their original JSON rows. The preview combines them in memory.
    server.DB = {
        "database_name": "广州和佛山隔离验收目录",
        "version": "V3.2",
        "policies": [row for city in ("guangzhou", "foshan")
                     for row in server.engine.load_database(server.engine.DATABASES[city])["policies"]],
    }
    nonce = secrets.token_hex(16)
    cookie = "pf_preview_run"
    class PreviewHandler(server.Handler):
        def end_headers(self):
            self.send_header("X-PF-Preview-Instance", instance)
            self.send_header("X-PF-Preview-Run", nonce)
            if self.command == "GET" and self.headers.get("Sec-Fetch-Site") != "cross-site":
                self.send_header("Set-Cookie", f"{cookie}={nonce}; Path=/; HttpOnly; SameSite=Strict")
            super().end_headers()

        def parse_request(self):
            if not super().parse_request():
                return False
            if self.client_address[0] != HOST or self.headers.get("Host") != f"{HOST}:{PORT}":
                self.send_error(403)
                return False
            if (self.headers.get("Origin", ORIGIN) != ORIGIN
                    or self.headers.get("Sec-Fetch-Site") == "cross-site"):
                self.send_error(403)
                return False
            now = int(time.time())
            cookies = self.headers.get("Cookie", "").split(";")
            has_run = (self.headers.get("X-PF-Preview-Run") == nonce
                       or f"{cookie}={nonce}" in {value.strip() for value in cookies})
            if self.command == "POST" and (self.headers.get("Origin") != ORIGIN or not has_run):
                self.send_error(403)
                return False
            claims = dict(iss=ISSUER, aud=AUDIENCE, sub="synthetic-v33-reviewer",
                          iat=now, exp=now + 15, method=self.command, path=self.path)
            encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=")
            signature = hmac.new(key.encode(), encoded, hashlib.sha256).hexdigest()
            del self.headers["X-PF-Identity"]
            self.headers["X-PF-Identity"] = encoded.decode() + "." + signature
            return True

    def create_member(name):
        body = json.dumps(dict(operationId=str(uuid4()), name=name, relation="母亲")).encode()
        request = Request(f"{ORIGIN}/api/followup/members", data=body,
                          headers={"Origin": ORIGIN, "X-PF-Preview-Run": nonce, "X-PF-Local": "1", "Content-Type": "application/json"})
        with loopback.open(request, timeout=10) as response:
            return json.load(response)["member"]["id"]

    with server.ThreadingHTTPServer((HOST, PORT), PreviewHandler) as httpd:
        server._prepare_followup_runtime(HOST)
        household_analysis.initialize()
        thread = Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            with loopback.open(f"{ORIGIN}/api/followup/members", timeout=10) as response:
                if response.getheader("X-PF-Preview-Run") != nonce:
                    raise RuntimeError("Loopback responded from a different preview service.")
                existing = {entry["name"]: entry["id"] for entry in json.load(response)["members"]
                            if not entry["archivedAt"]}
            seed = {"origin": ORIGIN, "pid": os.getpid(), "database": str(database), "instance": instance,
                    "run": nonce, "search_mode": mode, "ai_mode": "fixture" if ai_client_factory else "configured",
                    "member": existing.get("验收甲") or create_member("验收甲"),
                    "other": existing.get("验收乙") or create_member("验收乙"),
                    "integrity": followup_db.check_integrity(database)}
            (run / "fixture.json").write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(seed, ensure_ascii=True), flush=True)
            thread.join()
        finally:
            httpd.shutdown()


if __name__ == "__main__":
    main()
