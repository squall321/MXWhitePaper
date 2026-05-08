"""Document DB 접근 계층 (raw SQL + asyncpg).

Sprint 1 — ORM 모델 미선언, sqlalchemy.text() 만 사용.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict


async def find_by_slug(s: AsyncSession, slug: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text("""
            SELECT id, slug, part_id, title, summary, status,
                   content_json, schema_ver, version, owner_id,
                   created_at, updated_at
            FROM documents WHERE slug = :slug
        """),
        {"slug": slug},
    )).first()
    if not row:
        return None
    return _row_to_dict(row)


async def find_by_id(s: AsyncSession, doc_id: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text("""
            SELECT id, slug, part_id, title, summary, status,
                   content_json, schema_ver, version, owner_id,
                   created_at, updated_at
            FROM documents WHERE id = :id
        """),
        {"id": doc_id},
    )).first()
    if not row:
        return None
    return _row_to_dict(row)


async def list_documents(
    s: AsyncSession,
    *,
    part_slug: str | None = None,
    team_slug: str | None = None,
    division_slug: str | None = None,
    group_slug: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    status_filter: str = "published",
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Sprint 2 — 계층 슬러그 필터.

    Hierarchy JOIN (활성화 시):
      documents d
        JOIN parts     p ON p.id = d.part_id
        JOIN groups    g ON g.id = p.group_id
        JOIN teams     t ON t.id = g.team_id
        JOIN divisions dv ON dv.id = t.division_id
      WHERE p.slug = :part_slug   -- 또는
            t.slug = :team_slug   -- 또는
            dv.slug = :division_slug …

    필터 한 개라도 켜지면 parts JOIN 까지 포함되며, team/division 사용 시
    상위 테이블까지 추가 JOIN. 모두 unique key 인덱스(slug) 사용.
    """
    where: list[str] = ["d.status != 'archived'"]
    if status_filter and status_filter != "all":
        where = [f"d.status = '{status_filter}'"]  # 상수만 들어옴
    params: dict[str, Any] = {"limit": min(max(limit, 1), 100)}
    join = ""

    needs_part = bool(part_slug or group_slug or team_slug or division_slug)
    if needs_part:
        join += " JOIN parts p ON p.id = d.part_id "
    if part_slug:
        where.append("p.slug = :part_slug")
        params["part_slug"] = part_slug
    if group_slug or team_slug or division_slug:
        join += " JOIN groups g ON g.id = p.group_id "
    if group_slug:
        where.append("g.slug = :group_slug")
        params["group_slug"] = group_slug
    if team_slug or division_slug:
        join += " JOIN teams t ON t.id = g.team_id "
    if team_slug:
        where.append("t.slug = :team_slug")
        params["team_slug"] = team_slug
    if division_slug:
        join += " JOIN divisions dv ON dv.id = t.division_id "
        where.append("dv.slug = :division_slug")
        params["division_slug"] = division_slug
    if tag:
        join += (
            " JOIN document_tags dt ON dt.document_id = d.id "
            " JOIN tags tg ON tg.id = dt.tag_id "
        )
        where.append("tg.name = :tag")
        params["tag"] = tag
    if q:
        where.append("(d.title ILIKE :q OR d.summary ILIKE :q)")
        params["q"] = f"%{q}%"

    sql = f"""
        SELECT d.id, d.slug, d.title, d.summary, d.status,
               d.version, d.updated_at, d.part_id
        FROM documents d {join}
        WHERE {' AND '.join(where)}
        ORDER BY d.updated_at DESC
        LIMIT :limit
    """
    rows = (await s.execute(text(sql), params)).all()
    return [
        {
            "id": str(r[0]),
            "slug": r[1],
            "title": r[2],
            "summary": r[3],
            "status": r[4],
            "version": r[5],
            "updated_at": r[6].isoformat() if r[6] else None,
            "part_id": str(r[7]) if r[7] else None,
        }
        for r in rows
    ]


async def fetch_admin_owner_id(s: AsyncSession) -> str:
    """Sprint 1 — auth 미적용. 첫 admin 사용자 id 를 반환."""
    row = (await s.execute(text("""
        SELECT id FROM users
        WHERE role = 'admin' AND is_active = TRUE
        ORDER BY created_at LIMIT 1
    """))).first()
    if not row:
        raise RuntimeError("No admin user found — run seed first.")
    return str(row[0])


