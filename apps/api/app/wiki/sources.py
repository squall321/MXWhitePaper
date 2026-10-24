# 위키 원천 받기 · 목록 · 철회 · 기록 — 범위 · 주인 규칙 · 멱등 · 새 판 · 첨부 복사 · 원천 문서(src-…) · 들이기 작업 줄 세우기
"""CONTRACTS §2-2 · §3 · §6 · §10. 연결기(W8)도 `receive` 를 그대로 부른다 — `POST /sources` 와 같은 서버 함수.

- 범위 — 보낸 사람이 토큰을 모두 가져야 하고(못 볼 원천을 들이지 않는다), `["org"]` 는 관리자(서비스 계정)만. 위임 호출은 admin 이
  owner 로 깎여 있어 늘 일반 사용자 규칙을 따른다.
- 주인 — 남을 주인으로 적는 것은 관리자만(연결기는 원천 시스템이 준 주인을 싣는다). 그 밖은 비면 나, 다르면 거부.
- 멱등 — 같은 (시스템, ref, 판, payload 해시)는 같은 id. 같은 (시스템, ref)의 다른 것은 새 줄이 되고 옛 active 를 superseded 로 민다.
- 원천 문서는 시스템으로 짓는다 — 서비스 계정(admin)이 보낼 때마다 '범위 밖 읽기' 감사가 쌓이지 않게. 기밀 등급은 원천의 sensitivity 그대로,
  지은이는 보낸 사람, 주인 칸(`metadata.owners`)은 원천의 주인(restricted 원천을 주인이 읽는 길).
"""
from __future__ import annotations

import contextlib
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import ulid
from botocore.exceptions import ClientError
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.services import document_service
from app.storage import minio_adapter
from app.wiki import audience, jobs
from app.wiki.envelope import SourceEnvelope

KST = ZoneInfo("Asia/Seoul")
_VIA_BY_CLIENT = {"gateway": "gateway", "hwax-portal": "portal-chat"}
# 종류별로 '요약' 에 쓰는 본문 칸 — 없으면 제목. 원천 문서의 핵심 값 표에서는 뺀다(두 번 싣지 않게).
_SUMMARY_FIELD = {
    "sim_result": "summary", "field_defect": "symptom", "qa": "question", "deliberation": "decision", "report": "title",
    "card": "title", "correction": "text", "inquiry_answer": "answer", "note": "text",
}


@dataclass
class Received:
    id: str
    dedup: bool
    doc_slug: str | None
    ingest_state: str


def short_id(source_id: str) -> str:
    return "src_" + source_id.replace("-", "")[:8]


def visible_sql(alias: str = "ws") -> str:
    """원천 표 별칭 하나에 붙일 술어 — 범위 토큰을 모두 가졌고, restricted 면 주인 · 들인 사람. admin · 시스템은 다. 값은 `audience.sql_params()`.

    승인 전 후보(W6 — held · 동의 candidate)는 주인만 본다 — admin 도 못 본다(아직 원천이 아니다 · '후보는 주인만').
    """
    return f"""(
        (NOT ({alias}.ingest_state = 'held' AND {alias}.consent ->> 'mode' = 'candidate')
         OR {alias}.owner_user_id = CAST(:_aud_uid AS uuid))
        AND (CAST(:_aud_all AS boolean)
            OR ({alias}.audience <@ CAST(:_aud_tokens AS text[])
                AND ({alias}.sensitivity <> 'restricted'
                     OR {alias}.owner_user_id = CAST(:_aud_uid AS uuid)
                     OR {alias}.submitted_by = CAST(:_aud_uid AS uuid)
                     OR {alias}.owner_email = :_aud_email)))
    )"""


# ── 받기 ─────────────────────────────────────────────────────────────────────────────────────────

