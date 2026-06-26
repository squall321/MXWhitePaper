"""이미지 업로드 바이트 검증 — 비-이미지 바이트는 500 이 아니라 깨끗한 422.

적대적 검증에서 발견된 MED 결함의 회귀 가드:
base64 가 디코드되지만 실제 이미지가 아니면 _process_image_bytes 의
Image.open 이 미처리 예외로 HTTP 500 을 냈다. 또 from-url 경로의
_verify_is_image 는 Content-Type 만 믿고 바이트를 안 열어 같은 500 구멍이
있었다. 둘 다 ValidationFailed(=422) 로 바뀌어야 한다.
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.core.errors import ValidationFailed
from app.services.upload_service import _process_image_bytes, _verify_is_image


def _real_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 120, 200)).save(buf, format="PNG")
    return buf.getvalue()


def test_process_image_bytes_rejects_plain_text() -> None:
    with pytest.raises(ValidationFailed):
        _process_image_bytes(b"this is definitely not an image")


def test_process_image_bytes_rejects_corrupt_png() -> None:
    corrupt = b"\x89PNG\r\n\x1a\n" + b"\x00\x01\x02garbage" * 4
    with pytest.raises(ValidationFailed):
        _process_image_bytes(corrupt)


def test_process_image_bytes_accepts_real_png() -> None:
    out = _process_image_bytes(_real_png())
    assert out["width"] == 8 and out["height"] == 8
    assert out["thumb_bytes"] and out["view_bytes"] and out["orig_bytes"]


def test_verify_is_image_rejects_lying_content_type() -> None:
    # 비-이미지 바디인데 Content-Type 이 image/png 라고 거짓말 → 거부.
    with pytest.raises(ValidationFailed):
        _verify_is_image(b"<html>not an image</html>", "image/png")


def test_verify_is_image_accepts_real_png_regardless_of_header() -> None:
    mime = _verify_is_image(_real_png(), "application/octet-stream")
    assert mime == "image/png"
