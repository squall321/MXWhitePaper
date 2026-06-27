"""from-url SSRF redirect-bypass 방어 실증 — _fetch_remote_bytes 회귀 테스트.

적대적 검증에서 UNCERTAIN 으로 남았던 항목(샌드박스 egress 차단으로 미실측):
공인 첫 hop 이 내부 주소(메타데이터/loopback)로 302 redirect 하면 그 target 이
재검증되어 차단되는가. opener 를 mock 해 네트워크 없이 redirect 를 주입하고,
첫 hop 은 공인 IP 리터럴(DNS 불필요)로 두어 per-hop 재검증을 직접 확인한다.
"""
from __future__ import annotations

from email.message import Message
from urllib.error import HTTPError

import pytest

from app.core.errors import ValidationFailed
from app.services import upload_service as us

_PUBLIC_FIRST_HOP = "http://93.184.216.34/"  # 공인 IP 리터럴 (DNS 불필요)


def _redirect_opener(location: str):
    hdrs = Message()
    hdrs["Location"] = location

    class _FakeOpener:
        def open(self, req, timeout=None):  # noqa: A003
            raise HTTPError(req.full_url, 302, "Found", hdrs, None)

    return lambda *a, **k: _FakeOpener()


@pytest.mark.parametrize(
    "target",
    [
        "http://169.254.169.254/latest/meta-data/",  # 클라우드 메타데이터
        "http://127.0.0.1:8800/",                     # loopback
        "http://10.0.0.5/",                           # 사설
        "http://[fc00::1]/",                          # ULA
    ],
)
def test_redirect_to_internal_blocked(monkeypatch, target: str) -> None:
    monkeypatch.setattr(us.urllib.request, "build_opener", _redirect_opener(target))
    with pytest.raises(ValidationFailed) as ei:
        us._fetch_remote_bytes(_PUBLIC_FIRST_HOP, max_bytes=1_000)
    assert "private or reserved" in str(ei.value)


def test_direct_internal_blocked_before_fetch() -> None:
    # redirect 없이도 내부 주소 직접 요청은 첫 hop 에서 차단 (네트워크 도달 전).
    with pytest.raises(ValidationFailed):
        us._fetch_remote_bytes("http://169.254.169.254/", max_bytes=1_000)
