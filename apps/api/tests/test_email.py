"""Tests for `app.services.email` — console fallback, SMTP success/failure,
template rendering. Pure unit tests (no DB)."""
from __future__ import annotations

import logging
import smtplib
from unittest.mock import MagicMock, patch

import pytest

from app.core.config import get_settings
from app.services import email as email_mod
from app.services.email import (
    digest_email,
    password_reset_template,
    review_request_email,
    send_email,
    share_link_email,
    verify_email_template,
)

# ── Templates ──────────────────────────────────────────────────────────────


def test_digest_email_renders_subject_and_lists_items() -> None:
    items = [
        {
            "document_id": "abc",
            "event_kind": "doc_edited",
            "payload": {"title": "월말 마감", "slug": "month-end-closing"},
        },
        {
            "document_id": "def",
            "event_kind": "comment_added",
            "payload": {"title": "원가 노트"},
        },
    ]
    subject, body = digest_email("홍길동", items)
    assert subject == "MX 백서 일일 다이제스트"
    assert "홍길동" in body
    assert "총 2건" in body
    assert "[doc_edited] 월말 마감 (month-end-closing)" in body
    assert "[comment_added] 원가 노트" in body


def test_share_link_email_renders_korean_subject() -> None:
    subject, body = share_link_email(
        recipient="r@example.com",
        sender_name="이순신",
        doc_title="신제품 사양",
        share_url="/share/tok123",
    )
    assert subject == "이순신님이 '신제품 사양' 문서를 공유했습니다"
    assert "/share/tok123" in body
    assert "이순신" in body


def test_review_request_email_renders() -> None:
    subject, body = review_request_email(
        reviewer_name="강감찬",
        requester_name="장보고",
        doc_title="원가 분석",
        doc_url="/docs/cost",
    )
    assert subject == "검토 요청: 원가 분석"
    assert "강감찬" in body
    assert "장보고" in body
    assert "/docs/cost" in body


def test_verify_email_template_renders() -> None:
    subject, body = verify_email_template(
        user_name="홍길동", verify_url="https://wp.example.com/auth/verify?token=abc"
    )
    assert subject == "이메일 주소 확인"
    assert "홍길동" in body
    assert "https://wp.example.com/auth/verify?token=abc" in body
    assert "24시간" in body


def test_password_reset_template_renders() -> None:
    subject, body = password_reset_template(
        user_name="이순신", reset_url="https://wp.example.com/auth/reset?token=xyz"
    )
    assert subject == "비밀번호 재설정 요청"
    assert "이순신" in body
    assert "https://wp.example.com/auth/reset?token=xyz" in body
    assert "15분" in body


# ── Console fallback ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_send_email_console_fallback_logs_and_returns_true(
    caplog: pytest.LogCaptureFixture,
) -> None:
    get_settings.cache_clear()
    settings = get_settings()
    # Belt-and-suspenders: even if a future env flips this, force off here.
    object.__setattr__(settings, "email_enabled", False)
    caplog.set_level(logging.INFO, logger="app.services.email")
    ok = await send_email(
        "user@example.com", "subject", "hello world"
    )
    assert ok is True
    assert any(
        "[EMAIL CONSOLE FALLBACK]" in rec.message for rec in caplog.records
    )
    assert any("user@example.com" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_send_email_invalid_recipient_returns_false() -> None:
    assert await send_email("", "s", "b") is False


# ── SMTP path ──────────────────────────────────────────────────────────────


def _enable_smtp() -> None:
    """Force email_enabled + a stub smtp_host onto the cached settings."""
    get_settings.cache_clear()
    settings = get_settings()
    object.__setattr__(settings, "email_enabled", True)
    object.__setattr__(settings, "smtp_host", "smtp.example.com")
    object.__setattr__(settings, "smtp_port", 587)
    object.__setattr__(settings, "smtp_user", "u")
    object.__setattr__(settings, "smtp_password", "p")


def _restore_settings() -> None:
    get_settings.cache_clear()
    settings = get_settings()
    object.__setattr__(settings, "email_enabled", False)
    object.__setattr__(settings, "smtp_host", None)


@pytest.mark.asyncio
async def test_send_email_smtp_success_calls_send_message() -> None:
    _enable_smtp()
    try:
        smtp_instance = MagicMock()
        smtp_instance.__enter__ = MagicMock(return_value=smtp_instance)
        smtp_instance.__exit__ = MagicMock(return_value=False)
        with patch.object(email_mod.smtplib, "SMTP", return_value=smtp_instance) as smtp_cls:
            ok = await send_email("to@example.com", "subj", "body")
        assert ok is True
        smtp_cls.assert_called_once_with("smtp.example.com", 587, timeout=15)
        smtp_instance.login.assert_called_once_with("u", "p")
        smtp_instance.send_message.assert_called_once()
        sent_msg = smtp_instance.send_message.call_args.args[0]
        assert sent_msg["To"] == "to@example.com"
        assert sent_msg["Subject"] == "subj"
    finally:
        _restore_settings()


@pytest.mark.asyncio
async def test_send_email_smtp_starttls_not_supported_falls_through() -> None:
    """Servers without STARTTLS should not blow up — login still proceeds."""
    _enable_smtp()
    try:
        smtp_instance = MagicMock()
        smtp_instance.__enter__ = MagicMock(return_value=smtp_instance)
        smtp_instance.__exit__ = MagicMock(return_value=False)
        smtp_instance.starttls.side_effect = smtplib.SMTPNotSupportedError(
            "no STARTTLS"
        )
        with patch.object(email_mod.smtplib, "SMTP", return_value=smtp_instance):
            ok = await send_email("to@example.com", "s", "b")
        assert ok is True
        smtp_instance.send_message.assert_called_once()
    finally:
        _restore_settings()


@pytest.mark.asyncio
async def test_send_email_smtp_failure_returns_false_and_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    _enable_smtp()
    try:
        caplog.set_level(logging.WARNING, logger="app.services.email")
        with patch.object(
            email_mod.smtplib, "SMTP", side_effect=OSError("connection refused")
        ):
            ok = await send_email("to@example.com", "subj", "body")
        assert ok is False
        assert any(
            "send_email failed" in rec.message and "to@example.com" in rec.message
            for rec in caplog.records
        )
    finally:
        _restore_settings()


@pytest.mark.asyncio
async def test_send_email_enabled_but_no_host_returns_false() -> None:
    get_settings.cache_clear()
    settings = get_settings()
    object.__setattr__(settings, "email_enabled", True)
    object.__setattr__(settings, "smtp_host", None)
    try:
        ok = await send_email("to@example.com", "s", "b")
        assert ok is False
    finally:
        _restore_settings()
