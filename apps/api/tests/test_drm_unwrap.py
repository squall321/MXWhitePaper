"""DRM ZIP-in-ZIP unwrap for docx/pptx import.

배경: 사내 DRM 솔루션이 .docx / .pptx 를 한 번 더 ZIP 으로 감싸 배포하는 경우가 있다.
업로드 시점에 unwrap 해서 진짜 office 파일을 꺼낸다 (다른 프로젝트가 다운로드 시
ZIP 으로 감싸는 트릭의 역방향).
"""
from __future__ import annotations

import io
import zipfile

from app.services.docx_import import is_docx_content, try_unwrap_drm_docx
from app.services.pptx_import import is_pptx_content, try_unwrap_drm_pptx


def _build_minimal_docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", b"<?xml version='1.0'?><Types/>")
        z.writestr("word/document.xml", b"<?xml version='1.0'?><document/>")
    return buf.getvalue()


def _build_minimal_pptx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", b"<?xml version='1.0'?><Types/>")
        z.writestr("ppt/presentation.xml", b"<?xml version='1.0'?><presentation/>")
    return buf.getvalue()


def _wrap_in_outer_zip(inner_bytes: bytes, inner_name: str) -> bytes:
    """Simulate DRM: put the real office file as one member of an outer zip."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("META.txt", b"DRM-protected payload")
        z.writestr(inner_name, inner_bytes)
    return buf.getvalue()


class TestUnwrapDocx:
    def test_normal_docx_returns_none(self):
        ok = _build_minimal_docx()
        assert is_docx_content(ok)
        # 정상 docx 는 unwrap 안 함 (None)
        assert try_unwrap_drm_docx(ok) is None

    def test_wrapped_docx_unwraps(self):
        real = _build_minimal_docx()
        wrapper = _wrap_in_outer_zip(real, "protected.docx")
        assert not is_docx_content(wrapper)
        inner = try_unwrap_drm_docx(wrapper)
        assert inner is not None
        assert is_docx_content(inner)

    def test_random_zip_returns_none(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("hello.txt", b"world")
        assert try_unwrap_drm_docx(buf.getvalue()) is None

    def test_non_zip_returns_none(self):
        assert try_unwrap_drm_docx(b"not a zip") is None
        assert try_unwrap_drm_docx(b"") is None

    def test_largest_inner_docx_wins(self):
        """Wrapper 안에 docx 가 2개면 큰 쪽 선택."""
        small = _build_minimal_docx()
        big_buf = io.BytesIO()
        with zipfile.ZipFile(big_buf, "w") as z:
            z.writestr("[Content_Types].xml", b"<?xml version='1.0'?><Types/>")
            z.writestr("word/document.xml", b"<?xml version='1.0'?><document>" + b"x" * 5000 + b"</document>")
        big = big_buf.getvalue()
        outer = io.BytesIO()
        with zipfile.ZipFile(outer, "w") as z:
            z.writestr("decoy-small.docx", small)
            z.writestr("real-large.docx", big)
        inner = try_unwrap_drm_docx(outer.getvalue())
        assert inner == big


class TestUnwrapPptx:
    def test_normal_pptx_returns_none(self):
        ok = _build_minimal_pptx()
        assert is_pptx_content(ok)
        assert try_unwrap_drm_pptx(ok) is None

    def test_wrapped_pptx_unwraps(self):
        real = _build_minimal_pptx()
        wrapper = _wrap_in_outer_zip(real, "protected.pptx")
        assert not is_pptx_content(wrapper)
        inner = try_unwrap_drm_pptx(wrapper)
        assert inner is not None
        assert is_pptx_content(inner)

    def test_docx_inside_pptx_wrapper_returns_none(self):
        """pptx wrapper 안에 docx 가 있어도 — pptx unwrap 은 안 됨 (확장자 매치 안 함)."""
        real_docx = _build_minimal_docx()
        wrapper = _wrap_in_outer_zip(real_docx, "decoy.docx")
        # pptx unwrap 시도 — .pptx 후보 없으니 None
        assert try_unwrap_drm_pptx(wrapper) is None
