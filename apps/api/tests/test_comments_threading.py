"""Threaded comments + mentions + notifications (Tier 2C+).

검증 항목:
  1. parent_id 로 답글이 만들어지고 GET 응답의 tree 가 그것을 트리로 묶는다.
  2. mention_user_ids 가 채워지면 notifications 테이블에 row 가 INSERT 된다.
  3. tree 깊이는 3 으로 제한된다 — 4단계째 답글은 부모 밑으로 평탄화.
  4. /comments/:id/resolve 가 root 의 status 를 'resolved' 로 토글한다 (그리고
     reply 어느 쪽 id 를 보내도 root 가 갱신된다 — "resolve cascades").
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_factory
from app.main import app

SEED_SLUG = "month-end-closing"


async def _admin_user_id() -> str:
    sm = session_factory()
    async with sm() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email='admin@mx.local' LIMIT 1")
        )).first()
        assert row is not None, "admin user is missing — run seed"
        return str(row[0])


@pytest.mark.asyncio
async def test_create_reply_then_tree() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "T1 root"},
        )
        assert r1.status_code == 201, r1.text
        root_id = r1.json()["data"]["id"]

        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={
                "anchor_kind": "document",
                "body_md": "T1 reply",
                "parent_id": root_id,
            },
        )
        assert r2.status_code == 201, r2.text

        r3 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/comments")
        assert r3.status_code == 200
        body = r3.json()["data"]
        assert "tree" in body, "GET response must include the server-built tree"
        # find our root in the tree → must contain the reply.
        root = next((n for n in body["tree"] if n["id"] == root_id), None)
        assert root is not None
        assert any(child["id"] != root_id for child in root["replies"]), (
            "reply not attached to root in tree"
        )


@pytest.mark.asyncio
async def test_mention_inserts_notification() -> None:
    """멘션 대상에게 'comment_mention' notifications row 가 들어가야 한다."""
    target_uid = await _admin_user_id()
    sm = session_factory()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        before = 0
        async with sm() as s:
            before = (await s.execute(
                text("""
                    SELECT COUNT(*) FROM notifications
                    WHERE user_id = CAST(:u AS uuid) AND kind = 'comment_mention'
                """),
                {"u": target_uid},
            )).scalar_one()

        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            # 자기 자신에게 보내면 skip 되므로 X-MXWP-User 로 다른 사람을 위장한다.
            headers={"X-MXWP-User": "editor-orgadmin@mx.local"},
            json={
                "anchor_kind": "document",
                "body_md": "안녕 @admin",
                "mention_user_ids": [target_uid],
            },
        )
        assert r.status_code == 201, r.text
        cid = r.json()["data"]["id"]
        assert r.json()["data"]["mention_user_ids"] == [target_uid]

        async with sm() as s:
            after = (await s.execute(
                text("""
                    SELECT COUNT(*) FROM notifications
                    WHERE user_id = CAST(:u AS uuid) AND kind = 'comment_mention'
                """),
                {"u": target_uid},
            )).scalar_one()
            row = (await s.execute(
                text("""
                    SELECT payload->>'comment_id' FROM notifications
                    WHERE user_id = CAST(:u AS uuid) AND kind = 'comment_mention'
                    ORDER BY created_at DESC LIMIT 1
                """),
                {"u": target_uid},
            )).first()
        assert int(after) == int(before) + 1
        assert row is not None and row[0] == cid


@pytest.mark.asyncio
async def test_depth_cap_flattens_4th_level() -> None:
    """4단계째 답글은 cap 안에서 가장 깊은 노드 밑으로 평탄화된다."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r0 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "depth0"},
        )
        c0 = r0.json()["data"]["id"]
        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "depth1", "parent_id": c0},
        )
        c1 = r1.json()["data"]["id"]
        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "depth2", "parent_id": c1},
        )
        c2 = r2.json()["data"]["id"]
        r3 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "depth3-flattened", "parent_id": c2},
        )
        assert r3.status_code == 201, r3.text

        gr = await ac.get(f"/api/v1/documents/{SEED_SLUG}/comments")
        tree = gr.json()["data"]["tree"]
        root = next(n for n in tree if n["id"] == c0)

        def measure(node: dict, depth: int = 0) -> int:
            best = depth
            for child in node.get("replies", []):
                best = max(best, measure(child, depth + 1))
            return best

        # Depth 는 0,1,2 까지만 허용 (총 3 levels) → cap.
        assert measure(root) <= 2, "tree depth must be capped at 3 levels"


@pytest.mark.asyncio
async def test_resolve_via_reply_cascades_to_root() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        rr = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "thread root"},
        )
        root_id = rr.json()["data"]["id"]
        rp = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={
                "anchor_kind": "document",
                "body_md": "first reply",
                "parent_id": root_id,
            },
        )
        reply_id = rp.json()["data"]["id"]

        # reply id 로 resolve 를 호출해도 root 가 갱신돼야 한다.
        rs = await ac.post(f"/api/v1/comments/{reply_id}/resolve", json={"resolved": True})
        assert rs.status_code == 200, rs.text
        assert rs.json()["data"]["id"] == root_id
        assert rs.json()["data"]["status"] == "resolved"

        # 재오픈도 됨.
        ru = await ac.post(f"/api/v1/comments/{reply_id}/resolve", json={"resolved": False})
        assert ru.status_code == 200
        assert ru.json()["data"]["status"] == "visible"


@pytest.mark.asyncio
async def test_notifications_endpoint_returns_unread() -> None:
    """GET /notifications?unread=true 는 본인 unread 만 돌려준다."""
    target_uid = await _admin_user_id()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 멘션을 발생시켜서 notifications row 를 한 개 보장.
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            headers={"X-MXWP-User": "editor-orgadmin@mx.local"},
            json={
                "anchor_kind": "document",
                "body_md": "ping @admin",
                "mention_user_ids": [target_uid],
            },
        )

        # admin 으로 GET (기본 fallback 인증).
        r = await ac.get("/api/v1/notifications", params={"unread": "true", "limit": 5})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert isinstance(data, list)
        # 적어도 위에서 만든 mention 한 건은 들어있다.
        assert any(it["kind"] == "comment_mention" for it in data)
        meta = r.json()["meta"]
        assert meta["unread"] >= 1
