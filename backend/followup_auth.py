"""Access to one loopback preview household. Production identity is separate."""
import hashlib
import hmac
from http.cookies import CookieError, SimpleCookie
import os
import time


MAX_AGE = 8 * 60 * 60


def configured():
    token = os.environ.get("PF_FOLLOWUP_ACCESS_TOKEN", "")
    return token if len(token) >= 32 else ""


def _signature(token, port, expires):
    return hmac.new(token.encode(), f"pf-local-session:{port}:{expires}".encode(), hashlib.sha256).hexdigest()


def _name(port):
    return f"pf_preview_{port}"


def issue(candidate, port):
    token = configured()
    if not token or not isinstance(candidate, str) or not hmac.compare_digest(token.encode(), candidate.encode()):
        return None
    expires = int(time.time()) + MAX_AGE
    value = f"{expires}.{_signature(token, port, expires)}"
    return f"{_name(port)}={value}; Path=/api; Max-Age={MAX_AGE}; HttpOnly; SameSite=Strict"


def authorized(header, port):
    token = configured()
    if not token:
        return False
    try:
        cookie = SimpleCookie(header).get(_name(port))
        if not cookie:
            return False
        expires, signature = cookie.value.split(".", 1)
        return (expires.isascii() and expires.isdigit() and len(expires) <= 12 and signature.isascii()
                and int(expires) > time.time()
                and hmac.compare_digest(_signature(token, port, int(expires)), signature))
    except (CookieError, ValueError):
        return False
