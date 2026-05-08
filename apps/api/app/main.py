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
from .routers.admin import router as admin_router
from .routers.analytics import router as analytics_router
from .routers.auth import router as auth_router
from .routers.comments import router_doc as comments_doc_router
from .routers.comments import router_one as comments_one_router
from .routers.documents import router as documents_router
from .routers.exports import router as exports_router
from .routers.files import router as files_router
from .routers.glossary import router as glossary_router
from .routers.imports import router as imports_router
from .routers.links_graph import router as links_graph_router
from .routers.orgs import router as orgs_router
from .routers.search import router as search_router
from .routers.tags import router as tags_router
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
        "name": "files",
        "description": "일반 파일 첨부 업로드 — presigned PUT + finalize + 1일 GET.",
    },
    {
        "name": "imports",
        "description": (
            "Word(.docx) 가져오기. 멀티파트 업로드 → DocumentJSON v1.0 변환 → "
            "FE 가 받은 결과를 별도로 POST /documents 로 영구화."
        ),
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
    {
        "name": "admin",
        "description": "관리자 대시보드 — 유저/감사/헬스/유지보수.",
    },
    {
        "name": "analytics",
        "description": "사용량 분석 — MAU/일별 활동/탑 검색/탑 조회 문서.",
    },
    {
        "name": "comments",
        "description": (
            "문서/섹션/블록 단위 댓글. 작성자/admin 만 수정·삭제 (soft delete) 가능."
        ),
    },
    {
        "name": "links",
        "description": "위키 링크 그래프 — BFS 그래프 / 전역 그래프.",
    },
    {
        "name": "exports",
        "description": (
            "문서 내보내기 — Markdown(GFM) / PDF(WeasyPrint). "
            "HTML 은 /api/v1/documents/{slug}/export.html 에서 직접 다운로드."
        ),
    },
    {
        "name": "tags",
        "description": (
            "태그 자동완성 + 태그 매니저. metadata.tags 를 집계해 prefix 검색 + count 를 제공하고, "
            "rename/delete 로 모든 문서의 metadata.tags 를 일괄 갱신한다."
        ),
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
    # Sprint 7 — generic file upload pipeline (FileBlock attachments)
    app.include_router(files_router)
    # Sprint 7+ — Word .docx import → DocumentJSON
    app.include_router(imports_router)
    # Sprint 6 — auth, search, glossary, widgets
    app.include_router(auth_router)
    app.include_router(search_router)
    app.include_router(glossary_router)
    app.include_router(widgets_router)
    # Polish D — owner 자동완성용 유저 검색
    app.include_router(users_router)
    # Tier 2D — admin dashboard + usage analytics
    app.include_router(admin_router)
    app.include_router(analytics_router)
    # Tier 2C — comments workflow + wiki link graph
    app.include_router(comments_doc_router)
    app.include_router(comments_one_router)
    app.include_router(links_graph_router)
    # Markdown / PDF export (HTML export 는 documents 라우터에 인라인)
    app.include_router(exports_router)
    # 태그 자동완성 + 태그 매니저
    app.include_router(tags_router)

    return app


app = create_app()