def _check_sender(env: SourceEnvelope, caller: dict[str, Any], viewer: audience.Viewer, *, org_ok: bool = False) -> str:
    """범위 · 주인 규칙(CONTRACTS §3) — 통과하면 주인 이메일(소문자). `org_ok` — 되쌓기처럼 근거가 모두 전사인 것(W6)."""
    if env.audience == ["org"] and not viewer.is_admin and not org_ok:
        raise Forbidden("전사 범위 ['org'] 는 관리자 · 서비스 계정만 보낸다 — 소속 같은 좁은 범위로 보내라")
    missing = [] if viewer.sees_all else [t for t in env.audience if t not in viewer.tokens]
    if missing:
        raise Forbidden("보낸 사람이 갖지 않은 범위 토큰이다 — 못 볼 원천은 들이지 않는다", details={"missing": missing})
    me = str(caller.get("email") or "").lower()
    owner = env.owner.email.lower() if env.owner else me
    if owner != me and not viewer.is_admin:
        raise Forbidden("주인을 남으로 적는 것은 관리자(서비스 계정)만 — 위임 호출은 owner.email 이 호출자와 같아야 한다")
    return owner


def _via(caller: dict[str, Any], env: SourceEnvelope) -> str:
    via = str(caller.get("auth_via") or "")
    if via.startswith("delegated:"):
        return _VIA_BY_CLIENT.get(via.split(":", 1)[1], via)
    if via == "api_token":
        return f"connector:{env.origin.system}"
    return "upload"


async def _find(s: AsyncSession, key: dict[str, Any]) -> Received | None:
    row = (await s.execute(text("""
        SELECT ws.id, ws.ingest_state, d.slug FROM wiki_sources ws LEFT JOIN documents d ON d.id = ws.doc_id
         WHERE ws.origin_system = :sys AND ws.origin_ref = :ref
           AND COALESCE(ws.origin_rev, '') = COALESCE(CAST(:rev AS text), '') AND ws.payload_sha256 = :sha
           AND ws.audience = CAST(:aud AS text[])
    """), key)).first()
    return Received(id=str(row[0]), dedup=True, doc_slug=row[2], ingest_state=row[1]) if row else None


def _copy_blob(bucket: str, key: str) -> tuple[str, str, int, str | None]:
    """업로드 객체 → 위키 버킷 `<sha 앞 2>/<sha>`(이미 있으면 그대로). (키, sha256, 바이트, mime)."""
    cli = minio_adapter.internal_client()
    obj = cli.get_object(Bucket=bucket, Key=key)
    raw = obj["Body"].read()
    sha = hashlib.sha256(raw).hexdigest()
    dst, wkey = get_settings().minio_bucket_wiki_sources, f"{sha[:2]}/{sha}"
    try:
        cli.head_object(Bucket=dst, Key=wkey)
    except ClientError:
        cli.put_object(Bucket=dst, Key=wkey, Body=raw, ContentType=obj.get("ContentType") or "application/octet-stream")
    return wkey, sha, len(raw), obj.get("ContentType")


async def _attachments(s: AsyncSession, env: SourceEnvelope) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    """첨부(먼저 올린 업로드 id)를 위키 버킷으로 복사한다. 둘째는 원천 문서에 그림으로 붙일 (이미지 id, 이름)."""
    settings = get_settings()
    blobs: list[dict[str, Any]] = []
    figures: list[tuple[str, str]] = []
    for att in env.attachments:
        row = (await s.execute(text("""
            SELECT 'figure', CAST(id AS text), storage_keys ->> 'orig' FROM images WHERE CAST(id AS text) = :u OR ulid = :u
            UNION ALL
            SELECT 'raw', id, storage_key FROM files WHERE id = :u
            LIMIT 1
        """), {"u": att.upload_id})).first()
        if row is None or not row[2]:
            raise ValidationFailed("첨부의 upload_id 를 찾지 못했다 — 업로드(init · put · finalize)를 먼저 끝내라",
                                   details={"upload_id": att.upload_id})
        role, ref, key = row
        bucket = settings.minio_bucket_images if role == "figure" else settings.minio_bucket_files
        wkey, sha, size, mime = await run_in_threadpool(_copy_blob, bucket, key)
        blobs.append({"key": wkey, "name": att.name, "mime": mime or att.mime, "sha256": sha, "bytes": size, "role": role})
        if role == "figure":
            figures.append((ref, att.name))
    return blobs, figures


async def _free_slug(s: AsyncSession, source_id: str) -> str:
    """`src-<앞 8자>` — 8자가 이미 있으면(10만 장쯤에서 겹친다) 12자, 그래도 있으면 전체."""
    hexid = source_id.replace("-", "")
    for n in (8, 12):
        slug = f"src-{hexid[:n]}"
        if (await s.execute(text("SELECT 1 FROM documents WHERE slug = :s"), {"s": slug})).first() is None:
            return slug
    return f"src-{hexid}"


