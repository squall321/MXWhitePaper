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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
