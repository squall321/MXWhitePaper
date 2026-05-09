"""DocumentJSON v1.0 → PDF (WeasyPrint).

WeasyPrint 가 환경에 설치된 경우에만 의미가 있다 — `routers/exports.py` 에서
WeasyPrint 가용성 체크 후 lazy import 한다.

본 모듈은 단지 `html_renderer.render_namuwiki_html` 의 결과를 WeasyPrint 에
넘기는 얇은 어댑터다. 별도 PDF-전용 CSS 가 필요하면 여기서 inject 한다.
"""
from __future__ import annotations

from typing import Any

from app.services.html_renderer import RenderOptions, render_namuwiki_html


def render_pdf(
    content: dict[str, Any], *, requester_role: str | None = None
) -> bytes:
    """DocumentJSON dict 를 받아 PDF 바이트를 돌려준다.

    WeasyPrint 가 설치되어 있지 않으면 ImportError 를 일으킨다 — 호출 측에서
    가용성을 보장한 후에만 호출할 것.

    `requester_role` 이 주어지면 html 렌더 단계에서 block-permission scrub 이
    적용된다.
    """
    import weasyprint  # type: ignore[import-untyped]

    options = RenderOptions(
        inline_images=False,  # PDF 는 외부 URL 도 fetch 할 수 있다.
        katex_cdn=False,
        mermaid_cdn=False,
    )
    html = render_namuwiki_html(
        content, options=options, requester_role=requester_role
    )
    return weasyprint.HTML(string=html).write_pdf()