async def fetch_user_by_email(s: AsyncSession, email: str) -> str | None:
    row = (await s.execute(
        text("SELECT id FROM users WHERE email = :e AND is_active = TRUE"),
        {"e": email},
    )).first()
    return str(row[0]) if row else None


async def fetch_part_id_by_slug(s: AsyncSession, slug: str) -> str | None:
    row = (await s.execute(
        text("SELECT id FROM parts WHERE slug = :slug LIMIT 1"),
        {"slug": slug},
    )).first()
    return str(row[0]) if row else None


async def fetch_parts_by_name(
    s: AsyncSession,
    name: str,
    *,
    division_slug: str | None = None,
    team_slug: str | None = None,
    group_slug: str | None = None,
) -> list[dict[str, Any]]:
    """parts.name 로 매칭 (대소문자 무시). 한글 이름을 입력하면 사용 가능.

    division/team/group slug 가 주어지면 hierarchy hint 로 disambiguate.
    여러 행이 매칭되면 모두 반환 → caller 가 ambiguous 처리.
    """
    where = ["LOWER(p.name) = LOWER(:name)"]
    params: dict[str, Any] = {"name": name}
    join = ""
    if group_slug or team_slug or division_slug:
        join = (
            " JOIN groups g ON g.id = p.group_id "
            " JOIN teams t ON t.id = g.team_id "
            " JOIN divisions d ON d.id = t.division_id "
        )
        if group_slug:
            where.append("g.slug = :gs")
            params["gs"] = group_slug
        if team_slug:
            where.append("t.slug = :ts")
            params["ts"] = team_slug
        if division_slug:
            where.append("d.slug = :ds")
            params["ds"] = division_slug
    sql = f"""
        SELECT p.id, p.slug, p.name
        FROM parts p {join}
        WHERE {' AND '.join(where)}
    """
    rows = (await s.execute(text(sql), params)).all()
    return [{"id": str(r[0]), "slug": r[1], "name": r[2]} for r in rows]


async def upsert_tag(s: AsyncSession, name: str) -> str:
    """tags.name UNIQUE — INSERT ON CONFLICT 으로 멱등 upsert."""
    name = name.strip()
    row = (await s.execute(
        text("""
            INSERT INTO tags (name) VALUES (:n)
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
        """),
        {"n": name},
    )).first()
    assert row is not None
    return str(row[0])


async def replace_document_tags(
    s: AsyncSession,
    *,
    document_id: str,
    tag_names: list[str],
) -> int:
    """document_tags 행을 (replace 전략)으로 새 set 으로 대체.

    Returns 삽입한 행 수.
    """
    await s.execute(
        text("DELETE FROM document_tags WHERE document_id = :d"),
        {"d": document_id},
    )
    inserted = 0
    seen: set[str] = set()
    for raw in tag_names or []:
        if not isinstance(raw, str):
            continue
        name = raw.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        tag_id = await upsert_tag(s, name)
        await s.execute(
            text("""
                INSERT INTO document_tags (document_id, tag_id)
                VALUES (:d, :t)
                ON CONFLICT DO NOTHING
            """),
            {"d": document_id, "t": tag_id},
        )
        inserted += 1
    return inserted


async def fetch_user_id_by_email_or_id(
    s: AsyncSession, value: str
) -> str | None:
    """email 형식이면 email 매칭, 36자 UUID 형식이면 id 매칭, 아니면 None."""
    val = value.strip()
    if not val:
        return None
    # UUID 형식 (8-4-4-4-12)?
    if len(val) == 36 and val.count("-") == 4:
        row = (await s.execute(
            text("""
                SELECT id FROM users
                WHERE id = CAST(:v AS uuid) AND is_active = TRUE
            """),
            {"v": val},
        )).first()
        if row:
            return str(row[0])
    if "@" in val:
        return await fetch_user_by_email(s, val)
    return None


async def search_users(
    s: AsyncSession, q: str, *, limit: int = 20
) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text("""
            SELECT id, email, name, role
            FROM users
            WHERE is_active = TRUE
              AND (LOWER(email) LIKE LOWER(:q)
                   OR LOWER(name) LIKE LOWER(:q))
            ORDER BY name LIMIT :lim
        """),
        {"q": f"%{q}%", "lim": min(max(limit, 1), 50)},
    )).all()
    return [
        {
            "id": str(r[0]),
            "email": r[1],
            "name": r[2],
            "role": r[3],
        }
        for r in rows
    ]


