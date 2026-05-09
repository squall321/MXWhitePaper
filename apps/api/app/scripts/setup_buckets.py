"""Bucket 생성 + 익명 read 정책을 idempotent 하게 적용.

`mxwp-images` 버킷은 anonymous download (public read) 정책을 갖는다.
`infra/scripts/start.sh` 의 `mc` 호출이 이미 동일 작업을 수행하지만,
독립 실행 가능한 백업 경로로 두고 운영 진단용으로도 사용한다.
"""
from __future__ import annotations

import json
import sys

from app.core.config import get_settings
from app.storage import minio_adapter


def _public_read_policy(bucket: str) -> dict:
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"AWS": ["*"]},
                "Action": ["s3:GetObject"],
                "Resource": [f"arn:aws:s3:::{bucket}/*"],
            }
        ],
    }


def main() -> int:
    settings = get_settings()
    cli = minio_adapter.internal_client()

    for bucket in (
        settings.minio_bucket_images,
        settings.minio_bucket_files,
        settings.minio_bucket_backups,
    ):
        try:
            cli.head_bucket(Bucket=bucket)
            print(f"✓ bucket exists: {bucket}")
        except Exception:
            try:
                cli.create_bucket(Bucket=bucket)
                print(f"✓ bucket created: {bucket}")
            except Exception as e:
                print(f"✗ failed to create bucket {bucket}: {e}", file=sys.stderr)
                return 1

    # images 만 anonymous read.
    images = settings.minio_bucket_images
    try:
        cli.put_bucket_policy(
            Bucket=images,
            Policy=json.dumps(_public_read_policy(images)),
        )
        print(f"✓ anonymous read policy applied: {images}")
    except Exception as e:
        print(f"✗ failed to set policy: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
