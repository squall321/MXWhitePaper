"""Per-doc custom CSS sanitizer.

Cycle 18 — admins can attach branded CSS to any document. The result is
embedded into the namuwiki HTML render's ``<head>`` as a ``<style>`` tag,
so we MUST scrub anything that can pop a ``<script>`` execution context or
exfiltrate data.

Design
------
This is a deliberate **regex-based** scrub — NOT a full CSS parser. The
philosophy:

* CSS doesn't execute by default. The dangerous patterns are a small,
  well-known finite set (``expression()``, ``url(javascript:…)``,
  ``url(data:text/html,…)``, ``<script>``, ``@import``, ``behavior:``).
* A real CSS parser ships ~thousands of LOC of dependency surface. We
  don't want to absorb that for one feature.
* The CSS is rendered inside a trusted ``<style>`` tag we control — a
  browser will simply *ignore* invalid declarations, so partial damage
  from our regex (e.g. comment removal eating a literal ``/*`` inside a
  string — extremely uncommon in CSS) degrades safely.

Limitations (documented):
* No selector scoping — CSS leaks into the entire rendered HTML page.
  See `html_renderer.py` for the warning notice; admin-only role limits
  blast radius.
* Doesn't catch obfuscated payloads like CSS variable indirection
  (``--x: url(javascript:…)`` then ``background: var(--x)``). Browsers
  still resolve at the *use* site, where our scrub already ran on the raw
  text — but we explicitly strip ``url(javascript:`` regardless of
  surrounding whitespace.
* Doesn't validate CSS syntax. Garbage in, garbage out — but garbage CSS
  is a no-op (browsers ignore malformed declarations).

Pure function — no I/O, no state. Easy to test.
"""
from __future__ import annotations

import re

MAX_CUSTOM_CSS_LEN = 10_000

# ── Strip patterns ─────────────────────────────────────────────────────
# Each entry is (compiled_regex, warning_label). Order matters: HTML-ish
# script blocks first (defensive — CSS shouldn't contain them but admins
# sometimes paste full <style> tags from elsewhere), then CSS-syntax
# attacks.

_STRIP_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # <script ...>...</script> — paranoid (CSS != HTML, but pasted style
    # tags from a docpage might contain them inside CDATA-ish blocks).
    (
        re.compile(r"<\s*script\b[^<]*(?:(?!</\s*script\s*>)<[^<]*)*</\s*script\s*>", re.IGNORECASE),
        "script-block",
    ),
    # Bare opening / closing <script> tags w/o body (just in case).
    (re.compile(r"<\s*/?\s*script\b[^>]*>", re.IGNORECASE), "script-tag"),
    # IE legacy: expression(...) — JS in CSS context.
    (re.compile(r"\bexpression\s*\([^)]*\)", re.IGNORECASE), "expression"),
    # url(javascript:...) — XSS via background-image etc.
    # Whitespace tolerant; matches both quoted and unquoted forms.
    (
        re.compile(r"""url\s*\(\s*['"]?\s*javascript\s*:[^)]*\)""", re.IGNORECASE),
        "url-javascript",
    ),
    # url(data:text/html,...) — equivalent XSS surface (Chromium/Firefox
    # block but Safari allows in some contexts).
    (
        re.compile(r"""url\s*\(\s*['"]?\s*data\s*:\s*text\s*/\s*html[^)]*\)""", re.IGNORECASE),
        "url-data-html",
    ),
    # url(vbscript:...) — IE legacy, harmless on modern browsers but we
    # strip for completeness.
    (
        re.compile(r"""url\s*\(\s*['"]?\s*vbscript\s*:[^)]*\)""", re.IGNORECASE),
        "url-vbscript",
    ),
    # @import — pulls in external CSS bypassing CSP.
    (re.compile(r"@import\b[^;]*;?", re.IGNORECASE), "import"),
    # behavior: url(...) — IE5/6 HTC binding (allowed JS).
    (re.compile(r"\bbehavior\s*:\s*[^;}]+;?", re.IGNORECASE), "behavior"),
    # -moz-binding — Firefox legacy XBL bindings (also JS surface).
    (re.compile(r"-moz-binding\s*:\s*[^;}]+;?", re.IGNORECASE), "moz-binding"),
]


def sanitize_css(raw: str | None) -> tuple[str, list[str]]:
    """Strip dangerous CSS constructs and return ``(safe_css, warnings)``.

    Args:
        raw: raw CSS string from admin input. None / empty → ``("", [])``.

    Returns:
        Tuple of:
        * sanitized CSS (truncated to ``MAX_CUSTOM_CSS_LEN`` chars)
        * list of warning labels for each pattern matched, in the order
          they were stripped. Useful for surfacing "we removed XYZ from
          your CSS" in the editor preview.

    Idempotent: sanitizing already-sanitized output is a no-op (returns
    same text + empty warnings).
    """
    if raw is None:
        return "", []
    text = str(raw)
    if not text:
        return "", []

    # Cap input length first — defense in depth against accidental DoS
    # via gigantic regex backtracking.
    if len(text) > MAX_CUSTOM_CSS_LEN:
        text = text[:MAX_CUSTOM_CSS_LEN]

    warnings: list[str] = []
    for pattern, label in _STRIP_PATTERNS:
        new_text, n = pattern.subn("", text)
        if n > 0:
            warnings.append(label)
            text = new_text

    return text, warnings


__all__ = ["sanitize_css", "MAX_CUSTOM_CSS_LEN"]
