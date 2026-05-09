"""Per-doc custom CSS sanitizer tests.

Cycle 18 — covers the regex-based scrub used before persisting admin
branding CSS. We focus on:

* Each XSS-shaped pattern actually being stripped.
* Each warning label appearing in the output.
* Pure / idempotent behaviour.
* Length cap.
* That benign CSS (selectors, custom properties, media queries, image
  url()) flows through unchanged.
"""
from __future__ import annotations

from app.services.css_sanitizer import MAX_CUSTOM_CSS_LEN, sanitize_css


# ── empty / None passthrough ─────────────────────────────────────────


def test_none_returns_empty_no_warnings() -> None:
    out, warnings = sanitize_css(None)
    assert out == ""
    assert warnings == []


def test_empty_returns_empty_no_warnings() -> None:
    out, warnings = sanitize_css("")
    assert out == ""
    assert warnings == []


# ── benign CSS preserved ─────────────────────────────────────────────


def test_preserves_simple_rule() -> None:
    css = ".doc-title { color: #1428a0; font-weight: 700; }"
    out, warnings = sanitize_css(css)
    assert out == css
    assert warnings == []


def test_preserves_custom_properties() -> None:
    css = ":root { --brand: #1428a0; } body { background: var(--brand); }"
    out, warnings = sanitize_css(css)
    assert out == css
    assert warnings == []


def test_preserves_media_queries() -> None:
    css = "@media print { .toc { display: none; } } @media (min-width: 800px) { body { padding: 32px; } }"
    out, warnings = sanitize_css(css)
    assert out == css
    assert warnings == []


def test_preserves_image_url_https() -> None:
    css = ".banner { background: url('https://cdn.example.com/logo.png') center; }"
    out, warnings = sanitize_css(css)
    assert out == css
    assert warnings == []


def test_preserves_data_image_url() -> None:
    css = ".icon { background: url('data:image/svg+xml;base64,PHN2Z…') no-repeat; }"
    out, warnings = sanitize_css(css)
    assert "data:image/svg+xml" in out
    assert warnings == []


# ── XSS shapes stripped ─────────────────────────────────────────────


def test_strips_script_block() -> None:
    css = "body { color: red; } <script>alert(1)</script>"
    out, warnings = sanitize_css(css)
    assert "<script" not in out.lower()
    assert "alert" not in out
    assert "script-block" in warnings


def test_strips_bare_script_tag() -> None:
    css = "body { } <script src=\"//evil.com/x.js\">"
    out, warnings = sanitize_css(css)
    assert "<script" not in out.lower()
    assert "script-tag" in warnings


def test_strips_expression() -> None:
    css = "body { width: expression(alert(1)); color: red; }"
    out, warnings = sanitize_css(css)
    assert "expression" not in out
    assert "alert" not in out
    assert "expression" in warnings


def test_strips_url_javascript_quoted() -> None:
    css = ".x { background: url('javascript:alert(1)'); }"
    out, warnings = sanitize_css(css)
    assert "javascript" not in out
    assert "url-javascript" in warnings


def test_strips_url_javascript_unquoted_with_spaces() -> None:
    css = ".x { background-image: url(  javascript:alert(1)  ); }"
    out, warnings = sanitize_css(css)
    assert "javascript" not in out
    assert "url-javascript" in warnings


def test_strips_url_data_text_html() -> None:
    css = ".x { background: url('data:text/html,<script>alert(1)</script>'); }"
    out, warnings = sanitize_css(css)
    assert "data:text/html" not in out
    # The <script> bit is also stripped by the script-block pattern, but
    # we only assert the data: surface here.
    assert "url-data-html" in warnings


def test_strips_at_import() -> None:
    css = "@import url('https://evil.com/x.css'); body { color: red; }"
    out, warnings = sanitize_css(css)
    assert "@import" not in out.lower()
    assert "import" in warnings


def test_strips_behavior() -> None:
    css = ".x { behavior: url(#default#VML); color: red; }"
    out, warnings = sanitize_css(css)
    assert "behavior:" not in out.lower()
    assert "behavior" in warnings


def test_strips_moz_binding() -> None:
    css = ".x { -moz-binding: url('http://example.com/xbl.xml#x'); }"
    out, warnings = sanitize_css(css)
    assert "-moz-binding" not in out.lower()
    assert "moz-binding" in warnings


# ── Combined / multi-strip ──────────────────────────────────────────


def test_strips_multiple_patterns_and_lists_warnings() -> None:
    css = (
        "@import 'evil.css';\n"
        "body { color: red; }\n"
        ".bg { background: url(javascript:alert(1)); }\n"
        "<script>alert(2)</script>\n"
    )
    out, warnings = sanitize_css(css)
    # Defensive: no remaining XSS shapes anywhere.
    assert "@import" not in out.lower()
    assert "javascript" not in out
    assert "<script" not in out.lower()
    # Warnings include each label in some order.
    for needed in ("import", "url-javascript", "script-block"):
        assert needed in warnings, f"missing warning {needed} in {warnings}"
    # Benign rule still present.
    assert "color: red;" in out


def test_idempotent() -> None:
    css = "body { color: red; }"
    once, w1 = sanitize_css(css)
    twice, w2 = sanitize_css(once)
    assert once == twice
    assert w1 == w2 == []


def test_sanitizing_already_sanitized_dangerous_input() -> None:
    """Re-running on a previously-sanitized output is a no-op."""
    out1, w1 = sanitize_css("body{} <script>x</script>")
    out2, w2 = sanitize_css(out1)
    assert out1 == out2
    assert w2 == []
    assert "script-block" in w1


# ── Length cap ───────────────────────────────────────────────────────


def test_truncates_to_max_len() -> None:
    big = "/*" + ("a" * (MAX_CUSTOM_CSS_LEN + 5_000)) + "*/"
    out, _ = sanitize_css(big)
    assert len(out) <= MAX_CUSTOM_CSS_LEN
