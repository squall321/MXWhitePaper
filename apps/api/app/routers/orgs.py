"""조직(Division/Team/Group/Part) CRUD + 트리 라우터.

Sprint 1 — auth 미적용. 모든 엔드포인트 누구나 호출 가능.
SQLAlchemy 2.0 async + raw SQL 사용 (ORM 모델 미선언).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_reader
from app.core.db import get_db
from app.core.errors import Conflict, NotFound, envelope
from app.repos import document_repo
from app.schemas.org import (
    DivisionCreate,
    DivisionNode,
    DivisionUpdate,
    GroupCreate,
    GroupNode,
    GroupUpdate,
    OrgTree,
    PartCreate,
    PartNode,
    PartUpdate,
    TeamCreate,
    TeamNode,
    TeamUpdate,
)


router = APIRouter(prefix="/api/v1", tags=["orgs"])


# ── Helpers ─────────────────────────────────────────────────────────────
async def _fetch_division_id(s: AsyncSession, division_slug: str) -> str:
    row = (await s.execute(
        text("SELECT id FROM divisions WHERE slug = :slug"),
        {"slug": division_slug},
    )).first()
    if not row:
        raise NotFound(f"division not found: {division_slug}")
    return str(row[0])


async def _fetch_team_id(s: AsyncSession, division_slug: str, team_slug: str) -> str:
    row = (await s.execute(
        text("""
            SELECT t.id FROM teams t
            JOIN divisions d ON d.id = t.division_id
            WHERE d.slug = :ds AND t.slug = :ts
        """),
        {"ds": division_slug, "ts": team_slug},
    )).first()
    if not row:
        raise NotFound(f"team not found: {division_slug}/{team_slug}")
    return str(row[0])


async def _fetch_group_id(
    s: AsyncSession, division_slug: str, team_slug: str, group_slug: str
) -> str:
    row = (await s.execute(
        text("""
            SELECT g.id FROM groups g
            JOIN teams t ON t.id = g.team_id
            JOIN divisions d ON d.id = t.division_id
            WHERE d.slug = :ds AND t.slug = :ts AND g.slug = :gs
        """),
        {"ds": division_slug, "ts": team_slug, "gs": group_slug},
    )).first()
    if not row:
        raise NotFound(f"group not found: {division_slug}/{team_slug}/{group_slug}")
    return str(row[0])


# ── Divisions ───────────────────────────────────────────────────────────
@router.get("/divisions", summary="사업부 목록")
async def list_divisions(s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    rows = (await s.execute(text(
        "SELECT id, slug, name, description FROM divisions ORDER BY slug"
    ))).all()
    data = [
        {"id": str(r[0]), "slug": r[1], "name": r[2], "description": r[3]} for r in rows
    ]
    return envelope(data=data, meta={"count": len(data)})


@router.get("/divisions/{slug}")
async def get_division(slug: str, s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    row = (await s.execute(
        text("SELECT id, slug, name, description FROM divisions WHERE slug = :slug"),
        {"slug": slug},
    )).first()
    if not row:
        raise NotFound(f"division not found: {slug}")
    return envelope(data={
        "id": str(row[0]), "slug": row[1], "name": row[2], "description": row[3],
    })


@router.post("/divisions", status_code=201)
async def create_division(
    payload: DivisionCreate,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        row = (await s.execute(
            text("""
                INSERT INTO divisions (slug, name, description)
                VALUES (:slug, :name, :desc)
                RETURNING id, slug, name, description
            """),
            {"slug": payload.slug, "name": payload.name, "desc": payload.description},
        )).first()
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="org.division.create",
            target=f"division:{payload.slug}",
            payload={"name": payload.name},
        )
        await s.commit()
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(f"division slug already exists: {payload.slug}") from e
    assert row is not None
    return envelope(data={
        "id": str(row[0]), "slug": row[1], "name": row[2], "description": row[3],
    })


@router.put("/divisions/{slug}")
async def update_division(
    slug: str,
    payload: DivisionUpdate,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    div_id = await _fetch_division_id(s, slug)
    fields: list[str] = []
    params: dict[str, Any] = {"id": div_id}
    if payload.name is not None:
        fields.append("name = :name")
        params["name"] = payload.name
    if payload.description is not None:
        fields.append("description = :desc")
        params["desc"] = payload.description
    if fields:
        await s.execute(
            text(f"UPDATE divisions SET {', '.join(fields)} WHERE id = :id"),
            params,
        )
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="org.division.update",
            target=f"division:{slug}",
            payload={k: params[k] for k in params if k != "id"},
        )
        await s.commit()
    row = (await s.execute(
        text("SELECT id, slug, name, description FROM divisions WHERE id = :id"),
        {"id": div_id},
    )).first()
    assert row is not None
    return envelope(data={
        "id": str(row[0]), "slug": row[1], "name": row[2], "description": row[3],
    })


@router.delete("/divisions/{slug}", status_code=204)
async def delete_division(
    slug: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> None:
    div_id = await _fetch_division_id(s, slug)
    await s.execute(text("DELETE FROM divisions WHERE id = :id"), {"id": div_id})
    await document_repo.insert_audit(
        s,
        user_id=user.get("id"),
        action="org.division.delete",
        target=f"division:{slug}",
    )
    await s.commit()


# ── Teams ───────────────────────────────────────────────────────────────
@router.get("/teams")
async def list_teams(
    division: str | None = None, s: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    if division:
        sql = """
            SELECT t.id, t.division_id, t.slug, t.name
            FROM teams t JOIN divisions d ON d.id = t.division_id
            WHERE d.slug = :slug
            ORDER BY t.slug
        """
        rows = (await s.execute(text(sql), {"slug": division})).all()
    else:
        rows = (await s.execute(text(
            "SELECT id, division_id, slug, name FROM teams ORDER BY slug"
        ))).all()
    data = [
        {"id": str(r[0]), "division_id": str(r[1]), "slug": r[2], "name": r[3]}
        for r in rows
    ]
    return envelope(data=data, meta={"count": len(data)})


@router.get("/teams/{slug}")
async def get_team(
    slug: str, division: str, s: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """team slug 는 division 내에서만 unique 하므로 division 을 query 로 받음."""
    row = (await s.execute(
        text("""
            SELECT t.id, t.division_id, t.slug, t.name
            FROM teams t JOIN divisions d ON d.id = t.division_id
            WHERE d.slug = :ds AND t.slug = :ts
        """),
        {"ds": division, "ts": slug},
    )).first()
    if not row:
        raise NotFound(f"team not found: {division}/{slug}")
    return envelope(data={
        "id": str(row[0]), "division_id": str(row[1]), "slug": row[2], "name": row[3],
    })


@router.post("/teams", status_code=201)
async def create_team(
    payload: TeamCreate,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    div_id = await _fetch_division_id(s, payload.division_slug)
    try:
        row = (await s.execute(
            text("""
                INSERT INTO teams (division_id, slug, name)
                VALUES (:div, :slug, :name)
                RETURNING id, division_id, slug, name
            """),
            {"div": div_id, "slug": payload.slug, "name": payload.name},
        )).first()
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="org.team.create",
            target=f"team:{payload.division_slug}/{payload.slug}",
            payload={"name": payload.name},
        )
        await s.commit()
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(
            f"team already exists: {payload.division_slug}/{payload.slug}"
        ) from e
    assert row is not None
    return envelope(data={
        "id": str(row[0]), "division_id": str(row[1]), "slug": row[2], "name": row[3],
    })


@router.put("/teams/{slug}")
async def update_team(
    slug: str,
    payload: TeamUpdate,
    division: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    team_id = await _fetch_team_id(s, division, slug)
    if payload.name is not None:
        await s.execute(
            text("UPDATE teams SET name = :n WHERE id = :id"),
            {"n": payload.name, "id": team_id},
        )
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="org.team.update",
            target=f"team:{division}/{slug}",
            payload={"name": payload.name},
        )
        await s.commit()
    row = (await s.execute(
        text("SELECT id, division_id, slug, name FROM teams WHERE id = :id"),
        {"id": team_id},
    )).first()
    assert row is not None
    return envelope(data={
        "id": str(row[0]), "division_id": str(row[1]), "slug": row[2], "name": row[3],
    })


@router.delete("/teams/{slug}", status_code=204)
async def delete_team(
    slug: str,
    division: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> None:
    team_id = await _fetch_team_id(s, division, slug)
    await s.execute(text("DELETE FROM teams WHERE id = :id"), {"id": team_id})
    await document_repo.insert_audit(
        s,
        user_id=user.get("id"),
        action="org.team.delete",
        target=f"team:{division}/{slug}",
    )
    await s.commit()


# ── Groups ──────────────────────────────────────────────────────────────
@router.get("/groups")
async def list_groups(
    division: str | None = None,
    team: str | None = None,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if division and team:
        rows = (await s.execute(
            text("""
                SELECT g.id, g.team_id, g.slug, g.name
                FROM groups g
                JOIN teams t ON t.id = g.team_id
                JOIN divisions d ON d.id = t.division_id
                WHERE d.slug = :ds AND t.slug = :ts
                ORDER BY g.slug
            """),
            {"ds": division, "ts": team},
        )).all()
    else:
        rows = (await s.execute(text(
            "SELECT id, team_id, slug, name FROM groups ORDER BY slug"
        ))).all()
    data = [
        {"id": str(r[0]), "team_id": str(r[1]), "slug": r[2], "name": r[3]}
        for r in rows
    ]
    return envelope(data=data, meta={"count": len(data)})


@router.get("/groups/{slug}")
async def get_group(
    slug: str, division: str, team: str, s: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    row = (await s.execute(
        text("""
            SELECT g.id, g.team_id, g.slug, g.name
            FROM groups g
            JOIN teams t ON t.id = g.team_id
            JOIN divisions d ON d.id = t.division_id
            WHERE d.slug = :ds AND t.slug = :ts AND g.slug = :gs
        """),
        {"ds": division, "ts": team, "gs": slug},
    )).first()
    if not row:
        raise NotFound(f"group not found: {division}/{team}/{slug}")
    return envelope(data={
        "id": str(row[0]), "team_id": str(row[1]), "slug": row[2], "name": row[3],
    })


@router.post("/groups", status_code=201)
async def create_group(
    payload: GroupCreate,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    team_id = await _fetch_team_id(s, payload.division_slug, payload.team_slug)
    try:
        row = (await s.execute(
            text("""
                INSERT INTO groups (team_id, slug, name)
                VALUES (:t, :slug, :name)
                RETURNING id, team_id, slug, name
            """),
            {"t": team_id, "slug": payload.slug, "name": payload.name},
        )).first()
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="org.group.create",
            target=f"group:{payload.division_slug}/{payload.team_slug}/{payload.slug}",
            payload={"name": payload.name},
        )
        await s.commit()
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(f"group already exists: {payload.team_slug}/{payload.slug}") from e
    assert row is not None
    return envelope(data={
        "id": str(row[0]), "team_id": str(row[1]), "slug": row[2], "name": row[3],
    })


@router.put("/groups/{slug}")
async def update_group(
    slug: str,
    payload: GroupUpdate,
    division: str,
    team: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    group_id = await _fetch_group_id(s, division, team, slug)
    if payload.name is not None:
        await s.execute(
            text("UPDATE groups SET name = :n WHERE id = :id"),
            {"n": payload.name, "id": group_id},
        )
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="org.group.update",
            target=f"group:{division}/{team}/{slug}",
            payload={"name": payload.name},
        )
        await s.commit()
    row = (await s.execute(
        text("SELECT id, team_id, slug, name FROM groups WHERE id = :id"),
        {"id": group_id},
    )).first()
    assert row is not None
    return envelope(data={
        "id": str(row[0]), "team_id": str(row[1]), "slug": row[2], "name": row[3],
    })


@router.delete("/groups/{slug}", status_code=204)
async def delete_group(
    slug: str,
    division: str,
    team: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> None:
    group_id = await _fetch_group_id(s, division, team, slug)
    await s.execute(text("DELETE FROM groups WHERE id = :id"), {"id": group_id})
    await document_repo.insert_audit(
        s,
        user_id=user.get("id"),
        action="org.group.delete",
        target=f"group:{division}/{team}/{slug}",
    )
    await s.commit()


# ── Parts ───────────────────────────────────────────────────────────────
@router.get("/parts")
async def list_parts(
    division: str | None = None,
    team: str | None = None,
    group: str | None = None,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if division and team and group:
        rows = (await s.execute(
            text("""
                SELECT p.id, p.group_id, p.slug, p.name
                FROM parts p
                JOIN groups g ON g.id = p.group_id
                JOIN teams t ON t.id = g.team_id
                JOIN divisions d ON d.id = t.division_id
                WHERE d.slug = :ds AND t.slug = :ts AND g.slug = :gs
                ORDER BY p.slug
            """),
            {"ds": division, "ts": team, "gs": group},
        )).all()
    else:
        rows = (await s.execute(text(
            "SELECT id, group_id, slug, name FROM parts ORDER BY slug"
        ))).all()
    data = [
        {"id": str(r[0]), "group_id": str(r[1]), "slug": r[2], "name": r[3]}
        for r in rows
    ]
    return envelope(data=data, meta={"count": len(data)})


@router.get("/parts/{slug}")
async def get_part(
    slug: str,
    division: str,
    team: str,
    group: str,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = (await s.execute(
        text("""
            SELECT p.id, p.group_id, p.slug, p.name
            FROM parts p
            JOIN groups g ON g.id = p.group_id
            JOIN teams t ON t.id = g.team_id
            JOIN divisions d ON d.id = t.division_id
            WHERE d.slug = :ds AND t.slug = :ts AND g.slug = :gs AND p.slug = :ps
        """),
        {"ds": division, "ts": team, "gs": group, "ps": slug},
    )).first()
    if not row:
        raise NotFound(f"part not found: {division}/{team}/{group}/{slug}")
    return envelope(data={
        "id": str(row[0]), "group_id": str(row[1]), "slug": row[2], "name": row[3],
    })


@router.post("/parts", status_code=201)
async def create_part(
    payload: PartCreate,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    group_id = await _fetch_group_id(
        s, payload.division_slug, payload.team_slug, payload.group_slug
    )
    try:
        row = (await s.execute(
            text("""
                INSERT INTO parts (group_id, slug, name)
                VALUES (:g, :slug, :name)
                RETURNING id, group_id, slug, name
            """),
            {"g": group_id, "slug": payload.slug, "name": payload.name},
        )).first()
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="org.part.create",
            target=(
                f"part:{payload.division_slug}/{payload.team_slug}/"
                f"{payload.group_slug}/{payload.slug}"
            ),
            payload={"name": payload.name},
        )
        await s.commit()
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(
            f"part already exists: {payload.group_slug}/{payload.slug}"
        ) from e
    assert row is not None
    return envelope(data={
        "id": str(row[0]), "group_id": str(row[1]), "slug": row[2], "name": row[3],
    })


@router.put("/parts/{slug}")
async def update_part(
    slug: str,
    payload: PartUpdate,
    division: str,
    team: str,
    group: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Rename and/or move a part.

    Supports three independent operations in one call:
      1. Rename display name (`name`).
      2. Rename slug (`target_slug`) within the (possibly new) parent group.
      3. Move to a different group (`target_division_slug` /
         `target_team_slug` / `target_group_slug` — all three required
         together).
    """
    group_id = await _fetch_group_id(s, division, team, group)
    row = (await s.execute(
        text("SELECT id FROM parts WHERE group_id = :g AND slug = :s"),
        {"g": group_id, "s": slug},
    )).first()
    if not row:
        raise NotFound(f"part not found: {division}/{team}/{group}/{slug}")
    part_id = str(row[0])

    # Move target — must be all-or-nothing.
    move_keys = (
        payload.target_division_slug,
        payload.target_team_slug,
        payload.target_group_slug,
    )
    will_move = any(move_keys)
    if will_move and not all(move_keys):
        raise Conflict(
            "target_division_slug, target_team_slug, target_group_slug must "
            "be supplied together"
        )

    new_group_id = group_id
    if will_move:
        new_group_id = await _fetch_group_id(
            s,
            payload.target_division_slug,  # type: ignore[arg-type]
            payload.target_team_slug,  # type: ignore[arg-type]
            payload.target_group_slug,  # type: ignore[arg-type]
        )

    new_slug = payload.target_slug or slug

    fields: list[str] = []
    params: dict[str, Any] = {"id": part_id}
    if payload.name is not None:
        fields.append("name = :n")
        params["n"] = payload.name
    if new_group_id != group_id:
        fields.append("group_id = :gid")
        params["gid"] = new_group_id
    if new_slug != slug:
        fields.append("slug = :slg")
        params["slg"] = new_slug

    if fields:
        try:
            await s.execute(
                text(f"UPDATE parts SET {', '.join(fields)} WHERE id = :id"),
                params,
            )
        except IntegrityError as e:
            await s.rollback()
            raise Conflict(
                f"part already exists in target group: {new_slug}"
            ) from e
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="org.part.update",
            target=f"part:{division}/{team}/{group}/{slug}",
            payload={
                k: params[k] for k in params if k != "id"
            },
        )
        await s.commit()
    row2 = (await s.execute(
        text("SELECT id, group_id, slug, name FROM parts WHERE id = :id"),
        {"id": part_id},
    )).first()
    assert row2 is not None
    return envelope(data={
        "id": str(row2[0]), "group_id": str(row2[1]), "slug": row2[2], "name": row2[3],
    })