async def receive(s: AsyncSession, env: SourceEnvelope, *, caller: dict[str, Any], ingest: bool = True,
                  org_ok: bool = False, held: bool | None = None) -> Received:
    """봉투 하나를 받는다 — 새것이면 원천 줄 · 원천 문서 · (ingest 면) 들이기 작업을 한 트랜잭션에. 같은 것이면 그 id(`dedup`).

    후보(동의 `candidate` — 포털 챗의 '해결된 턴', `held` 가 비면 동의를 따른다)는 주인만 보는 범위(`user:<주인 id>`) · `held` 로
    두고 들이지 않는다. 보낸 범위는 동의 칸의 `suggested_audience` 로 남긴다 — 주인이 '내 후보' 에서 고른다(app/wiki/candidates.py).
    """
    viewer = audience.viewer_from_user(caller)
    owner_email = _check_sender(env, caller, viewer, org_ok=org_ok)
    consent = env.consent.model_dump(mode="json") if env.consent else None
    if held if held is not None else (env.consent is not None and env.consent.mode == "candidate"):
        owner_id = (await s.execute(text("SELECT id FROM users WHERE lower(email) = :e ORDER BY created_at LIMIT 1"),
                                    {"e": owner_email})).scalar()
        if owner_id is None:
            raise ValidationFailed("후보는 주인이 MXWP 사용자여야 한다 — 주인만 보는 범위를 지을 수 없다")
        consent = {**(consent or {}), "suggested_audience": env.audience}
        env = env.model_copy(update={"audience": [f"user:{owner_id}"]})
        ingest = False
    payload = env.payload()
    key = {"sys": env.origin.system, "ref": env.origin.ref, "rev": env.origin.rev, "sha": env.payload_sha256(),
           "aud": env.audience}
    if (dup := await _find(s, key)) is not None:
        return dup
    blobs, figures = await _attachments(s, env)
    prev = (await s.execute(text("""
        SELECT id FROM wiki_sources WHERE origin_system = :sys AND origin_ref = :ref AND status = 'active'
         ORDER BY received_at DESC LIMIT 1 FOR UPDATE
    """), {"sys": key["sys"], "ref": key["ref"]})).scalar()
    summary = _summary(env, payload)
    state = "queued" if ingest else "held" if consent and "suggested_audience" in consent else "new"
    new_id = (await s.execute(text("""
        INSERT INTO wiki_sources (kind, origin_system, origin_ref, origin_rev, origin_url, title, summary, payload,
                                  payload_sha256, blobs, subject_hints, audience, sensitivity, owner_user_id, owner_email,
                                  submitted_by, via, consent, captured_at, supersedes_id, ingest_state)
        VALUES (:kind, :sys, :ref, :rev, :url, :title, :summary, CAST(:payload AS jsonb), :sha, CAST(:blobs AS jsonb),
                CAST(:hints AS jsonb), CAST(:aud AS text[]), :sens,
                (SELECT id FROM users WHERE lower(email) = :owner ORDER BY created_at LIMIT 1), :owner,
                CAST(:by AS uuid), :via, CAST(:consent AS jsonb), :cap, CAST(:prev AS uuid), :state)
        ON CONFLICT (origin_system, origin_ref, (COALESCE(origin_rev, '')), payload_sha256, audience) DO NOTHING
        RETURNING id
    """), {
        **key, "kind": env.kind, "url": env.origin.url, "title": env.title, "summary": summary,
        "payload": json.dumps(payload, ensure_ascii=False), "blobs": json.dumps(blobs, ensure_ascii=False),
        "hints": json.dumps([h.model_dump(mode="json", exclude_none=True) for h in env.subject_hints], ensure_ascii=False),
        "aud": env.audience, "sens": env.sensitivity, "owner": owner_email, "by": str(caller["id"]),
        "via": _via(caller, env),
        "consent": json.dumps(consent, ensure_ascii=False) if consent else None,
        "cap": env.captured_at, "prev": str(prev) if prev else None, "state": state,
    })).scalar()
    if new_id is None:  # 같은 것이 동시에 들어와 먼저 커밋됐다
        await s.rollback()
        dup = await _find(s, key)
        if dup is None:
            raise RuntimeError("wiki_sources dedup conflict without a row")
        return dup
    new_id = str(new_id)
    if prev is not None:
        await s.execute(text("UPDATE wiki_sources SET status = 'superseded' WHERE id = :p"), {"p": prev})
    if ingest:
        await jobs.enqueue(s, "ingest", {"source_id": new_id}, created_by=str(caller["id"]))
    slug = await _free_slug(s, new_id)
    doc_payload = _doc_payload(env, payload, slug=slug, sid=short_id(new_id), summary=summary, owner_email=owner_email,
                               blobs=blobs, figures=figures)
    with audience.acting_as(audience.SYSTEM):
        # 원천 줄 · 작업 · 문서 · 범위 줄이 create_document 의 커밋 하나로 함께 들어간다.
        doc, _ = await document_service.create_document(s, payload=doc_payload, owner_id=str(caller["id"]),
                                                        wiki={"kind": "source", "audience": env.audience})
    await s.execute(text("UPDATE wiki_sources SET doc_id = CAST(:d AS uuid) WHERE id = CAST(:i AS uuid)"),
                    {"d": doc["id"], "i": new_id})
    await s.commit()
    return Received(id=new_id, dedup=False, doc_slug=slug, ingest_state=state)


