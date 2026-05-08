"""FastAPI application entrypoint (Sprint 0 — health check only)."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.errors import (
    APIError,
    api_error_handler,
    envelope,
    validation_error_handler,
)
from .routers.auth import router as auth_router
from .routers.documents import router as documents_router
from .routers.glossary import router as glossary_router
from .routers.orgs import router as orgs_router
from .routers.search import router as search_router
from .routers.uploads import images_router, uploads_router
from .routers.users import router as users_router
from .routers.widgets import router as widgets_router


# Polish D — Swagger /docs 에서 각 그룹의 의미를 한국어로 요약.
TAGS_METADATA: list[dict[str, str]] = [
    {
        "name": "meta",
        "description": "헬스체크 등 메타 엔드포인트.",
    },
    {
        "name": "auth",
        "description": "이메일/비번 로그인, refresh, /me. JWT Bearer 사용.",
    },
    {
        "name": "users",
        "description": "owner/reviewer 자동완성용 유저 검색.",
    },
    {
        "name": "orgs",
        "description": (
            "조직(Division → Team → Group → Part) CRUD + 트리. "
            "모든 쓰기 호출은 audit_logs 에 기록된다."
        ),
    },
    {
        "name": "documents",
        "description": (
            "DocumentJSON v1.0 기반 문서 CRUD/PATCH. "
            "POST 한 번이면 본문/링크/태그/용어집/검색 인덱스가 모두 동기화된다. "
            "metadata.part 는 slug 또는 한글 이름 둘 다 허용 — 미해석 항목은 meta.warnings 로 회신."
        ),
    },
    {
        "name": "uploads",
        "description": "이미지 업로드 — pending → confirm → ULID/UUID 양방향 조회.",
    },
    {
        "name": "search",
        "description": "Meilisearch 기반 전체검색 + 하이라이트.",
    },
    {
        "name": "glossary",
        "description": "용어집(terms) 검색. 문서 저장 시 자동으로 동기화된다.",
    },
    {
        "name": "widgets",
        "description": "위젯 데이터 (표/차트/KPI) 엔드포인트.",
    },
]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Sprint 0 — no startup tasks yet. Sprint 6 will add Meilisearch index init etc.
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="MX White Paper API",
        version="0.1.0",
        description=(
            "MX 사업부 위키 백엔드. DocumentJSON v1.0 (`packages/shared/schemas/document.json`) "
            "을 단일 진실 공급원(SSOT) 으로 사용한다.\n\n"
            "**핵심 흐름**: `POST /api/v1/documents` 한 번으로 본문 검증 → 섹션 번호 부여 → "
            "위키링크/태그/용어집/감사로그/검색인덱스가 모두 자동 갱신된다.\n\n"
            "**Conditional write**: 본문 수정(PUT/PATCH) 은 `If-Match` 헤더 필수 (낙관적 동시성). "
            "GET 응답의 `ETag` 를 그대로 사용하면 된다."
        ),
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        openapi_tags=TAGS_METADATA,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["ETag", "Location"],
    )

    app.add_exception_handler(APIError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]

    @app.get("/api/v1/healthz", tags=["meta"])
    async def healthz() -> dict[str, object]:
        return envelope(data={"status": "ok", "env": settings.app_env})

    # Sprint 1 — orgs CRUD + tree, documents CRUD + ETag
    app.include_router(orgs_router)
    app.include_router(documents_router)
    # Sprint 5 — image upload pipeline
    app.include_router(uploads_router)
    app.include_router(images_router)
    # Sprint 6 — auth, search, glossary, widgets
    app.include_router(auth_router)
    app.include_router(search_router)
    app.include_router(glossary_router)
    app.include_router(widgets_router)
    # Polish D — owner 자동완성용 유저 검색
    app.include_router(users_router)

    return app


app = create_app()
