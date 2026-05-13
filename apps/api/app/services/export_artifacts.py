"""Persist generated export bytes to MinIO + record in export_artifacts.

Called by exports.py after a successful render. Returns the new
artifact row's id so the response can include a download link.

MinIO key convention:
    exports/{doc_slug}/{export_id}.{ext}

The bucket is the same `MINIO_BUCKET_FILES` used for regular file
attachments (or a dedicated bucket if set via env). Idempotent —
each call produces a new artifact id; old artifacts are not
mutated, allowing audit / re-download of any past version.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.storage.minio_adapter import internal_client


_EXTENSION_MIME = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf":  "application/pdf",
    "md":   "text/markdown; charset=utf-8",
    "html": "text/html; charset=utf-8",
}


def _bucket() -> str:
    """Bucket exports live in. Defaults to the files bucket unless a
    dedicated `MINIO_BUCKET_EXPORTS` env is set, in which case we honour
    that — useful when ops wants a tighter retention/ACL on rendered
    artefacts than on user-uploaded attachments."""
    s = get_settings()
    return s.minio_bucket_exports.strip() or s.minio_bucket_files


async def save_artifact(
    s: AsyncSession,
    *,
    doc_id: str | uuid.UUID,
    doc_slug: str,
    doc_version: int,
    fmt: str,
    file_bytes: bytes,
    actor_id: str | uuid.UUID,
    filename: str | None = None,
) -> dict[str, Any]:
    """Save export bytes to MinIO + insert export_artifacts row.

    Returns dict with id / minio_key / filename / size_bytes.
    """
    if fmt not in _EXTENSION_MIME:
        raise ValueError(f"unsupported export format: {fmt!r}")

    artifact_id = str(uuid.uuid4())
    safe_filename = filename or f"{doc_slug}.{fmt}"
    minio_key = f"exports/{doc_slug}/{artifact_id}.{fmt}"
    mime = _EXTENSION_MIME[fmt]
    size = len(file_bytes)

    # Upload to MinIO (bucket should exist from setup_buckets).
    client = internal_client()
    client.put_object(
        Bucket=_bucket(),
        Key=minio_key,
        Body=file_bytes,
        ContentType=mime,
        Metadata={
            "slug": doc_slug,
            "format": fmt,
            "doc_version": str(doc_version),
        },
    )

    # Record in DB.
    await s.execute(
        text("""
            INSERT INTO export_artifacts
              (id, doc_id, slug, format, filename, mime_type, size_bytes,
               minio_key, doc_version, created_by)
            VALUES
              (CAST(:id AS uuid), CAST(:doc_id AS uuid), :slug, :format, :filename,
               :mime, :size, :key, :ver, CAST(:user AS uuid))
        """),
        {
            "id": artifact_id, "doc_id": str(doc_id), "slug": doc_slug,
            "format": fmt, "filename": safe_filename, "mime": mime,
            "size": size, "key": minio_key, "ver": doc_version,
            "user": str(actor_id),
        },
    )

    return {
        "id": artifact_id,
        "minio_key": minio_key,
        "filename": safe_filename,
        "size_bytes": size,
        "mime_type": mime,
    }


async def list_artifacts_for(
    s: AsyncSession, *, slug: str, fmt: str | None = None, limit: int = 50,
) -> list[dict[str, Any]]:
    where = "WHERE slug = :slug"
    params: dict[str, Any] = {"slug": slug, "lim": limit}
    if fmt:
        where += " AND format = :format"
        params["format"] = fmt
    rows = (await s.execute(
        text(f"""
            SELECT id, slug, format, filename, mime_type, size_bytes,
                   doc_version, created_by, created_at
              FROM export_artifacts
              {where}
              ORDER BY created_at DESC
              LIMIT :lim
        """),
        params,
    )).mappings().all()
    return [
        {
            "id": str(r["id"]),
            "slug": r["slug"],
            "format": r["format"],
            "filename": r["filename"],
            "mime_type": r["mime_type"],
            "size_bytes": int(r["size_bytes"]),
            "doc_version": int(r["doc_version"]),
            "created_by": str(r["created_by"]),
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


async def get_artifact_bytes(
    s: AsyncSession, *, artifact_id: str,
) -> tuple[dict[str, Any], bytes]:
    """Fetch one artifact row + its MinIO body. Raises if not found."""
    from fastapi import HTTPException
    row = (await s.execute(
        text("""
            SELECT id, slug, format, filename, mime_type, size_bytes,
                   minio_key, doc_version
              FROM export_artifacts
             WHERE id = CAST(:id AS uuid)
        """),
        {"id": artifact_id},
    )).mappings().first()
    if not row:
        raise HTTPException(404, detail={"error": "artifact_not_found", "id": artifact_id})

    client = internal_client()
    obj = client.get_object(Bucket=_bucket(), Key=row["minio_key"])
    body = obj["Body"].read()
    return (
        {
            "id": str(row["id"]), "slug": row["slug"], "format": row["format"],
            "filename": row["filename"], "mime_type": row["mime_type"],
            "size_bytes": int(row["size_bytes"]), "doc_version": int(row["doc_version"]),
        },
        body,
    )
