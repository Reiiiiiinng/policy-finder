"""Request identity received from a trusted OIDC gateway in isolated preview."""
import base64
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import hmac
import json
import os
import time
from uuid import UUID, uuid5

from followup_db import LOCAL_USER_ID, SELF_MEMBER_ID, transaction


LOCAL = (LOCAL_USER_ID, SELF_MEMBER_ID)
principal = ContextVar("followup_principal", default=LOCAL)
NAMESPACE = UUID("c08c4169-99b1-427a-8d55-1ff16f7588d6")


@contextmanager
def scope(identity):
    marker = principal.set(identity)
    try:
        yield
    finally:
        principal.reset(marker)


def gateway_mode():
    return os.environ.get("PF_FOLLOWUP_IDENTITY_MODE") == "gateway"


def gateway_configuration():
    key = os.environ.get("PF_IDENTITY_GATEWAY_KEY", "").encode()
    issuer = os.environ.get("PF_IDENTITY_ISSUER", "")
    audience = os.environ.get("PF_IDENTITY_AUDIENCE", "")
    if len(key) >= 32 and issuer.startswith("https://") and audience:
        return key, issuer, audience


def resolve(handler):
    if not gateway_mode():
        from followup_auth import authorized
        return LOCAL if authorized(handler.headers.get("Cookie", ""), handler.server.server_port) else None
    config = gateway_configuration()
    assertions = handler.headers.get_all("X-PF-Identity") or []
    if not config or len(assertions) != 1 or len(assertions[0]) > 4096:
        return None
    key, issuer, audience = config
    try:
        encoded, signature = assertions[0].split(".", 1)
        if not signature.isascii() or not hmac.compare_digest(
                hmac.new(key, encoded.encode("ascii"), hashlib.sha256).hexdigest(), signature):
            return None
        claims = json.loads(base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True))
        now = int(time.time())
        if (not isinstance(claims, dict) or claims.get("iss") != issuer or claims.get("aud") != audience
                or claims.get("method") != handler.command or claims.get("path") != handler.path
                or type(claims.get("iat")) is not int or type(claims.get("exp")) is not int
                or not now - 30 <= claims["iat"] <= now or not now < claims["exp"] <= claims["iat"] + 30):
            return None
        subject = claims.get("sub")
        if not isinstance(subject, str) or not 0 < len(subject) <= 255:
            return None
    except (ValueError, UnicodeError):
        return None

    user_id = str(uuid5(NAMESPACE, json.dumps([issuer, subject])))
    self_id = str(uuid5(NAMESPACE, "self:" + user_id))
    with transaction() as db:
        exists = db.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone()
    if not exists:
        stamp = time.time_ns() // 1_000_000
        with transaction(write=True) as db:
            db.execute("INSERT INTO users VALUES (?, '账户使用者', ?) ON CONFLICT(id) DO NOTHING", (user_id, stamp))
            db.execute("""INSERT INTO members(id,user_id,name,relationship,created_at,updated_at)
                          VALUES (?, ?, '本人', 'self', ?, ?) ON CONFLICT(id) DO NOTHING""",
                       (self_id, user_id, stamp, stamp))
    return user_id, self_id