# ── 원천 문서(SCHEMA-DRAFT §2 source — 요약 · 핵심 값 · 출처(자동) · 이 원천을 인용한 문서(자동)) ─────────────────────

def _ulid() -> str:
    return str(ulid.new())


def _summary(env: SourceEnvelope, payload: dict[str, Any]) -> str:
    field = _SUMMARY_FIELD.get(env.kind)
    value = payload.get(field) if field else None
    return (str(value) if value else env.title)[:500]


def _num(v: Any) -> str:
    if isinstance(v, bool):
        return "예" if v else "아니오"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _is_quantity(v: Any) -> bool:
    return isinstance(v, dict) and set(v) == {"value", "unit"}


def _cell(v: Any) -> str:
    if _is_quantity(v):
        return f"{_num(v['value'])} {v['unit']}"
    if isinstance(v, dict):
        return " · ".join(f"{k} {_cell(x)}" for k, x in v.items())
    if isinstance(v, list):
        return ", ".join(_cell(x) for x in v)
    return _num(v)


def _rows(path: str, v: Any, out: list[list[str]]) -> None:
    if isinstance(v, dict) and not _is_quantity(v):
        for k, x in v.items():
            _rows(f"{path}.{k}", x, out)
    elif v not in ([], {}, ""):
        out.append([path, _cell(v)])


def _block(kind: str, **kw: Any) -> dict[str, Any]:
    return {"type": kind, "id": _ulid(), **kw}


def _value_blocks(payload: dict[str, Any], skip: str | None) -> list[dict[str, Any]]:
    """본문을 표로 — 낱값은 '칸 · 값' 한 표에, 객체 목록(results · counts · votes …)은 목록마다 표 하나. 숫자는 원천 그대로."""
    rows: list[list[str]] = []
    tables: list[dict[str, Any]] = []
    for k, v in payload.items():
        if k == skip:
            continue
        if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
            headers = list(dict.fromkeys(h for x in v for h in x))
            tables.append(_block("table", caption=k, headers=headers,
                                 rows=[[_cell(x.get(h, "")) for h in headers] for x in v]))
        else:
            _rows(k, v, rows)
    return ([_block("table", headers=["칸", "값"], rows=rows)] if rows else []) + tables


def _origin_items(env: SourceEnvelope, sid: str, blobs: list[dict[str, Any]]) -> list[str]:
    o = env.origin
    items = [
        f"원천 — {sid} · {env.kind}",
        f"시스템 — {o.system} · {o.ref}" + (f" · 판 {o.rev}" if o.rev else ""),
        f"생긴 때 — {env.captured_at.astimezone(KST):%Y-%m-%d %H:%M} KST",
    ]
    if o.url:
        items.append(f"원본 — [{o.url}]({o.url})")
    items += [f"첨부 — {b['name']} ({b['mime']}, {b['bytes']:,} 바이트)" for b in blobs]
    items.append(f"민감도 — {env.sensitivity}")
    return items


