"""Retention runner — time-driven document janitor (Cycle 0027).

Per-process scheduler analogous to `backup_runner.backup_ticker`
(Cycle 0015). Every hour it pulls ``retention_policies`` rows whose
``next_run_at <= now()`` and ``enabled = true`` and applies their action
to every document whose ``trigger_field`` is older than
``trigger_age_days``.

Sits beside ``automation_dispatcher`` (Cycle 0025) which is event-driven —
this one is time-driven (a doc that simply *sits* hits a policy without any
event firing).

NOTE — single-replica only.
    Same caveat as `backup_runner` — multiple replicas would cause the same
    policy to fire concurrently. Production multi-replica should swap for
    Celery beat / k8s CronJob.

Action semantics
================

  - ``archive``: ``UPDATE documents SET status = 'archived'`` and audit
    log a row per doc. Idempotent — already-archived docs are skipped.
  - ``notify_owner``: insert a ``notifications`` row of kind
    ``retention_warning`` for ``documents.owner_id`` per matched doc.
  - ``transition``: ``UPDATE documents SET status =
    action_payload.target_status`` (must be one of the canonical 5 statuses).

A run advances ``last_run_at = NOW()`` and ``next_run_at = NOW() + 24h``
regardless of success — a poison policy doesn't loop.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_scope
from app.repos import document_repo

logger = logging.getLogger(__name__)


TICK_INTERVAL_SECONDS = 3600  # 1 hour
NEXT_RUN_INTERVAL_HOURS = 24

VALID_ACTIONS: set[str] = {"archive", "notify_owner", "transition"}
VALID_TRIGGER_FIELDS: set[str] = {"updated_at", "last_read_at", "created_at"}
VALID_STATUSES: set[str] = {
    "draft", "in_review", "approved", "published", "archived",
}

# Cap doc_slugs JSONB list at 100 entries (per mandate).
MAX_LOGGED_SLUGS = 100


# ── Helpers ──────────────────────────────────────────────────────────────


def _parse_jsonb(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return {}
    return {}


# ── Document selection ───────────────────────────────────────────────────


async def find_matching_docs(
    s: AsyncSession,
    *,
    trigger_field: str,
    trigger_age_days: int,
    scope_filter: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return docs whose ``trigger_field`` is older than the threshold and
    that match all keys in ``scope_filter``.

    Scope filter keys: ``part_id``, ``tag``, ``status``, ``owner_id``.
    Unknown keys are silently ignored.

    For ``last_read_at`` we use the latest ``document_reads.read_at`` per
    doc, falling back to ``documents.created_at`` for never-read docs.
    """
    if trigger_field not in VALID_TRIGGER_FIELDS:
        return []

    where: list[str] = []
    # asyncpg refuses int → text casts, pass days as a string and let
    # Postgres CAST(... AS text) be a no-op.
    params: dict[str, Any] = {"days": str(int(trigger_age_days))}

    if trigger_field == "last_read_at":
        # NULL last read = never read. Use COALESCE(read, created_at).
        where.append(
            "COALESCE("
            "  (SELECT MAX(read_at) FROM document_reads dr "
            "   WHERE dr.document_id = d.id), "
            "  d.created_at"
            ") < NOW() - (CAST(:days AS text) || ' days')::interval"
        )
    else:
        # updated_at / created_at — direct column compare.
        col = "d.updated_at" if trigger_field == "updated_at" else "d.created_at"
        where.append(
            f"{col} < NOW() - (CAST(:days AS text) || ' days')::interval"
        )

    sf = scope_filter or {}
    if isinstance(sf.get("part_id"), str) and sf["part_id"]:
        where.append("d.part_id = CAST(:part_id AS uuid)")
        params["part_id"] = sf["part_id"]
    if isinstance(sf.get("status"), str) and sf["status"]:
        where.append("d.status = :status")
        params["status"] = sf["status"]
    if isinstance(sf.get("owner_id"), str) and sf["owner_id"]:
        where.append("d.owner_id = CAST(:owner_id AS uuid)")
        params["owner_id"] = sf["owner_id"]
    if isinstance(sf.get("tag"), str) and sf["tag"]:
        # JSONB tag containment — content_json->metadata->tags is a JSON array.
        where.append(
            "(d.content_json -> 'metadata' -> 'tags') @> CAST(:tag AS jsonb)"
        )
        params["tag"] = json.dumps([sf["tag"]])

    sql = (
        "SELECT d.id, d.slug, d.status, d.owner_id "
        "FROM documents d "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY d.updated_at ASC "
        "LIMIT 5000"
    )
    rows = (await s.execute(text(sql), params)).all()
    return [
        {
            "id": str(r[0]),
            "slug": r[1],
            "status": r[2],
            "owner_id": str(r[3]) if r[3] else None,
        }
        for r in rows
    ]


