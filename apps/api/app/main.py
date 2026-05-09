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
from .routers.api_tokens import router as api_tokens_router
from .routers.approvals import router as approvals_router
from .routers.audit import router as audit_router
from .routers.auth import router as auth_router
from .routers.auth_flows import router as auth_flows_router
from .routers.automation import router as automation_router
from .routers.backups import router as backups_router
from .routers.bookmarks import router as bookmarks_router
from .routers.comments import router_doc as comments_doc_router
from .routers.comments import router_one as comments_one_router
from .routers.dep_graph import router as dep_graph_router
from .routers.doc_templates import router as doc_templates_router
from .routers.documents import router as documents_router
from .routers.exports import router as exports_router
from .routers.files import router as files_router
from .routers.forms import router as forms_router
from .routers.glossary import router as glossary_router
from .routers.imports import router as imports_router
from .routers.links_graph import router as links_graph_router
from .routers.notification_prefs import router as notification_prefs_router
from .routers.notifications import router as notifications_router
from .routers.orgs import router as orgs_router
from .routers.presence import router as presence_router
from .routers.reactions import router as reactions_router
from .routers.read_receipts import router as read_receipts_router
from .routers.reminders import router as reminders_router
from .routers.retention import router as retention_router
from .routers.search import router as search_router
from .routers.series import router as series_router
from .routers.sharing import router as sharing_router
from .routers.snippets import router as snippets_router
from .routers.subscriptions import router as subscriptions_router
from .routers.tags import router as tags_router
from .routers.uploads import images_router, uploads_router
from .routers.users import router as users_router
from .routers.webhooks import router as webhooks_router
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
        "name": "notification_prefs",
        "description": (
            "알림 채널 환경설정 — kind × channel(인앱/이메일) per-user 토글. "
            "디스패처가 in_app=false 면 notifications row 를, email=false 면 "
            "이메일 발송을 각각 건너뛴다."
        ),
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
        "name": "dep-graph",
        "description": (
            "문서 의존성 그래프 — content_json 본문의 [[slug]] 위키 링크를 "
            "정규식으로 추출해 BFS 양방향 확장. depth 1~4. /orphans 는 "
            "incoming 링크 0건인 문서를 모아 admin 에게 정리 후보로 노출."
        ),
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
        "name": "doc-templates",
        "description": (
            "조직 공유 문서 템플릿 — 에디터/관리자가 DocumentJSON sections 묶음을 "
            "발행해 다른 사용자가 새 문서 베이스로 사용한다. snippets 와 동일한 "
            "scope=private|team|org 정책. POST /:slug/use 로 새 문서를 즉시 생성한다."
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
    {
        "name": "presence",
        "description": (
            "실시간 프리젠스(누가 지금 이 문서를 보고 있는가). 메모리 기반 "
            "레지스트리로, heartbeat(10초 간격) 가 30초 이상 끊기면 "
            "자동으로 제거된다. SSE 스트림은 5초마다 현재 명단을 푸시."
        ),
    },
    {
        "name": "webhooks",
        "description": (
            "Outgoing webhook integrations — Slack/Discord/Teams/Linear 등 외부 도구로 "
            "문서 편집/공개/댓글/리뷰 이벤트를 푸시한다. POST 본문은 HMAC-SHA256 으로 "
            "서명되어 X-MXWP-Signature 헤더에 들어간다."
        ),
    },
    {
        "name": "backups",
        "description": (
            "예약 백업 + 즉시 백업. 일정(daily/weekly/monthly) 단위로 모든 문서를 "
            "선택한 포맷(json/html/md/docx/pptx) 으로 렌더해 zip 으로 묶어 "
            "MinIO 에 적재. asyncio in-process 스케줄러 — 단일 replica 한정."
        ),
    },
    {
        "name": "reactions",
        "description": (
            "이모지 반응 — 문서 또는 블록에 5종 이모지(👍 ❤️ 🤔 🙏 🎉)를 토글한다. "
            "댓글과 별개의 가벼운 시그널이며, 작성자에게 `reaction_added` 알림이 INSERT 된다."
        ),
    },
    {
        "name": "read-receipts",
        "description": (
            "읽음 확인 — `document_reads`(implicit, heartbeat 누적) 와 "
            "`read_acks`(explicit `확인했어요` 버튼) 를 조인해 작성자/리뷰어에게 "
            "독자 명단을 노출한다. ack 는 idempotent (재호출시 시간 + comment 갱신)."
        ),
    },
    {
        "name": "subscriptions",
        "description": (
            "문서 팔로우 + 다이제스트. 구독 시 doc_edited / comment_added / "
            "review_decided / doc_published 알림을 받는다. cadence=instant 면 "
            "즉시 알림, daily/weekly 이면 pending_digest_items 에 적재해 "
            "in-process digest_runner 가 묶어 한 번에 발송."
        ),
    },
    {
        "name": "api_tokens",
        "description": (
            "개인 API 토큰 (Personal Access Token) — 스크립트/CI 가 사용자 본인의 "
            "JWT 없이 API 를 호출할 때 사용. 토큰 형식 `mxwp_<26자 base32>`. "
            "평문은 발급/회전 직후 1회만 노출되고 이후 모든 read 응답에서는 "
            "prefix 만 보인다. revoked_at / expires_at 으로 폐기·만료 관리."
        ),
    },
    {
        "name": "automation",
        "description": (
            "워크플로우 자동화 규칙 (Cycle 0025) — 트리거(이벤트) × 액션(웹훅/알림/"
            "태그/전이/이메일) 을 admin 이 조합해 등록한다. 디스패처는 doc_published / "
            "doc_archived / review_decided / status_transition / comment_added / "
            "tag_added 6종 이벤트를 watch 하며, trigger_filter 의 key=value 동등 "
            "매칭으로 발화한다."
        ),
    },
    {
        "name": "retention",
        "description": (
            "문서 보존 정책 (Cycle 0027) — 시간 기반 자동 정리. "
            "scope_filter(part/tag/status/owner) 와 trigger_age_days × trigger_field "
            "(updated_at/last_read_at/created_at) 으로 매칭되는 문서에 "
            "archive / notify_owner / transition 액션을 적용한다. "
            "in-process ticker 가 1시간 간격으로 due 정책을 실행한다 — single-replica."
        ),
    },
    {
        "name": "reminders",
        "description": (
            "시간 기반 리마인더 (Cycle 0028) — 문서별로 'N분/일/주 뒤에 알려줘' 를 "
            "예약한다. POST /documents/{slug}/reminders 로 생성, GET /me/reminders 로 "
            "본인 목록, PATCH/DELETE 로 수정/삭제. asyncio in-process ticker 가 60초 "
            "간격으로 due 인 행을 찾아 notifications(kind='reminder') 로 fan-out 한다."
        ),
    },
]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Cycle 0015 — start the in-process backup ticker if enabled. The ticker
    # ticks every 60s and fires due `backup_schedules`. Single-replica only —
    # production multi-replica should swap for Celery beat / k8s CronJob.
    import asyncio as _asyncio

    settings = get_settings()
    task: _asyncio.Task[None] | None = None
    pruner_task: _asyncio.Task[None] | None = None
    digest_task: _asyncio.Task[None] | None = None
    retention_task: _asyncio.Task[None] | None = None
    reminder_task: _asyncio.Task[None] | None = None
    if settings.backup_enabled:
        from .services.backup_runner import backup_ticker

        task = _asyncio.create_task(backup_ticker(), name="mxwp-backup-ticker")

    # Cycle 0016 — daily prune of anchor_samples (>30d old). Same single-
    # replica caveat as the backup ticker.
    from .services.analytics_pruner import analytics_pruner

    pruner_task = _asyncio.create_task(
        analytics_pruner(), name="mxwp-analytics-pruner",
    )

    # Cycle 0018 — subscription digest runner. Single-replica.
    if getattr(settings, "subscription_digest_enabled", False):
        from .services.digest_runner import digest_ticker

        digest_task = _asyncio.create_task(
            digest_ticker(), name="mxwp-digest-ticker",
        )

    # Cycle 0027 — retention policy ticker. Single-replica. 1-hour cadence.
    from .services.retention_runner import retention_ticker

    retention_task = _asyncio.create_task(
        retention_ticker(), name="mxwp-retention-ticker",
    )

    # Cycle 0028 — time-based reminder runner. Single-replica.
    if getattr(settings, "reminder_runner_enabled", True):
        from .services.reminder_runner import reminder_ticker

        reminder_task = _asyncio.create_task(
            reminder_ticker(), name="mxwp-reminder-ticker",
        )
    try:
        yield
    finally:
        for t in (
            task,
            pruner_task,
            digest_task,
            retention_task,
            reminder_task,
        ):
            if t is None:
                continue
            t.cancel()
            try:
                await t
            except (BaseException,):  # noqa: BLE001 — cancel is expected
                pass


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
    # Cycle 0026 — email verification + password reset flows.
    app.include_router(auth_flows_router)
    app.include_router(search_router)
    app.include_router(glossary_router)
    app.include_router(widgets_router)
    # Polish D — owner 자동완성용 유저 검색
    app.include_router(users_router)
    # Tier 2D — admin dashboard + usage analytics
    app.include_router(admin_router)
    app.include_router(analytics_router)
    # Audit log viewer — admin paginated/filter/CSV
    app.include_router(audit_router)
    # Tier 2C — comments workflow + wiki link graph
    app.include_router(comments_doc_router)
    app.include_router(comments_one_router)
    app.include_router(links_graph_router)
    # Cycle 7 — dep-graph (content_json 본문 기반 의존성 그래프 + orphans).
    app.include_router(dep_graph_router)
    # 멘션 등 BE 푸시 알림
    app.include_router(notifications_router)
    # Cycle 0019 — per-event-per-channel notification preferences.
    app.include_router(notification_prefs_router)
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
    # 조직 공유 문서 템플릿 (per-doc, 0020)
    app.include_router(doc_templates_router)
    # 공개 공유 링크 — /share/{token} 은 인증 미적용
    app.include_router(sharing_router)
    # 승인 워크플로우 — 리뷰어 + 상태 전이
    app.include_router(approvals_router)
    # 문서 시리즈(책) — prev/next navigation
    app.include_router(series_router)
    # 활동 피드 — 다중 출처 집계
    app.include_router(activity_router)
    # 실시간 프리젠스 — heartbeat + SSE
    app.include_router(presence_router)
    # 임베디드 폼/설문 블록 응답
    app.include_router(forms_router)
    # Outgoing webhook integrations (Slack/Discord/...).
    app.include_router(webhooks_router)
    # Cycle 0015 — scheduled backups + ad-hoc run-now (admin).
    app.include_router(backups_router)
    # Cycle 0018 — document subscriptions + digest.
    app.include_router(subscriptions_router)
    # Cycle 0021 — emoji reactions on docs and blocks.
    app.include_router(reactions_router)
    # Cycle 0023 — read receipts (explicit acks + implicit reads merge).
    app.include_router(read_receipts_router)
    # Cycle 0023 — personal API tokens (`mxwp_…` bearer support).
    app.include_router(api_tokens_router)
    # Cycle 0025 — workflow automation rules (admin-only CRUD + dispatch).
    app.include_router(automation_router)
    # Cycle 0027 — time-based retention policies (admin-only CRUD + ticker).
    app.include_router(retention_router)
    # Cycle 0028 — time-based reminders (CRUD + asyncio runner).
    app.include_router(reminders_router)

    return app


app = create_app()