async def insert_document(
    s: AsyncSession,
    *,
    slug: str,
    title: str,
    summary: str | None,
    content_json: dict[str, Any],
    owner_id: str,
    part_id: str | None,
    schema_ver: str = "1.0",
) -> dict[str, Any]:
    try:
        row = (await s.execute(
            text("""
                INSERT INTO documents (slug, title, summary, content_json,
                                       owner_id, part_id, schema_ver, version, status)
                VALUES (:slug, :title, :summary, CAST(:body AS JSONB),
                        :owner, :part, :ver, 1, 'draft')
                RETURNING id, slug, version
            """),
            {
                "slug": slug,
                "title": title,
                "summary": summary,
                "body": json.dumps(content_json, ensure_ascii=False),
                "owner": owner_id,
                "part": part_id,
                "ver": schema_ver,
            },
        )).first()
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(f"document slug already exists: {slug}") from e
    assert row is not None
    return {"id": str(row[0]), "slug": row[1], "version": row[2]}


async def update_document(
    s: AsyncSession,
    *,
    doc_id: str,
    title: str,
    summary: str | None,
    content_json: dict[str, Any],
) -> int:
    """version 을 +1 하여 UPDATE. 새 version 반환."""
    row = (await s.execute(
        text("""
            UPDATE documents
            SET title = :title,
                summary = :summary,
                content_json = CAST(:body AS JSONB),
                version = version + 1,
                updated_at = NOW()
            WHERE id = :id
            RETURNING version
        """),
        {
            "id": doc_id,
            "title": title,
            "summary": summary,
            "body": json.dumps(content_json, ensure_ascii=False),
        },
    )).first()
    assert row is not None
    return int(row[0])


async def soft_delete_document(s: AsyncSession, doc_id: str) -> None:
    await s.execute(
        text("UPDATE documents SET status = 'archived', updated_at = NOW() WHERE id = :id"),
        {"id": doc_id},
    )


async def insert_version(
    s: AsyncSession,
    *,
    doc_id: str,
    version: int,
    content_json: dict[str, Any],
    edited_by: str,
    change_log: str | None = None,
) -> None:
    await s.execute(
        text("""
            INSERT INTO document_versions
              (document_id, version, content_json, edited_by, change_log)
            VALUES
              (:d, :v, CAST(:body AS JSONB), :u, :log)
            ON CONFLICT (document_id, version) DO NOTHING
        """),
        {
            "d": doc_id,
            "v": version,
            "body": json.dumps(content_json, ensure_ascii=False),
            "u": edited_by,
            "log": change_log,
        },
    )


async def list_backlinks(
    s: AsyncSession,
    *,
    target_doc_id: str | None = None,
    target_slug: str | None = None,
) -> list[dict[str, Any]]:
    """target_doc_id 또는 target_slug 를 가리키는 source 문서를 그룹화하여 반환.

    target_doc_id 가 주어지면 우선 매칭(작성된 페이지). 추가로 target_slug 가
    주어지면 target_doc_id IS NULL 인 unresolved link 도 함께 묶어 반환한다.
    이는 위키 링크 문법이 미작성 페이지를 가리킬 수 있도록 허용하기 때문.

    sections_referenced = source 당 distinct anchor 수.
    """
    if target_doc_id is None and target_slug is None:
        return []
    rows = (await s.execute(
        text("""
            SELECT
              d.slug,
              d.title,
              d.summary,
              MIN(L.anchor) AS anchor_sample,
              COUNT(DISTINCT L.anchor) AS distinct_anchor_count
            FROM links L
            JOIN documents d ON d.id = L.source_doc_id
            WHERE (
                (CAST(:tid AS uuid) IS NOT NULL AND L.target_doc_id = CAST(:tid AS uuid))
                OR (CAST(:tslug AS text) IS NOT NULL AND L.target_slug = CAST(:tslug AS text))
              )
              AND d.status != 'archived'
            GROUP BY d.id, d.slug, d.title, d.summary
            ORDER BY d.title
        """),
        {"tid": target_doc_id, "tslug": target_slug},
    )).all()
    return [
        {
            "slug": r[0],
            "title": r[1],
            "summary": r[2],
            "anchor": r[3],
            "sections_referenced": int(r[4] or 0),
        }
        for r in rows
    ]


