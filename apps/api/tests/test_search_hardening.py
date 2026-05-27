"""검색 hardening MEDIUM (M1 + M2).

M1 — 한국어 부분 매칭 (Meilisearch native via charabia)
  Meilisearch 1.10 의 charabia 토크나이저가 CJK 를 음절 단위로 토큰화하므로
  "사업부" 검색이 "MX사업부" 를 매칭한다. 별도 사전 토큰화 없이도 동작 — 본
  사이클은 그 사실을 회귀 가드로 박제 (live Meili 필요, 부재시 skip).

M2 — reindex_meili 의 fine-grained retry
  Meilisearch HTTP 5xx / 통신 timeout 에 대해 0.5s, 1s exponential backoff 로
  최대 2회 재시도. 4xx (auth/payload) 는 재시도 안 함 (의미 없음). 외부의
  H9 `_run_with_retry` 와 중첩되지만, 외부는 1s backoff 만이고 내부는 transient
  network blip 만 잡으므로 책임이 다르다.
"""
from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

import meilisearch.errors as _meili_errors
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.search import meili_indexer


# ── M1 ──────────────────────────────────────────────────────────────
@pytest.fixture
def _meili_required() -> None:
    if os.environ.get("MXWP_SKIP_MEILI") == "1":
        pytest.skip("MXWP_SKIP_MEILI is set")


@pytest.mark.asyncio
async def test_korean_partial_match_works_natively(_meili_required: None) -> None:
    """Meilisearch 의 charabia 가 한국어를 음절 토큰화하므로 "사업부" 검색이
    "MX사업부" 를 매칭한다. 이 테스트는 prod index 에 임시 doc 을 push 한 뒤
    검색하고 정리한다.
    """
    meili_indexer.ensure_index()
    cli = meili_indexer.get_client()
    idx = cli.index(meili_indexer.INDEX_UID)

    probe_id = "probe-ko-partial-match-9f4a3e21"
    flat = {
        "id": probe_id,
        "slug": probe_id,
        "title": "MX사업부 운영 가이드",
        "title_tokens": "MX사업부 운영 가이드",
        "summary": "",
        "section_titles": "",
        "section_titles_tokens": "",
        "body_text": "본 문서는 MX사업부 의 확인 항목을 설명한다",
        "image_text": "",
        "tags": [],
        "updated_at": "2026-01-01T00:00:00",
        "part_slug": None,
        "team_slug": None,
        "group_slug": None,
        "division_slug": None,
        "status": "published",
        "confidentiality": "internal",
        "min_role_required": "all",
        "author": "",
    }
    task = idx.add_documents([flat], primary_key=meili_indexer.PRIMARY_KEY)
    tid = getattr(task, "task_uid", None) or (
        task.get("taskUid") if isinstance(task, dict) else None
    )
    if tid is not None:
        cli.wait_for_task(tid, timeout_in_ms=10000)

    try:
        for q in ("사업부", "MX사", "확인 항목"):
            res = meili_indexer.search(q=q, limit=20)
            hits = res.get("hits", [])
            ids = [h.get("id") for h in hits]
            assert probe_id in ids, (
                f"Korean partial match regressed for q={q!r}: probe doc not in {ids}"
            )
    finally:
        idx.delete_document(probe_id)


# ── M2: helper unit tests (no live Meili needed) ───────────────────────
def _make_api_error(status: int) -> _meili_errors.MeilisearchApiError:
    """Create a MeilisearchApiError with the given HTTP status code.

    The real constructor reads from a `requests.Response`, but the only
    attribute the retry helper checks is `status_code`. Use ``__new__`` to
    sidestep ``__init__`` and set fields manually.
    """
    err = _meili_errors.MeilisearchApiError.__new__(_meili_errors.MeilisearchApiError)
    err.status_code = status
    err.message = f"HTTP {status}"
    err.code = None
    err.link = None
    err.type = None
    # set the Exception args so str(err) works
    Exception.__init__(err, err.message)
    return err


def test_is_transient_meili_error_classifies_correctly() -> None:
    # timeout → transient
    assert meili_indexer._is_transient_meili_error(
        _meili_errors.MeilisearchTimeoutError("timeout")
    )
    # communication → transient
    assert meili_indexer._is_transient_meili_error(
        _meili_errors.MeilisearchCommunicationError("conn")
    )
    # 5xx → transient
    assert meili_indexer._is_transient_meili_error(_make_api_error(500))
    assert meili_indexer._is_transient_meili_error(_make_api_error(502))
    # 4xx → NOT transient (auth / payload)
    assert not meili_indexer._is_transient_meili_error(_make_api_error(401))
    assert not meili_indexer._is_transient_meili_error(_make_api_error(404))
    # generic exception → NOT transient (surface to caller)
    assert not meili_indexer._is_transient_meili_error(RuntimeError("boom"))


