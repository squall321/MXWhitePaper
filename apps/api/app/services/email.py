"""Email / SMTP integration.

A thin wrapper around stdlib `smtplib` + `email.message.EmailMessage` so the
codebase doesn't pick up a new dependency just to deliver subscription digests,
share-link invites, and review-request notifications.

Behaviour gate:

    settings.email_enabled = False  →  log the rendered message to stdout under
                                       a "[EMAIL CONSOLE FALLBACK]" prefix and
                                       return True (so dev callers don't fail).
    settings.email_enabled = True   →  open SMTP, authenticate if user/password
                                       given, send. On any exception log
                                       recipient + subject and return False —
                                       never raise into the caller.

Templates are plain Python f-strings (no Jinja). The trio below covers the
three documented hooks; HTML email is intentionally postponed (see Deliverable
notes).
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from typing import Any, Iterable

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def send_email(
    to: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> bool:
    """Send `body_text` (and optional `body_html`) to `to`.

    Returns True on console-fallback or successful SMTP delivery, False if
    SMTP raised. Never raises into the caller.
    """
    if not to or not isinstance(to, str):
        logger.warning("send_email skipped: invalid recipient %r", to)
        return False

    settings = get_settings()

    if not settings.email_enabled:
        # Console fallback — useful for dev + tests where no SMTP is wired up.
        # Logged at INFO so it surfaces in default uvicorn output.
        logger.info(
            "[EMAIL CONSOLE FALLBACK]\n"
            "  To:      %s\n"
            "  From:    %s\n"
            "  Subject: %s\n"
            "  Body:\n%s",
            to,
            settings.smtp_from,
            subject,
            _indent(body_text),
        )
        return True

    if not settings.smtp_host:
        logger.warning(
            "send_email: email_enabled=True but smtp_host empty — to=%s subject=%s",
            to,
            subject,
        )
        return False

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.ehlo()
            try:
                smtp.starttls()
                smtp.ehlo()
            except smtplib.SMTPNotSupportedError:
                # Server doesn't advertise STARTTLS — proceed plain (dev MTAs).
                pass
            if settings.smtp_user and settings.smtp_password:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception as e:  # noqa: BLE001 — best-effort, never propagate
        logger.warning(
            "send_email failed: to=%s subject=%s error=%s", to, subject, e
        )
        return False


def _indent(s: str) -> str:
    return "\n".join("    " + line for line in s.splitlines())


# ── Templates ──────────────────────────────────────────────────────────────


def digest_email(user_name: str, items: list[dict[str, Any]]) -> tuple[str, str]:
    """Subscription digest. `items` is the list bundled into the digest
    notification — each entry has `document_id`, `event_kind`, optional
    `payload.title`, `payload.slug`. Returns (subject, body_text)."""
    subject = "MX 백서 일일 다이제스트"
    lines: list[str] = [
        f"안녕하세요 {user_name or ''}님,".strip().rstrip(","),
        "",
        f"구독 중인 문서에 총 {len(items)}건의 변경이 있었습니다.",
        "",
    ]
    for it in items:
        payload = it.get("payload") or {}
        title = payload.get("title") or it.get("document_id", "(문서)")
        slug = payload.get("slug")
        kind = it.get("event_kind", "")
        suffix = f" ({slug})" if slug else ""
        lines.append(f"- [{kind}] {title}{suffix}")
    lines.append("")
    lines.append("자세한 내용은 알림 센터에서 확인하세요.")
    return subject, "\n".join(lines)


def share_link_email(
    recipient: str,
    sender_name: str,
    doc_title: str,
    share_url: str,
    optout_url: str | None = None,
) -> tuple[str, str]:
    """Share-link invite. Returns (subject, body_text).

    When ``optout_url`` is provided we append a "수신 거부" footer pointing
    at the GET handler. Per CAN-SPAM / KISA guidelines an opt-out link is
    required when emailing addresses that haven't actively subscribed.
    """
    subject = f"{sender_name}님이 '{doc_title}' 문서를 공유했습니다"
    parts = [
        "안녕하세요,",
        "",
        f"{sender_name}님이 MX 백서의 '{doc_title}' 문서를 공유 링크로 보냈습니다.",
        "아래 주소에서 열람할 수 있습니다.",
        "",
        f"  {share_url}",
        "",
        "링크에 비밀번호가 설정되어 있을 수 있으니, 발신자에게 별도로 확인해주세요.",
        "",
        "— MX 백서",
    ]
    if optout_url:
        parts.extend([
            "",
            "이 메일을 더 이상 받지 않으시려면 아래 링크를 클릭해주세요.",
            f"  수신 거부: {optout_url}",
        ])
    _ = recipient  # only used at the SMTP layer
    return subject, "\n".join(parts)


def review_request_email(
    reviewer_name: str,
    requester_name: str,
    doc_title: str,
    doc_url: str,
) -> tuple[str, str]:
    """Review request. Returns (subject, body_text)."""
    subject = f"검토 요청: {doc_title}"
    body = (
        f"{reviewer_name or ''}님,\n\n".strip()
        + "\n\n"
        + f"{requester_name}님이 '{doc_title}' 문서의 검토를 요청했습니다.\n"
        f"아래 링크에서 본문 확인 후 승인 / 반려를 남겨주세요.\n\n"
        f"  {doc_url}\n\n"
        f"— MX 백서"
    )
    return subject, body


def verify_email_template(user_name: str, verify_url: str) -> tuple[str, str]:
    """Email verification link. Returns (subject, body_text)."""
    subject = "이메일 주소 확인"
    body = (
        f"{user_name or ''}님,\n\n".strip()
        + "\n\n"
        + "MX 백서 계정의 이메일 주소를 확인해주세요.\n"
        + "아래 링크를 24시간 이내에 클릭하시면 인증이 완료됩니다.\n\n"
        + f"  {verify_url}\n\n"
        + "본인이 요청하지 않았다면 이 메일을 무시해도 안전합니다.\n\n"
        + "— MX 백서"
    )
    return subject, body


def password_reset_template(user_name: str, reset_url: str) -> tuple[str, str]:
    """Password reset request. Returns (subject, body_text)."""
    subject = "비밀번호 재설정 요청"
    body = (
        f"{user_name or ''}님,\n\n".strip()
        + "\n\n"
        + "MX 백서 계정의 비밀번호 재설정 요청을 받았습니다.\n"
        + "아래 링크는 15분 동안 유효합니다.\n\n"
        + f"  {reset_url}\n\n"
        + "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다 — 비밀번호는 변경되지 않습니다.\n\n"
        + "— MX 백서"
    )
    return subject, body


# Convenience: send a digest email built from notification payload + user row.
async def send_digest_email(
    *, user_email: str, user_name: str, items: Iterable[dict[str, Any]]
) -> bool:
    items_list = list(items)
    if not items_list:
        return False
    subject, body = digest_email(user_name, items_list)
    return await send_email(user_email, subject, body)
