"""TOTP (RFC 6238) helpers — Google Authenticator compatible (Cycle 17).

Pure stdlib implementation: ``hashlib.sha1`` + ``hmac`` + ``base64`` + ``secrets``.
No third-party deps (the brief explicitly rules them out).

Algorithm summary:

  - Secret is 160 random bits, presented to the user as 32 base32 chars
    (no padding) so it's drag-and-drop into authenticator apps.
  - Time counter T = floor((unix_now - T0) / period). T0 = 0, period = 30s.
  - HMAC-SHA1 over the 8-byte big-endian counter using the raw (decoded)
    secret as the key — RFC 4226 §5.3.
  - Dynamic truncation: take the low nibble of the last byte as offset,
    read 4 bytes there, mask the high bit, modulo 10**digits.
  - Output is left-padded with zeros to exactly 6 digits.

Verification accepts ±``window`` time-steps (default 1 step = ±30s) so a
user typing the code as it ticks over still succeeds. ``hmac.compare_digest``
is used so we don't leak code-prefix info via timing.
"""
from __future__ import annotations

import base64
import hmac
import secrets
import struct
import time
from hashlib import sha1
from urllib.parse import quote

# RFC 6238 defaults — these are also Google Authenticator's defaults.
DEFAULT_PERIOD = 30
DEFAULT_DIGITS = 6
SECRET_BYTES = 20  # 160 bits → 32 base32 chars


def generate_secret() -> str:
    """Return a fresh base32 secret (32 chars, no padding).

    Caller decides whether to persist (after verify) or just stage in a
    short-lived token. Never log this value.
    """
    raw = secrets.token_bytes(SECRET_BYTES)
    # base32 encodes 5 bits per char → 20 bytes = 32 chars exactly.
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def _b32decode(secret: str) -> bytes:
    """Tolerate lowercase / missing padding from copy-pasted secrets."""
    s = secret.strip().replace(" ", "").upper()
    # base32 strings must be a multiple of 8 chars — pad as needed.
    pad = (-len(s)) % 8
    return base64.b32decode(s + "=" * pad, casefold=True)


def _hotp(secret_bytes: bytes, counter: int, *, digits: int = DEFAULT_DIGITS) -> str:
    """RFC 4226 HOTP — HMAC-SHA1 + dynamic truncation."""
    msg = struct.pack(">Q", counter)
    digest = hmac.new(secret_bytes, msg, sha1).digest()
    # Dynamic-truncation: last nibble selects offset 0..15.
    offset = digest[-1] & 0x0F
    code_int = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    code = code_int % (10**digits)
    return str(code).zfill(digits)


def current_code(
    secret: str,
    *,
    at: float | None = None,
    period: int = DEFAULT_PERIOD,
    digits: int = DEFAULT_DIGITS,
) -> str:
    """Compute the current TOTP code for ``secret`` (debug + tests).

    Pass ``at`` to compute a code at a specific unix timestamp. The
    production verify path uses this internally.
    """
    now = at if at is not None else time.time()
    counter = int(now // period)
    return _hotp(_b32decode(secret), counter, digits=digits)


def verify_code(
    secret: str,
    code: str,
    *,
    window: int = 1,
    at: float | None = None,
    period: int = DEFAULT_PERIOD,
    digits: int = DEFAULT_DIGITS,
) -> bool:
    """Constant-time TOTP verification with ±``window`` step tolerance.

    Returns False on any malformed input — never raises so the caller can
    treat verification as a clean boolean. ``window=1`` (default) accepts
    the prior, current, and next 30s windows = ~90s effective tolerance.
    """
    if not isinstance(code, str):
        return False
    cleaned = code.strip().replace(" ", "")
    if len(cleaned) != digits or not cleaned.isdigit():
        return False
    try:
        key = _b32decode(secret)
    except Exception:  # noqa: BLE001 — malformed secret = reject
        return False

    now = at if at is not None else time.time()
    counter = int(now // period)
    for delta in range(-window, window + 1):
        candidate = _hotp(key, counter + delta, digits=digits)
        if hmac.compare_digest(candidate, cleaned):
            return True
    return False


def provisioning_uri(
    secret: str,
    account: str,
    *,
    issuer: str = "MX White Paper",
    period: int = DEFAULT_PERIOD,
    digits: int = DEFAULT_DIGITS,
) -> str:
    """Build an ``otpauth://totp/...`` URI for QR display.

    Format follows Google Authenticator's key-uri spec; the issuer is
    duplicated in the label and the query so older clients that only
    parse one of them still work. ``account`` is typically the user's
    email; ``issuer`` is the brand.
    """
    label = f"{issuer}:{account}"
    q = (
        f"secret={quote(secret, safe='')}"
        f"&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1"
        f"&digits={digits}"
        f"&period={period}"
    )
    return f"otpauth://totp/{quote(label, safe=':')}?{q}"


# ── Backup codes ────────────────────────────────────────────────────────────
#
# Backup codes are 8 codes of 10 chars (Crockford-base32 for unambiguous
# transcription). They're handed to the user once at setup time and stored
# argon2-hashed on the user row; consuming a code marks it "USED" so list
# length stays stable and audits can count remaining codes.

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
BACKUP_CODE_COUNT = 8
BACKUP_CODE_LEN = 10
BACKUP_USED_MARKER = "USED"


def generate_backup_codes() -> list[str]:
    """Return ``BACKUP_CODE_COUNT`` fresh plaintext backup codes.

    Each is ``BACKUP_CODE_LEN`` Crockford chars formatted "XXXXX-XXXXX"
    for readability. Never log; only the argon2 hash is persisted.
    """
    out: list[str] = []
    for _ in range(BACKUP_CODE_COUNT):
        body = "".join(secrets.choice(_CROCKFORD) for _ in range(BACKUP_CODE_LEN))
        # Insert a hyphen at the midpoint — purely cosmetic; we strip
        # hyphens on verify.
        out.append(f"{body[:5]}-{body[5:]}")
    return out


def normalise_backup_code(code: str) -> str:
    """Uppercase + strip whitespace/hyphens for stable verify input."""
    return "".join(ch for ch in code.upper() if ch in _CROCKFORD)