def _section(title: str, blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {"id": _ulid(), "level": 1, "title": title, "blocks": blocks, "subsections": []}


def _doc_payload(
    env: SourceEnvelope, payload: dict[str, Any], *, slug: str, sid: str, summary: str, owner_email: str,
    blobs: list[dict[str, Any]], figures: list[tuple[str, str]],
) -> dict[str, Any]:
    sections = [
        _section("요약", [_block("paragraph", text=summary)]),
        _section("핵심 값", _value_blocks(payload, _SUMMARY_FIELD.get(env.kind))
                 or [_block("paragraph", text="표로 둘 값이 없는 원천이다.")]),
    ]
    if figures:
        sections.append(_section("그림", [_block("image", imageId=ref, caption=name[:500]) for ref, name in figures]))
    sections += [
        _section("출처", [_block("list", style="bullet", items=_origin_items(env, sid, blobs))]),
        _section("이 원천을 인용한 문서", [_block("paragraph", text="아직 이 원천을 인용한 문서가 없다.")]),
    ]
    return {
        "schema_version": "1.0", "id": _ulid(), "slug": slug, "title": env.title[:200], "summary": summary,
        "metadata": {"division": get_settings().import_default_division, "owners": [owner_email],
                     "confidentiality": env.sensitivity},
        "sections": sections,
    }


# ── 읽기 · 철회 ────────────────────────────────────────────────────────────────────────────────────

_COLS = """ws.id, ws.kind, ws.origin_system, ws.origin_ref, ws.origin_rev, ws.origin_url, ws.title, ws.summary,
           ws.audience, ws.sensitivity, ws.via, ws.captured_at, ws.received_at, ws.status, ws.ingest_state,
           ws.supersedes_id, d.slug, jsonb_array_length(ws.blobs),
           (ws.owner_user_id = CAST(:_aud_uid AS uuid) OR ws.owner_email = :_aud_email)"""


def _json(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _row(r: Any) -> dict[str, Any]:
    return {
        "id": str(r[0]), "short": short_id(str(r[0])), "kind": r[1],
        "origin": {"system": r[2], "ref": r[3], "rev": r[4], "url": r[5]},
        "title": r[6], "summary": r[7], "audience": list(r[8]), "sensitivity": r[9], "via": r[10],
        "captured_at": r[11].isoformat(), "received_at": r[12].isoformat(), "status": r[13], "ingest_state": r[14],
        "supersedes_id": str(r[15]) if r[15] else None, "doc_slug": r[16], "attachments": int(r[17]), "mine": bool(r[18]),
    }


async def list_sources(
    s: AsyncSession, *, kind: str | None = None, system: str | None = None, status: str | None = None,
    since: datetime | None = None, until: datetime | None = None, limit: int = 50, offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    where = [visible_sql("ws")]
    params: dict[str, Any] = audience.sql_params()
    for col, val in (("kind", kind), ("origin_system", system), ("status", status)):
        if val:
            where.append(f"ws.{col} = :{col}")
            params[col] = val
    if since:
        where.append("ws.received_at >= :since")
        params["since"] = since
    if until:
        where.append("ws.received_at < :until")
        params["until"] = until
    cond = " AND ".join(where)
    total = (await s.execute(text(f"SELECT COUNT(*) FROM wiki_sources ws WHERE {cond}"), params)).scalar_one()
    rows = (await s.execute(text(f"""
        SELECT {_COLS} FROM wiki_sources ws LEFT JOIN documents d ON d.id = ws.doc_id
         WHERE {cond} ORDER BY ws.received_at DESC LIMIT :limit OFFSET :offset
    """), {**params, "limit": limit, "offset": offset})).all()
    return [_row(r) for r in rows], int(total)


async def get_source(s: AsyncSession, source_id: str) -> dict[str, Any]:
    row = (await s.execute(text(f"""
        SELECT {_COLS}, ws.payload, ws.blobs, ws.subject_hints, ws.consent ->> 'mode'
          FROM wiki_sources ws LEFT JOIN documents d ON d.id = ws.doc_id
         WHERE ws.id = CAST(:id AS uuid) AND {visible_sql("ws")}
    """), {"id": source_id, **audience.sql_params()})).first()
    if row is None:
        raise NotFound(f"원천이 없다: {source_id}")
    return {**_row(row), "payload": _json(row[19]), "blobs": _json(row[20]), "subject_hints": _json(row[21]),
            "consent_mode": row[22]}


async def withdraw(s: AsyncSession, source_id: str, *, caller: dict[str, Any]) -> dict[str, Any]:
    """철회(주인 · admin) — 줄에 선 들이기를 거두고, 기록에 남기고, 원천 문서를 보관한다. 이미 철회됐으면 그대로."""
    viewer = audience.viewer_from_user(caller)
    row = (await s.execute(text(f"""
        SELECT ws.id, ws.title, ws.status, ws.audience, d.slug,
               (ws.owner_user_id = CAST(:_aud_uid AS uuid) OR ws.owner_email = :_aud_email)
          FROM wiki_sources ws LEFT JOIN documents d ON d.id = ws.doc_id
         WHERE ws.id = CAST(:id AS uuid) AND {visible_sql("ws")}
           FOR UPDATE OF ws
    """), {"id": source_id, **audience.sql_params(viewer)})).first()
    if row is None:
        raise NotFound(f"원천이 없다: {source_id}")
    is_owner = bool(row[5])
    if not (is_owner or viewer.is_admin):
        raise Forbidden("철회는 원천의 주인 · 관리자만 한다")
    if row[2] == "withdrawn":
        return {"id": source_id, "status": "withdrawn", "changed": False}
    await s.execute(text("""
        UPDATE wiki_sources
           SET status = 'withdrawn',
               ingest_state = CASE WHEN ingest_state IN ('new', 'queued', 'held') THEN 'skipped' ELSE ingest_state END
         WHERE id = CAST(:id AS uuid)
    """), {"id": source_id})
    cancelled = (await s.execute(text("""
        UPDATE wiki_jobs SET state = 'cancelled', finished_at = NOW()
         WHERE op = 'ingest' AND state = 'queued' AND args ->> 'source_id' = :id
        RETURNING id
    """), {"id": source_id})).all()
    await s.execute(text("""
        INSERT INTO wiki_log (op, title, detail, actor, audience)
        VALUES ('withdraw', :t, CAST(:d AS jsonb), :a, CAST(:aud AS text[]))
    """), {"t": f"{row[1]} ({short_id(source_id)})", "a": f"user:{viewer.user_id}", "aud": list(row[3]),
           "d": json.dumps({"source_id": source_id, "by": "owner" if is_owner else "admin",
                            "cancelled_jobs": len(cancelled)})})
    archived = False
    if row[4]:
        with audience.acting_as(audience.SYSTEM), contextlib.suppress(NotFound):
            await document_service.archive_document(s, slug=row[4], actor_id=str(viewer.user_id))  # 여기서 커밋
            archived = True
    if not archived:
        await s.commit()
    return {"id": source_id, "status": "withdrawn", "changed": True, "cancelled_jobs": len(cancelled)}


async def list_log(s: AsyncSession, *, limit: int = 100, since: datetime | None = None) -> list[dict[str, Any]]:
    """기록 — 범위 토큰을 모두 가진 줄만, 새것부터."""
    cond = "(CAST(:_aud_all AS boolean) OR l.audience <@ CAST(:_aud_tokens AS text[]))"
    params: dict[str, Any] = {**audience.sql_params(), "limit": limit}
    if since:
        cond += " AND l.at >= :since"
        params["since"] = since
    rows = (await s.execute(text(f"""
        SELECT l.id, l.at, l.op, l.title, l.detail, l.actor, l.job_id, l.changeset_id
          FROM wiki_log l WHERE {cond} ORDER BY l.id DESC LIMIT :limit
    """), params)).all()
    return [{"id": int(r[0]), "at": r[1].isoformat(), "op": r[2], "title": r[3], "detail": _json(r[4]) or {},
             "actor": r[5], "job_id": str(r[6]) if r[6] else None, "changeset_id": str(r[7]) if r[7] else None}
            for r in rows]


def log_markdown(entries: list[dict[str, Any]]) -> str:
    """Karpathy log.md 꼴(CONTRACTS §10) — 옛것부터, 한 작업 = `## [YYYY-MM-DD HH:MM] op | 제목` + 한 줄."""
    out: list[str] = []
    for e in sorted(entries, key=lambda e: e["id"]):
        at = datetime.fromisoformat(e["at"]).astimezone(KST)
        out.append(f"## [{at:%Y-%m-%d %H:%M}] {e['op']} | {e['title']}")
        if e["detail"]:
            out.append("- " + " · ".join(f"{k} {_cell(v)}" for k, v in e["detail"].items()))
    return "\n".join(out) + "\n" if out else ""


async def citations_for_doc(s: AsyncSession, doc_id: str) -> dict[str, list[dict[str, Any]]]:
    """블록 id → 근거들(읽는 사람이 볼 수 있는 원천만). 읽기 응답에 붙인다 — DocumentJSON 에는 넣지 않는다(CONTRACTS §2-3)."""
    rows = (await s.execute(text(f"""
        SELECT c.block_id, ws.id, ws.kind, ws.title, ws.origin_system, ws.origin_url, ws.captured_at, ws.status,
               c.locator, c.quote, d.slug
          FROM wiki_citations c JOIN wiki_sources ws ON ws.id = c.source_id LEFT JOIN documents d ON d.id = ws.doc_id
         WHERE c.doc_id = CAST(:d AS uuid) AND {visible_sql("ws")}
         ORDER BY c.block_id, ws.captured_at
    """), {"d": doc_id, **audience.sql_params()})).all()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r[0], []).append({
            "source_id": str(r[1]), "short": short_id(str(r[1])), "kind": r[2], "title": r[3], "system": r[4],
            "url": r[5], "captured_at": r[6].isoformat(), "status": r[7], "locator": _json(r[8]) or {}, "quote": r[9],
            "doc_slug": r[10],
        })
    return out


async def enqueue_ingest(s: AsyncSession, source_ids: list[str], *, caller: dict[str, Any]) -> list[dict[str, Any]]:
    """다시 들이기 — 보이고 활성인 원천만 작업을 줄 세운다(활성이 아니면 까닭과 함께 건너뛴다)."""
    out: list[dict[str, Any]] = []
    for source_id in source_ids:
        row = (await s.execute(text(f"SELECT ws.status FROM wiki_sources ws WHERE ws.id = CAST(:i AS uuid) AND {visible_sql('ws')}"),
                               {"i": source_id, **audience.sql_params()})).first()
        if row is None:
            raise NotFound(f"원천이 없다: {source_id}")
        if row[0] != "active":
            out.append({"id": source_id, "queued": False, "why": f"원천이 {row[0]}"})
            continue
        job_id = await jobs.enqueue(s, "ingest", {"source_id": source_id}, created_by=str(caller["id"]))
        await s.execute(text("UPDATE wiki_sources SET ingest_state = 'queued' WHERE id = CAST(:i AS uuid)"),
                        {"i": source_id})
        out.append({"id": source_id, "queued": True, "job_id": job_id})
    await s.commit()
    return out


async def page_info(s: AsyncSession, slug: str) -> dict[str, Any]:
    """위키 문서 한 장 — 종류 · 관리 · 범위 · 잠금 · 낡음 · 엔티티 + 블록별 근거 + 기대는 원천(문서 화면의 배지 · 각주 · 원천 카드)."""
    row = (await s.execute(text(f"""
        SELECT d.id, wp.kind, wp.managed, wp.audience, wp.review_lock, wp.stale_since, e.type_key, e.canonical_name
          FROM documents d JOIN wiki_pages wp ON wp.doc_id = d.id LEFT JOIN wiki_entities e ON e.id = wp.entity_id
         WHERE d.slug = :slug AND {audience.visible_sql("d")}
    """), {"slug": slug, **audience.sql_params()})).first()
    if row is None:
        raise NotFound(f"위키 문서가 아니다: {slug}")
    cites = await citations_for_doc(s, str(row[0]))
    seen: dict[str, dict[str, Any]] = {}
    for items in cites.values():
        for c in items:
            seen.setdefault(c["source_id"], {k: c[k] for k in ("source_id", "short", "kind", "title", "system", "url",
                                                                "captured_at", "status", "doc_slug")})
    return {"slug": slug, "kind": row[1], "managed": row[2], "audience": list(row[3]), "review_lock": bool(row[4]),
            "stale_since": row[5].isoformat() if row[5] else None,
            "entity": {"type_key": row[6], "name": row[7]} if row[6] else None, "citations": cites,
            "sources": sorted(seen.values(), key=lambda x: x["captured_at"])}
