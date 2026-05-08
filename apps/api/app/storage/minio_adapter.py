"""MinIO/S3 client wrapper.

내부 통신은 MINIO_ENDPOINT (e.g. http://minio:9000), 클라이언트가 직접
접근하는 presigned URL 은 MINIO_PUBLIC_ENDPOINT 로 발급한다.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import boto3
from botocore.client import Config

from app.core.config import get_settings


def _make_client(*, endpoint_url: str) -> Any:
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        region_name="us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


@lru_cache
def internal_client() -> Any:
    """API ↔ MinIO 직접 통신용 (서버 내부) — get_object/put_object 등."""
    return _make_client(endpoint_url=get_settings().minio_endpoint)


@lru_cache
def public_client() -> Any:
    """클라이언트가 직접 호출할 presigned URL 발급용."""
    return _make_client(endpoint_url=get_settings().minio_public_endpoint)


def public_url(bucket: str, key: str) -> str:
    """Anonymous-readable bucket 의 객체에 대한 직접 URL.

    `<MINIO_PUBLIC_ENDPOINT>/<bucket>/<key>` 형태. presigned 가 아니므로 만료 없음.
    """
    base = get_settings().minio_public_endpoint.rstrip("/")
    return f"{base}/{bucket}/{key}"


def reset_clients_for_tests() -> None:
    """테스트에서 settings 변경 후 캐시 초기화."""
    internal_client.cache_clear()
    public_client.cache_clear()