# ── Action handlers ──────────────────────────────────────────────────────


async def _apply_archive(
    s: AsyncSession,
    *,
    docs: list[dict[str, Any]],
    policy_id: str,
) -> list[str]:
    """Archive every doc that isn't already archived. Returns affected slugs."""
    touched: list[str] = []
    for doc in docs:
        if doc["status"] == "archived":
            continue
        await s.execute(
            text(
                "UPDATE documents SET status = 'archived', updated_at = NOW() "
                "WHERE id = CAST(:id AS uuid) AND status != 'archived'"
            ),
            {"id": doc["id"]},
        )
        await document_repo.insert_audit(
            s,
            user_id=None,
            action="retention.archive",
            target=f"document:{doc['slug']}",
            payload={"policy_id": policy_id, "from": doc["status"]},
        )
        touched.append(doc["slug"])
    return touched


async def _apply_notify_owner(
    s: AsyncSession,
    *,
    docs: list[dict[str, Any]],
    policy_id: str,
    policy_name: str,
) -> list[str]:
    """Insert one notifications row per doc for its owner."""
    touched: list[str] = []
    for doc in docs:
        if not doc["owner_id"]:
            continue
        body = json.dumps(
            {
                "policy_id": policy_id,
                "policy_name": policy_name,
                "slug": doc["slug"],
                "document_id": doc["id"],
            },
            ensure_ascii=False,
        )
        await s.execute(
            text(
                "INSERT INTO notifications (user_id, kind, payload) "
                "VALUES (CAST(:u AS uuid), 'retention_warning', "
                "        CAST(:p AS jsonb))"
            ),
            {"u": doc["owner_id"], "p": body},
        )
        touched.append(doc["slug"])
    return touched


async def _apply_transition(
    s: AsyncSession,
    *,
    docs: list[dict[str, Any]],
    policy_id: str,
    target_status: str,
) -> list[str]:
    if target_status not in VALID_STATUSES:
        raise ValueError(f"target_status invalid: {target_status!r}")
    touched: list[str] = []
    for doc in docs:
        if doc["status"] == target_status:
            continue
        await s.execute(
            text(
                "UPDATE documents SET status = :st, updated_at = NOW() "
                "WHERE id = CAST(:id AS uuid) AND status != :st"
            ),
            {"st": target_status, "id": doc["id"]},
        )
        await document_repo.insert_audit(
            s,
            user_id=None,
            action="retention.transition",
            target=f"document:{doc['slug']}",
            payload={
                "policy_id": policy_id,
                "from": doc["status"],
                "to": target_status,
            },
        )
        touched.append(doc["slug"])
    return touched


# ── Run a single policy ──────────────────────────────────────────────────


