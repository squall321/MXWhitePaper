"""Centralized environment configuration via pydantic-settings."""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    app_env: str = Field(default="development")
    # 토큰 없는 요청을 admin 으로 통과시키는 폴백(core/auth.py get_current_user)의 스위치.
    # ⚠ app_env 하나에 매달아 두면 안 된다. app_env 기본값이 "development" 이고
    # .env.example 도 development 를 그대로 배포하므로, .env 를 예제에서 복사한 운영 박스는
    # 아무도 실수하지 않아도 인증이 열린 상태로 뜬다 — 실측으로 포털 공개 오리진
    # /mx-white-paper/api/v1/documents 가 로그인 없이 200 에 실데이터였다.
    # env-kit(apply-envs.sh)은 "없는 키만 추가" 라 이미 들어 있는 APP_ENV 를 고치지 못한다.
    # 그래서 스위치를 따로 두고 기본을 닫는다 — 열려면 명시적으로 켜야 한다.
    allow_dev_admin_fallback: bool = Field(default=False)
    log_level: str = Field(default="info")

    # Database
    database_url: str = Field(default="postgresql+asyncpg://mxwp:mxwp_dev_password_change_me@postgres:5432/mxwp")

    # Meilisearch
    meili_host: str = Field(default="http://meilisearch:7700")
    meili_master_key: str = Field(default="meili_dev_master_key_change_me")

    # MinIO / S3
    minio_endpoint: str = Field(default="http://minio:9000")
    minio_public_endpoint: str = Field(default="http://localhost:9000")
    minio_access_key: str = Field(default="mxwp_minio_admin")
    minio_secret_key: str = Field(default="mxwp_minio_admin_change_me")
    minio_bucket_images: str = Field(default="mxwp-images")
    minio_bucket_files: str = Field(default="mxwp-files")
    minio_bucket_backups: str = Field(default="mxwp-backups")
    # Empty string → reuse `minio_bucket_files` for export artifacts. Set
    # to a dedicated bucket name when you want to ACL them separately
    # (e.g. shorter retention than user uploads).
    minio_bucket_exports: str = Field(default="")

    # JWT
    jwt_secret: str = Field(default="replace_with_a_long_random_string_at_least_32_chars")
    jwt_access_ttl_seconds: int = Field(default=3600)
    jwt_refresh_ttl_seconds: int = Field(default=604800)
    jwt_algorithm: str = Field(default="HS256")
    # Refresh-cookie path. "/api/v1/auth" (tight) standalone; set "/" behind the HWAX portal so the
    # cookie is sent to /mx-white-paper/api/v1/auth/refresh (see auth.py REFRESH_COOKIE_PATH).
    refresh_cookie_path: str = Field(default="/api/v1/auth")

    # ── HWAX Portal SSO (true single sign-on) ──────────────────────────────────────────────────
    # When set, /api/v1/auth/portal-callback accepts a short-lived RS256 launch token minted by the
    # HWAX portal, verifies it against the portal's JWKS, upserts the user by email, and starts a
    # local session — so a user logged into the portal lands here logged-in (no second login).
    # Empty portal_jwks_url disables the endpoint (returns 404), keeping standalone deploys safe.
    portal_jwks_url: str = Field(default="")          # e.g. http://localhost:8723/.well-known/jwks.json
    portal_audience: str = Field(default="mx-white-paper")   # token `aud` we accept
    portal_sso_default_role: str = Field(default="editor")   # role for auto-created SSO users
    portal_sso_landing: str = Field(default="/mx-white-paper/")  # where to send the browser after login

    # CORS
    cors_origins: str = Field(default="http://localhost:5173,http://localhost:80")

    # Limits
    image_max_bytes: int = Field(default=20 * 1024 * 1024)
    image_from_url_max_bytes: int = Field(default=20 * 1024 * 1024)
    gallery_max_bytes: int = Field(default=100 * 1024 * 1024)
    file_max_bytes: int = Field(default=25 * 1024 * 1024)
    rate_limit_per_minute: int = Field(default=120)

    # Document import caps + rate limit. Tuned per format because pptx
    # decks are typically ~2-3× the size of equivalent docx reports.
    # Signup self-service: comma-separated whitelist of email domains
    # accepted by POST /auth/signup. Empty string = allow-all (dev / CI).
    # In production deployments this should be set to the corp domain(s).
    signup_allowed_email_domains: str = Field(default="")

    docx_import_max_bytes: int = Field(default=30 * 1024 * 1024)
    pptx_import_max_bytes: int = Field(default=50 * 1024 * 1024)
    xlsx_import_max_bytes: int = Field(default=20 * 1024 * 1024)
    pdf_import_max_bytes: int = Field(default=30 * 1024 * 1024)
    csv_import_max_bytes: int = Field(default=5 * 1024 * 1024)
    csv_import_max_rows: int = Field(default=500)
    import_rate_limit_per_minute: int = Field(default=5)

    # Default metadata applied to documents created via import paths
    # (docx/pptx/csv) when the source has no equivalent field. Tenants
    # operating on a different default confidentiality posture override
    # via env.
    import_default_division: str = Field(default="MX")
    import_default_confidentiality: str = Field(default="internal")

    # AI assist hooks (요약/번역/다듬기/이어쓰기/제목 자동생성).
    # 기본 false — 활성화하면 placeholder 응답이 흘러나간다. 실제 LLM 호출은
    # 추후 OPENAI_API_KEY / ANTHROPIC_API_KEY 가 잡혀야 의미가 있다.
    ai_enabled: bool = Field(default=False)

    # 대화형 채팅 (agentic 저작 + 코퍼스 검색) — 메인 페이지 백엔드.
    # LLM 은 config/env 로 주소만 잡고 미설정/도달 실패 시 mock 폴백한다
    # (HWAX 포털 플레이북 §8 + triple_extractor 와 동일 정책). vLLM 은 OpenAI
    # 호환 엔드포인트이므로 llm_backend=openai + base_url + model 로 연결한다.
    chat_enabled: bool = Field(default=True)
    llm_backend: str = Field(default="mock")  # mock | openai(=vLLM)
    llm_base_url: str = Field(default="")     # 예: http://<ip>:<port>/v1
    llm_model: str = Field(default="")        # served-model 이름
    llm_api_key: str = Field(default="")      # vLLM 은 보통 불필요(더미 허용)

    # 0015 — Scheduled backups (asyncio in-process ticker).
    # 끄면 lifespan 에서 ticker 가 시작되지 않고 tick_once() 도 즉시 0 을 반환.
    # 라우터는 켜둔 채로 남겨도 무방 — run-now 호출은 여전히 동작.
    backup_enabled: bool = Field(default=True)

    # 0018 — Subscription digest runner (asyncio in-process ticker). 라우터/
    # dispatcher 는 항상 동작 — 이 플래그는 runner ticker 만 게이트한다.
    subscription_digest_enabled: bool = Field(default=True)

    # 0028 — Reminder runner (asyncio in-process ticker, every 60s). CRUD
    # 라우터는 항상 켜둔다 — 이 플래그는 ticker 만 게이트한다.
    reminder_runner_enabled: bool = Field(default=True)

    # 0029 — Automation cron ticker (asyncio in-process, every 30s). 사라
    # 지면 시간 기반 자동화 규칙이 발화하지 않는다 — 이벤트 기반 규칙은 영향 없음.
    automation_cron_enabled: bool = Field(default=True)

    # 0032 — Audit log retention pruner (asyncio in-process ticker, daily).
    # CRUD 라우터는 항상 켜둔다 — 이 플래그는 ticker 만 게이트한다. 끄면
    # tick_once() 가 즉시 0 을 반환해서 자동 prune 이 멈추지만 admin 의
    # POST /admin/audit-retention/prune-now 는 여전히 동작한다.
    audit_retention_enabled: bool = Field(default=True)

    # B-1 (2026-06-08) — housekeeping ticker. images_pending TTL sweep +
    # document_versions retention compaction 을 in-process 로 돌린다 (기존
    # 7 ticker 와 같은 패턴). 끄면 CLI (apps/api/app/scripts/sweep_pending.py
    # / compact_versions.py) 가 여전히 동작한다.
    maintenance_runner_enabled: bool = Field(default=True)

    # ── SMTP / Email (cycle: email integration) ──────────────────────
    # When `email_enabled=False` the email service logs to stdout under a
    # "[EMAIL CONSOLE FALLBACK]" prefix so dev never depends on a real MTA.
    # When True the stdlib smtplib is used with the credentials below.
    smtp_host: str | None = Field(default=None)
    smtp_port: int = Field(default=587)
    smtp_user: str | None = Field(default=None)
    smtp_password: str | None = Field(default=None)
    smtp_from: str = Field(default="noreply@mxwhitepaper.local")
    email_enabled: bool = Field(default=False)

    # 0026 — Public base URL used to build email-verify / password-reset
    # links sent in email bodies. Defaults to the dev web container.
    web_base_url: str = Field(default="http://localhost:5173")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
