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
from .routers.activity import router as activity_router
from .routers.admin import router as admin_router
from .routers.ai import router as ai_router
from .routers.analytics import router as analytics_router
from .routers.approvals import router as approvals_router
from .routers.auth import router as auth_router
from .routers.bookmarks import router as bookmarks_router
from .routers.comments import router_doc as comments_doc_router
from .routers.comments import router_one as comments_one_router
from .routers.documents import router as documents_router
from .routers.exports import router as exports_router
from .routers.files import router as files_router
from .routers.glossary import router as glossary_router
from .routers.imports import router as imports_router
from .routers.links_graph import router as links_graph_router
from .routers.notifications import router as notifications_router
from .routers.orgs import router as orgs_router
from .routers.search import router as search_router
from .routers.series import router as series_router
from .routers.sharing import router as sharing_router
from .routers.snippets import router as snippets_router
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
            "문서/섹션/블록 단위 댓글. 작성자/admin 만 수정·삭제 (soft delete) 가능. "
            "parent_id 로 답글 트리(최대 깊이 3)를 형성하고, mention_user_ids 로 "
            "멘션 시 notifications 테이블에 row 가 INSERT 된다."
        ),
    },
    {
        "name": "notifications",
        "description": "BE 푸시 알림 — 멘션·답글 등. unread 카운트 + 읽음 처리.",
    },
    {
        "name": "bookmarks",
        "description": (
            "서버 영속 책갈피 + 열람 기록. 폴더 단위 그룹핑, 메모, 누적 read_seconds."
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
    {
        "name": "ai",
        "description": (
            "AI 보조 훅 — 요약/번역/다듬기/이어쓰기/제목 자동생성. "
            "현재는 placeholder 응답이며, `AI_ENABLED=true` + LLM 키 설정 후 활성화된다."
        ),
    },
    {
        "name": "sharing",
        "description": (
            "공개 공유 링크 — `POST /documents/{slug}/share` 로 토큰을 생성하면 "
            "`/share/{token}` 가 인증 없이 문서를 읽도록 열린다. 만료일/비밀번호/revoke 지원."
        ),
    },
    {
        "name": "approvals",
        "description": (
            "문서 승인 워크플로우 — draft → in_review → approved → published. "
            "리뷰어 추가/제거, 결정 제출(승인/반려/수정요청), 상태 전이 및 "
            "내 리뷰 요청 목록(/me/reviews). 리뷰어 추가 시 `review_request`, "
            "결정 제출 시 `review_decision` 알림이 생성된다."
        ),
    },
    {
        "name": "activity",
        "description": (
            "활동 피드 — 편집/댓글/공유링크/책갈피/리뷰/스니펫 같은 다양한 이벤트를 "
            "출처에서 모아 최신순으로 반환한다. ?kind=, ?since=, ?limit= 으로 필터링."
        ),
    },
    {
        "name": "snippets",
        "description": (
            "재사용 가능한 블록 라이브러리 — 사용자가 N개 블록을 묶어 저장하고 "
            "다른 문서에 붙여넣는다. scope=private|team|org 로 공유 범위 조절. "
            "팀 스코프는 users.team_id 기준 — team_id 가 없으면 팀 스니펫이 보이지 않는다."
        ),
    },
    {
        "name": "series",
        "description": (
            "문서 시리즈(책 / 시리즈) — N개 문서를 묶어 순서를 부여하고 "
            "리더가 prev/next 로 탐색할 수 있게 한다. 문서 단건 호출 시 "
            "GET /documents/{slug}/series 로 이웃(prev/next) 까지 함께 회신."
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
    # 멘션 등 BE 푸시 알림
    app.include_router(notifications_router)
    # Bookmarks + reads (server-persisted reading list)
    app.include_router(bookmarks_router)
    # Markdown / PDF export (HTML export 는 documents 라우터에 인라인)
    app.include_router(exports_router)
    # 태그 자동완성 + 태그 매니저
    app.include_router(tags_router)
    # AI 보조 훅 — placeholder 응답 (실제 LLM 호출은 추후 작업)
    app.include_router(ai_router)
    # 재사용 블록 라이브러리 (스니펫)
    app.include_router(snippets_router)
    # 공개 공유 링크 — /share/{token} 은 인증 미적용
    app.include_router(sharing_router)
    # 승인 워크플로우 — 리뷰어 + 상태 전이
    app.include_router(approvals_router)
    # 문서 시리즈(책) — prev/next navigation
    app.include_router(series_router)
    # 활동 피드 — 다중 출처 집계
    app.include_router(activity_router)

    return app


app = create_app()