async def run_policy(
    s: AsyncSession,
    *,
    policy: dict[str, Any],
    dry_run: bool = False,
) -> dict[str, Any]:
    """Execute one policy. Returns ``{status, affected_doc_count, doc_slugs}``.

    On ``dry_run=True`` no writes happen — we return the prospective slug
    list (capped at MAX_LOGGED_SLUGS) and a ``status='dry_run'`` row is
    written to ``retention_runs``.
    """
    docs = await find_matching_docs(
        s,
        trigger_field=policy["trigger_field"],
        trigger_age_days=int(policy["trigger_age_days"]),
        scope_filter=policy.get("scope_filter") or {},
    )

    affected: list[str] = []
    error: str | None = None

    if dry_run:
        affected = [d["slug"] for d in docs]
        status = "dry_run"
    else:
        action = policy["action"]
        try:
            if action == "archive":
                affected = await _apply_archive(
                    s, docs=docs, policy_id=policy["id"],
                )
            elif action == "notify_owner":
                affected = await _apply_notify_owner(
                    s,
                    docs=docs,
                    policy_id=policy["id"],
                    policy_name=policy.get("name") or "",
                )
            elif action == "transition":
                ap = policy.get("action_payload") or {}
                target = ap.get("target_status") or ap.get("status")
                if not isinstance(target, str):
                    raise ValueError(
                        "action_payload.target_status required for transition"
                    )
                affected = await _apply_transition(
                    s, docs=docs, policy_id=policy["id"], target_status=target,
                )
            else:
                raise ValueError(f"unknown action: {action!r}")
            status = "ok"
        except Exception as e:
            logger.exception("retention policy %s failed", policy["id"])
            error = f"{type(e).__name__}: {e}"
            status = "failed"

    capped_slugs = affected[:MAX_LOGGED_SLUGS]
    await s.execute(
        text(
            """
            INSERT INTO retention_runs
              (policy_id, affected_doc_count, status,
               error_message, doc_slugs)
            VALUES
              (CAST(:pid AS uuid), :n, :s, :em, CAST(:slugs AS jsonb))
            """
        ),
        {
            "pid": policy["id"],
            "n": len(affected),
            "s": status,
            "em": error,
            "slugs": json.dumps(capped_slugs),
        },
    )
    await s.commit()
    return {
        "status": status,
        "affected_doc_count": len(affected),
        "doc_slugs": capped_slugs,
        "error_message": error,
    }


# ── Tick: pull due policies and run them ─────────────────────────────────


def compute_next_run(after: datetime | None = None) -> datetime:
    """Return now + 24h. Constant cadence — see module docstring."""
    base = after or datetime.now(UTC)
    return base + timedelta(hours=NEXT_RUN_INTERVAL_HOURS)


async def tick_once() -> int:
    """One scheduler pass. Returns the number of policies executed."""
    now = datetime.now(UTC)
    executed = 0

    async with session_scope() as s:
        rows = (await s.execute(
            text(
                """
                SELECT id, name, scope_filter, action, action_payload,
                       trigger_age_days, trigger_field
                FROM retention_policies
                WHERE enabled = TRUE
                  AND (next_run_at IS NULL OR next_run_at <= :now)
                ORDER BY next_run_at NULLS FIRST
                LIMIT 50
                """
            ),
            {"now": now},
        )).all()
        due = [
            {
                "id": str(r[0]),
                "name": r[1],
                "scope_filter": _parse_jsonb(r[2]),
                "action": r[3],
                "action_payload": _parse_jsonb(r[4]),
                "trigger_age_days": int(r[5]),
                "trigger_field": r[6],
            }
            for r in rows
        ]

    for policy in due:
        async with session_scope() as s:
            try:
                await run_policy(s, policy=policy, dry_run=False)
                executed += 1
            except Exception:
                logger.exception(
                    "retention policy %s tick crashed", policy["id"]
                )
            # Always advance schedule — even on crash — so we don't loop.
            nxt = compute_next_run()
            await s.execute(
                text(
                    """
                    UPDATE retention_policies
                    SET last_run_at = NOW(), next_run_at = :nxt
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {"nxt": nxt, "id": policy["id"]},
            )
            await s.commit()

    return executed


async def retention_ticker() -> None:
    """Long-running asyncio task. Spawned from app.main lifespan."""
    logger.info("retention_ticker started")
    while True:
        try:
            await tick_once()
        except Exception:
            logger.exception("retention tick failed")
        from app.services.ticker_state import report_tick as _rt; _rt("retention", next_due_at=datetime.now(UTC) + timedelta(seconds=TICK_INTERVAL_SECONDS))
        await asyncio.sleep(TICK_INTERVAL_SECONDS)