@router.delete("/parts/{slug}", status_code=204)
async def delete_part(
    slug: str,
    division: str,
    team: str,
    group: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> None:
    group_id = await _fetch_group_id(s, division, team, group)
    row = (await s.execute(
        text("SELECT id FROM parts WHERE group_id = :g AND slug = :s"),
        {"g": group_id, "s": slug},
    )).first()
    if not row:
        raise NotFound(f"part not found: {division}/{team}/{group}/{slug}")
    await s.execute(text("DELETE FROM parts WHERE id = :id"), {"id": str(row[0])})
    await document_repo.insert_audit(
        s,
        user_id=user.get("id"),
        action="org.part.delete",
        target=f"part:{division}/{team}/{group}/{slug}",
    )
    await s.commit()


# ── Org Tree (좌측 네비게이션용 nested 응답) ──────────────────────────
@router.get(
    "/orgs/tree",
    summary="조직 전체 트리 (Division → Team → Group → Part)",
    description="좌측 네비게이션용 nested 응답. 한 번에 4개 SELECT 만 수행.",
)
async def get_org_tree(s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """전체 조직 트리 1회 SELECT 4번으로 구성. 사이즈 작으니 페이지네이션 없음."""
    div_rows = (await s.execute(text(
        "SELECT id, slug, name FROM divisions ORDER BY slug"
    ))).all()
    team_rows = (await s.execute(text(
        "SELECT id, division_id, slug, name FROM teams ORDER BY slug"
    ))).all()
    group_rows = (await s.execute(text(
        "SELECT id, team_id, slug, name FROM groups ORDER BY slug"
    ))).all()
    part_rows = (await s.execute(text(
        "SELECT id, group_id, slug, name FROM parts ORDER BY slug"
    ))).all()

    parts_by_group: dict[str, list[PartNode]] = {}
    for p in part_rows:
        parts_by_group.setdefault(str(p[1]), []).append(
            PartNode(id=str(p[0]), slug=p[2], name=p[3])
        )

    groups_by_team: dict[str, list[GroupNode]] = {}
    for g in group_rows:
        groups_by_team.setdefault(str(g[1]), []).append(
            GroupNode(
                id=str(g[0]),
                slug=g[2],
                name=g[3],
                parts=parts_by_group.get(str(g[0]), []),
            )
        )

    teams_by_division: dict[str, list[TeamNode]] = {}
    for t in team_rows:
        teams_by_division.setdefault(str(t[1]), []).append(
            TeamNode(
                id=str(t[0]),
                slug=t[2],
                name=t[3],
                groups=groups_by_team.get(str(t[0]), []),
            )
        )

    divisions = [
        DivisionNode(
            id=str(d[0]),
            slug=d[1],
            name=d[2],
            teams=teams_by_division.get(str(d[0]), []),
        )
        for d in div_rows
    ]

    tree = OrgTree(divisions=divisions)
    return envelope(data=tree.model_dump(), meta={"divisions": len(divisions)})
