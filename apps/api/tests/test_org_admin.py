"""Cycle 14 — Org admin CRUD: create / rename / move / delete + RBAC."""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _ensure_editor_user() -> tuple[str, str]:
    """Create a throw-away editor user (idempotent on re-runs).

    Returns (email, access_token).
    """
    email = "editor-orgadmin@mx.local"
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if row is None:
            await s.execute(
                text(
                    """
                    INSERT INTO users (email, name, password_hash, role)
                    VALUES (:e, :n, :pw, 'editor')
                    """
                ),
                {"e": email, "n": "Editor (test)", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return email, make_access_token(uid)


# ── Happy path ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_can_create_team_under_existing_division() -> None:
    transport = ASGITransport(app=app)
    new_slug = f"team-{uuid.uuid4().hex[:6]}"
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.post(
            "/api/v1/teams",
            json={"division_slug": "mx", "slug": new_slug, "name": "테스트팀"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 201, r.text
        assert r.json()["data"]["slug"] == new_slug

        # cleanup
        await ac.delete(
            f"/api/v1/teams/{new_slug}",
            params={"division": "mx"},
            headers={"Authorization": f"Bearer {token}"},
        )


@pytest.mark.asyncio
async def test_admin_can_rename_part() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        # Rename 'cae' to a temporary name then back.
        r = await ac.put(
            "/api/v1/parts/cae",
            params={"division": "mx", "team": "dev", "group": "he-team"},
            json={"name": "CAE그룹 (renamed)"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["name"] == "CAE그룹 (renamed)"

        # restore
        r2 = await ac.put(
            "/api/v1/parts/cae",
            params={"division": "mx", "team": "dev", "group": "he-team"},
            json={"name": "CAE그룹"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 200, r2.text


@pytest.mark.asyncio
async def test_admin_can_move_part_to_another_group() -> None:
    """A part moved via target_* slugs ends up under the new group."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}

        # Set up: alt group + alt part to move.
        alt_group_slug = f"alt-{uuid.uuid4().hex[:6]}"
        alt_part_slug = f"alt-part-{uuid.uuid4().hex[:6]}"
        r = await ac.post(
            "/api/v1/groups",
            json={
                "division_slug": "mx",
                "team_slug": "dev",
                "slug": alt_group_slug,
                "name": "임시그룹",
            },
            headers=h,
        )
        assert r.status_code == 201, r.text
        r = await ac.post(
            "/api/v1/parts",
            json={
                "division_slug": "mx",
                "team_slug": "dev",
                "group_slug": "he-team",
                "slug": alt_part_slug,
                "name": "이동대상파트",
            },
            headers=h,
        )
        assert r.status_code == 201, r.text

        # Move it.
        r = await ac.put(
            f"/api/v1/parts/{alt_part_slug}",
            params={"division": "mx", "team": "dev", "group": "he-team"},
            json={
                "target_division_slug": "mx",
                "target_team_slug": "dev",
                "target_group_slug": alt_group_slug,
            },
            headers=h,
        )
        assert r.status_code == 200, r.text

        # Verify: GET /parts/<slug> via the new parent group succeeds.
        r2 = await ac.get(
            f"/api/v1/parts/{alt_part_slug}",
            params={"division": "mx", "team": "dev", "group": alt_group_slug},
        )
        assert r2.status_code == 200, r2.text

        # cleanup (CASCADE removes the part).
        await ac.delete(
            f"/api/v1/groups/{alt_group_slug}",
            params={"division": "mx", "team": "dev"},
            headers=h,
        )


@pytest.mark.asyncio
async def test_admin_can_delete_team_cascades_to_groups() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        team_slug = f"tmp-{uuid.uuid4().hex[:6]}"
        # Create a team + nested group.
        await ac.post(
            "/api/v1/teams",
            json={"division_slug": "mx", "slug": team_slug, "name": "tmp"},
            headers=h,
        )
        await ac.post(
            "/api/v1/groups",
            json={
                "division_slug": "mx",
                "team_slug": team_slug,
                "slug": "child",
                "name": "child",
            },
            headers=h,
        )
        # Delete team (CASCADE).
        r = await ac.delete(
            f"/api/v1/teams/{team_slug}",
            params={"division": "mx"},
            headers=h,
        )
        assert r.status_code == 204, r.text


# ── RBAC ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_admin_cannot_create_team() -> None:
    transport = ASGITransport(app=app)
    _email, token = await _ensure_editor_user()
    new_slug = f"forbidden-{uuid.uuid4().hex[:6]}"
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/teams",
            json={"division_slug": "mx", "slug": new_slug, "name": "x"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_non_admin_cannot_delete_part() -> None:
    transport = ASGITransport(app=app)
    _email, token = await _ensure_editor_user()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.delete(
            "/api/v1/parts/cae",
            params={"division": "mx", "team": "dev", "group": "he-team"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_part_move_requires_all_three_target_slugs() -> None:
    """Supplying only target_team_slug should fail with 409."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.put(
            "/api/v1/parts/cae",
            params={"division": "mx", "team": "dev", "group": "he-team"},
            json={"target_team_slug": "dev"},
            headers={"Authorization": f"Bearer {token}"},
        )
    # Conflict (missing companion slugs).
    assert r.status_code == 409, r.text