def test_call_meili_with_retry_succeeds_after_one_transient_failure() -> None:
    """첫 시도가 timeout 으로 실패해도 두 번째 시도가 성공하면 결과적으로 OK."""
    calls = {"n": 0}

    def flaky() -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            raise _meili_errors.MeilisearchTimeoutError("first attempt times out")
        return "ok"

    # sleep 을 monkey-patch 해서 실제 backoff 대기 없이 즉시 진행
    with patch.object(meili_indexer.time, "sleep") as fake_sleep:
        result = meili_indexer._call_meili_with_retry("test", flaky)

    assert result == "ok"
    assert calls["n"] == 2
    # 첫 backoff = 0.5s
    fake_sleep.assert_called_once_with(0.5)


def test_call_meili_with_retry_gives_up_after_max_attempts() -> None:
    """3회 모두 transient 실패면 마지막 예외를 re-raise."""
    calls = {"n": 0}

    def always_fails() -> None:
        calls["n"] += 1
        raise _meili_errors.MeilisearchCommunicationError("network down")

    with patch.object(meili_indexer.time, "sleep") as fake_sleep:
        with pytest.raises(_meili_errors.MeilisearchCommunicationError):
            meili_indexer._call_meili_with_retry("test", always_fails)

    # initial + 2 retries = 3 total
    assert calls["n"] == 3
    # 두 번의 backoff (0.5s, 1.0s)
    assert [c.args for c in fake_sleep.call_args_list] == [(0.5,), (1.0,)]


def test_call_meili_with_retry_does_not_retry_on_4xx() -> None:
    """auth/payload 같은 4xx 는 retry 해봐야 헛수고 — 즉시 raise."""
    calls = {"n": 0}

    def auth_failure() -> None:
        calls["n"] += 1
        raise _make_api_error(401)

    with pytest.raises(_meili_errors.MeilisearchApiError):
        meili_indexer._call_meili_with_retry("test", auth_failure)

    assert calls["n"] == 1


def test_delete_document_retries_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_document 가 transient 한 번 후 성공해도 최종 True 반환."""
    calls = {"n": 0}

    class _FakeIdx:
        def delete_document(self, doc_id: str) -> None:
            calls["n"] += 1
            if calls["n"] == 1:
                raise _meili_errors.MeilisearchTimeoutError("flaky")

    class _FakeCli:
        def index(self, _uid: str) -> _FakeIdx:
            return _FakeIdx()

    monkeypatch.setattr(meili_indexer, "get_client", lambda: _FakeCli())
    monkeypatch.setattr(meili_indexer.time, "sleep", lambda _s: None)

    ok = meili_indexer.delete_document("any-id")
    assert ok is True
    assert calls["n"] == 2


def test_delete_document_returns_false_after_persistent_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeIdx:
        def delete_document(self, doc_id: str) -> None:
            raise _meili_errors.MeilisearchCommunicationError("down")

    class _FakeCli:
        def index(self, _uid: str) -> _FakeIdx:
            return _FakeIdx()

    monkeypatch.setattr(meili_indexer, "get_client", lambda: _FakeCli())
    monkeypatch.setattr(meili_indexer.time, "sleep", lambda _s: None)

    ok = meili_indexer.delete_document("any-id")
    assert ok is False


@pytest.mark.asyncio
async def test_upsert_document_retries_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """upsert_document 가 transient 한 번 후 성공해도 최종 True 반환."""
    fake_flat = {"id": "x", "slug": "x", "title": "t"}

    async def fake_fetch(_s: Any, _id: str) -> dict[str, Any]:
        return fake_flat

    monkeypatch.setattr(meili_indexer, "_fetch_flat_row", fake_fetch)

    calls = {"n": 0}

    class _FakeIdx:
        def add_documents(self, *_a: Any, **_kw: Any) -> None:
            calls["n"] += 1
            if calls["n"] == 1:
                raise _meili_errors.MeilisearchTimeoutError("first")

    class _FakeCli:
        def index(self, _uid: str) -> _FakeIdx:
            return _FakeIdx()

    monkeypatch.setattr(meili_indexer, "get_client", lambda: _FakeCli())
    monkeypatch.setattr(meili_indexer.time, "sleep", lambda _s: None)

    ok = await meili_indexer.upsert_document(None, "any-id")  # type: ignore[arg-type]
    assert ok is True
    assert calls["n"] == 2
