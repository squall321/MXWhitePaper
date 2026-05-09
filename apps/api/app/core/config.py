"""Centralized environment configuration via pydantic-settings."""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    app_env: str = Field(default="development")
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

    # JWT
    jwt_secret: str = Field(default="replace_with_a_long_random_string_at_least_32_chars")
    jwt_access_ttl_seconds: int = Field(default=3600)
    jwt_refresh_ttl_seconds: int = Field(default=604800)
    jwt_algorithm: str = Field(default="HS256")

    # CORS
    cors_origins: str = Field(default="http://localhost:5173,http://localhost:80")

    # Limits
    image_max_bytes: int = Field(default=20 * 1024 * 1024)
    gallery_max_bytes: int = Field(default=100 * 1024 * 1024)
    file_max_bytes: int = Field(default=25 * 1024 * 1024)
    rate_limit_per_minute: int = Field(default=120)

    # AI assist hooks (요약/번역/다듬기/이어쓰기/제목 자동생성).
    # 기본 false — 활성화하면 placeholder 응답이 흘러나간다. 실제 LLM 호출은
    # 추후 OPENAI_API_KEY / ANTHROPIC_API_KEY 가 잡혀야 의미가 있다.
    ai_enabled: bool = Field(default=False)

    # 0015 — Scheduled backups (asyncio in-process ticker).
    # 끄면 lifespan 에서 ticker 가 시작되지 않고 tick_once() 도 즉시 0 을 반환.
    # 라우터는 켜둔 채로 남겨도 무방 — run-now 호출은 여전히 동작.
    backup_enabled: bool = Field(default=True)

    # 0018 — Subscription digest runner (asyncio in-process ticker). 라우터/
    # dispatcher 는 항상 동작 — 이 플래그는 runner ticker 만 게이트한다.
    subscription_digest_enabled: bool = Field(default=True)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
