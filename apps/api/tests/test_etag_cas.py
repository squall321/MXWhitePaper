"""ETag 낙관적잠금 원자화 — update_document 의 version-CAS 회귀 테스트.

적대적 검증에서 발견된 HIGH 결함의 회귀 가드:
_check_etag(또는 PUT 의 If-Match 검증)와 실제 UPDATE 사이의 TOCTOU 윈도우에서
동시 쓰기가 last-writer-wins lost-update 를 일으켰다. update_document 에
expected_version CAS 를 추가해, 그 사이 version 이 바뀌었으면 None 을 반환(=412)
하도록 했다. 본 테스트는 stale expected_version 이 갱신을 거부당함을 직접 검증한다.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from app.core.db import session_scope
from app.repos import document_repo

SLUG = "month-end-closing"


@pytest.mark.asyncio
async def test_update_document_cas_rejects_stale_version() -> None:
    async with session_scope() as s:
        row = (
            await s.execute(
                text(
                    "SELECT id, version, title FROM documents "
                    "WHERE slug = :slug AND status != 'archived'"
                ),
                {"slug": SLUG},
            )
        ).first()
        assert row is not None, "seed doc must exist"
        doc_id, v0, title = str(row[0]), int(row[1]), row[2]
        body = {"_cas_probe": True}  # update_document 는 검증 안 함; 끝에 rollback

        # 올바른 expected_version → 성공 (v0+1)
        v1 = await document_repo.update_document(
            s, doc_id=doc_id, title=title, summary=None,
            content_json=body, expected_version=v0,
        )
        assert v1 == v0 + 1

        # stale expected_version(v0) → CAS 실패 → None (lost-update 차단)
        conflict = await document_repo.update_document(
            s, doc_id=doc_id, title=title, summary=None,
            content_json=body, expected_version=v0,
        )
        assert conflict is None

        # 최신 버전(v1)으로는 다시 성공
        v2 = await document_repo.update_document(
            s, doc_id=doc_id, title=title, summary=None,
            content_json=body, expected_version=v1,
        )
        assert v2 == v1 + 1

        # expected_version 미지정(레거시 호출) → 무조건 성공 (하위호환 유지)
        v3 = await document_repo.update_document(
            s, doc_id=doc_id, title=title, summary=None, content_json=body,
        )
        assert v3 == v2 + 1

        await s.rollback()  # 테스트 격리 — 시드 문서 원복