async def list_versions(
    s: AsyncSession, *, doc_id: str
) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text("""
            SELECT v.version, v.edited_by, u.name, v.edited_at, v.change_log
            FROM document_versions v
            LEFT JOIN users u ON u.id = v.edited_by
            WHERE v.document_id = :id
            ORDER BY v.version DESC
        """),
        {"id": doc_id},
    )).all()
    return [
        {
            "version": int(r[0]),
            "edited_by": str(r[1]) if r[1] else None,
            "edited_by_name": r[2],
            "edited_at": r[3].isoformat() if r[3] else None,
            "change_log": r[4],
        }
        for r in rows
    ]


async def find_version(
    s: AsyncSession, *, doc_id: str, version: int
) -> dict[str, Any] | None:
    row = (await s.execute(
        text("""
            SELECT v.version, v.content_json, v.edited_by, u.name,
                   v.edited_at, v.change_log
            FROM document_versions v
            LEFT JOIN users u ON u.id = v.edited_by
            WHERE v.document_id = :id AND v.version = :v
        """),
        {"id": doc_id, "v": version},
    )).first()
    if not row:
        return None
    content = row[1]
    if isinstance(content, str):
        content = json.loads(content)
    return {
        "version": int(row[0]),
        "content_json": content,
        "edited_by": str(row[2]) if row[2] else None,
        "edited_by_name": row[3],
        "edited_at": row[4].isoformat() if row[4] else None,
        "change_log": row[5],
    }


async def replace_links_for_document(
    s: AsyncSession,
    *,
    source_doc_id: str,
    links: list[dict[str, Any]],
) -> int:
    """links 테이블에서 source_doc_id 의 행을 모두 제거 후 새로 삽입.

    target_doc_id 는 documents.slug 와 조인해 해석되며 미발견 시 NULL.
    같은 트랜잭션(세션)에서 실행되므로 commit 은 호출자가 담당.

    Returns:
        삽입한 행 수.
    """
    await s.execute(
        text("DELETE FROM links WHERE source_doc_id = :sid"),
        {"sid": source_doc_id},
    )
    if not links:
        return 0

    # 파라미터 바인딩으로 한 행씩 INSERT — pyformat 으로는 multi-row + LATERAL JOIN
    # 이 까다로워 단순 루프로 처리. doc 당 링크 수는 보통 수십 이하.
    inserted = 0
    for L in links:
        await s.execute(
            text("""
                INSERT INTO links
                  (source_doc_id, target_slug, target_doc_id, anchor, link_type)
                SELECT
                  :sid,
                  :tslug,
                  d.id,
                  :anchor,
                  'wiki'
                FROM (SELECT 1) AS _
                LEFT JOIN documents d
                  ON d.slug = :tslug AND d.status != 'archived'
            """),
            {
                "sid": source_doc_id,
                "tslug": L["target_slug"],
                "anchor": L.get("anchor"),
            },
        )
        inserted += 1
    return inserted


async def insert_audit(
    s: AsyncSession,
    *,
    user_id: str | None,
    action: str,
    target: str,
    payload: dict[str, Any] | None = None,
) -> None:
    await s.execute(
        text("""
            INSERT INTO audit_logs (user_id, action, target, payload)
            VALUES (:u, :a, :t, CAST(:p AS JSONB))
        """),
        {
            "u": user_id,
            "a": action,
            "t": target,
            "p": json.dumps(payload or {}, ensure_ascii=False),
        },
    )


def _row_to_dict(row: Any) -> dict[str, Any]:
    content = row[6]
    if isinstance(content, str):
        content = json.loads(content)
    return {
        "id": str(row[0]),
        "slug": row[1],
        "part_id": str(row[2]) if row[2] else None,
        "title": row[3],
        "summary": row[4],
        "status": row[5],
        "content_json": content,
        "schema_ver": row[7],
        "version": int(row[8]),
        "owner_id": str(row[9]),
        "created_at": row[10].isoformat() if row[10] else None,
        "updated_at": row[11].isoformat() if row[11] else None,
    }
