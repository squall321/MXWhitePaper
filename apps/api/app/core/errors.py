"""Standard API error response envelope."""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# Pydantic 에러 type → 한국어 friendly 안내. 매칭 안되면 원문 msg 사용.
_PYDANTIC_KO_MESSAGES: dict[str, str] = {
    "missing": "필수 필드가 누락되었습니다.",
    "extra_forbidden": "허용되지 않는 추가 필드입니다.",
    "string_pattern_mismatch": "문자열 형식이 규격과 다릅니다 (정규식 불일치).",
    "string_too_long": "문자열이 최대 길이를 초과했습니다.",
    "string_too_short": "문자열이 최소 길이보다 짧습니다.",
    "string_type": "문자열 타입이 필요합니다.",
    "int_type": "정수 타입이 필요합니다.",
    "list_type": "리스트(배열) 타입이 필요합니다.",
    "dict_type": "객체 타입이 필요합니다.",
    "literal_error": "허용된 값 중 하나여야 합니다.",
    "enum": "허용된 값 중 하나여야 합니다.",
    "value_error": "값이 유효하지 않습니다.",
    "url_parsing": "URL 형식이 올바르지 않습니다.",
    "json_invalid": "JSON 본문 파싱에 실패했습니다.",
    "too_long": "최대 항목 수를 초과했습니다.",
    "too_short": "최소 항목 수가 부족합니다.",
    "union_tag_invalid": "허용된 type 값이 아닙니다.",
}


def format_pydantic_errors(
    errors: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Pydantic v2 errors → 친화적 details 형식.

    각 항목: { field, code, message, expected?, got? }
    field 는 dot-path (`metadata.confidentiality`, `sections[0].subsections[0].level` 등).

    Accepts pydantic ``ErrorDetails`` TypedDict items (which structurally
    satisfy ``Mapping[str, Any]``) so both ``RequestValidationError.errors()``
    and ``ValidationError.errors()`` can be passed without casts.
    """
    out: list[dict[str, Any]] = []
    for e in errors or []:
        loc = e.get("loc") or []
        # loc 의 첫 항목이 'body' 등 wrapper 면 제거
        if loc and loc[0] in ("body", "query", "path", "header"):
            loc = list(loc[1:])
        parts: list[str] = []
        for seg in loc:
            if isinstance(seg, int):
                if parts:
                    parts[-1] = f"{parts[-1]}[{seg}]"
                else:
                    parts.append(f"[{seg}]")
            else:
                parts.append(str(seg))
        field = ".".join(parts) if parts else ""
        etype = str(e.get("type") or "")
        msg_ko = _PYDANTIC_KO_MESSAGES.get(etype) or e.get("msg") or "유효성 검증 실패"
        item: dict[str, Any] = {
            "field": field,
            "code": etype,
            "message": msg_ko,
        }
        ctx = e.get("ctx") or {}
        if "expected" in ctx:
            item["expected"] = ctx["expected"]
        if "pattern" in ctx:
            item["pattern"] = ctx["pattern"]
        if "input" in e:
            # 너무 큰 본문이 들어오는 것을 방지 — 200자 절단
            inp = e["input"]
            if isinstance(inp, str) and len(inp) > 200:
                inp = inp[:200] + "..."
            item["got"] = inp
        out.append(item)
    return out


class APIError(Exception):
    code: str = "INTERNAL"
    http_status: int = 500
    message: str = "Internal server error"

    def __init__(self, message: str | None = None, *, details: dict[str, Any] | None = None) -> None:
        if message is not None:
            self.message = message
        self.details = details or {}


class ValidationFailed(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422
    message = "Validation failed"


class NotFound(APIError):
    code = "NOT_FOUND"
    http_status = 404
    message = "Resource not found"


class Conflict(APIError):
    code = "CONFLICT"
    http_status = 409
    message = "Conflict"


class PreconditionFailed(APIError):
    code = "PRECONDITION_FAILED"
    http_status = 412
    message = "ETag mismatch"


class Unauthorized(APIError):
    code = "UNAUTHORIZED"
    http_status = 401
    message = "Unauthorized"


class Forbidden(APIError):
    code = "FORBIDDEN"
    http_status = 403
    message = "Forbidden"


class Gone(APIError):
    code = "GONE"
    http_status = 410
    message = "Resource is no longer available"


def envelope(*, data: Any | None = None, error: dict[str, Any] | None = None,
             meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"data": data, "meta": meta, "error": error}


async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    body = envelope(
        error={
            "code": exc.code,
            "http_status": exc.http_status,
            "message": exc.message,
            "details": exc.details,
        }
    )
    return JSONResponse(status_code=exc.http_status, content=body)


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    raw = exc.errors()
    friendly = format_pydantic_errors(raw)
    body = envelope(
        error={
            "code": "VALIDATION_ERROR",
            "http_status": 422,
            "message": (
                "요청 본문이 DocumentJSON v1.0 규격에 맞지 않습니다. "
                "details 의 field/message 를 확인하세요."
            ),
            "details": {"errors": friendly},
            "errors": raw,  # 디버깅용 원본 보존 (호환성)
        }
    )
    return JSONResponse(status_code=422, content=body)
