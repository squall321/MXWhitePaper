"""Workflow chain runner (Cycle 18).

Runs an ordered sequence of automation actions for a single chain.
Each step either:

  - reuses an existing ``automation_rules`` row (``rule_id``), OR
  - pins an inline ``action_kind`` + ``action_payload``.

Per-step controls:

  - ``delay_seconds``  pause before running the step (capped at 300s)
  - ``fail_strategy``
      * ``halt``     — stop the chain on failure (default).
      * ``continue`` — log the failure, move to the next step.
      * ``rollback`` — stop and best-effort undo prior side effects.

Rollback is opt-in and only meaningful for the tag/transition actions —
``add_tag`` is reversed via ``remove_tag``, ``transition`` is reversed
back to the previous status that was captured before the step ran. All
other action_kinds are left untouched on rollback (best-effort).

This module is best-effort: it never raises into the caller. Failures
are persisted to ``workflow_chain_runs`` (status, steps_failed,
error_message) and logged.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_factory
from app.services import automation_dispatcher

logger = logging.getLogger(__name__)


# Hard ceiling on per-step sleep so a misconfigured chain can't pin a
# worker for hours.
DELAY_CAP_SECONDS = 300


VALID_FAIL_STRATEGIES: set[str] = {"halt", "continue", "rollback"}


def _parse_jsonb(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return {}
    return {}


# ── Rule loading ─────────────────────────────────────────────────────────


async def _load_rule(s: AsyncSession, rule_id: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text(
            """
            SELECT id, name, trigger_kind, trigger_filter,
                   action_kind, action_payload
            FROM automation_rules
            WHERE id = CAST(:r AS uuid)
            """
        ),
        {"r": rule_id},
    )).first()
    if not row:
        return None
    return {
        "id": str(row[0]),
        "name": row[1],
        "trigger_kind": row[2],
        "trigger_filter": _parse_jsonb(row[3]),
        "action_kind": row[4],
        "action_payload": _parse_jsonb(row[5]),
    }


async def _load_chain(
    s: AsyncSession, chain_id: str,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    chain_row = (await s.execute(
        text(
            """
            SELECT id, name, description, enabled, created_by
            FROM workflow_chains
            WHERE id = CAST(:c AS uuid)
            """
        ),
        {"c": chain_id},
    )).first()
    if not chain_row:
        return None, []
    chain = {
        "id": str(chain_row[0]),
        "name": chain_row[1],
        "description": chain_row[2],
        "enabled": bool(chain_row[3]),
        "created_by": str(chain_row[4]) if chain_row[4] else None,
    }
    step_rows = (await s.execute(
        text(
            """
            SELECT id, ordering, rule_id, action_kind, action_payload,
                   delay_seconds, fail_strategy
            FROM workflow_chain_steps
            WHERE chain_id = CAST(:c AS uuid)
            ORDER BY ordering ASC, id ASC
            """
        ),
        {"c": chain_id},
    )).all()
    steps = [
        {
            "id": str(r[0]),
            "ordering": int(r[1]),
            "rule_id": str(r[2]) if r[2] else None,
            "action_kind": r[3],
            "action_payload": _parse_jsonb(r[4]),
            "delay_seconds": int(r[5] or 0),
            "fail_strategy": r[6] or "halt",
        }
        for r in step_rows
    ]
    return chain, steps


# ── Run-log helpers ──────────────────────────────────────────────────────


async def _open_run(
    s: AsyncSession, *, chain_id: str, trigger_payload: dict[str, Any],
) -> int:
    row = (await s.execute(
        text(
            """
            INSERT INTO workflow_chain_runs
              (chain_id, trigger_payload, status)
            VALUES
              (CAST(:c AS uuid), CAST(:p AS jsonb), 'running')
            RETURNING id
            """
        ),
        {
            "c": chain_id,
            "p": json.dumps(trigger_payload, ensure_ascii=False),
        },
    )).first()
    await s.commit()
    return int(row[0])


async def _close_run(
    s: AsyncSession,
    *,
    run_id: int,
    status: str,
    steps_completed: int,
    steps_failed: int,
    error_message: str | None,
) -> None:
    await s.execute(
        text(
            """
            UPDATE workflow_chain_runs
            SET status = :st,
                steps_completed = :sc,
                steps_failed = :sf,
                finished_at = NOW(),
                error_message = :em
            WHERE id = :id
            """
        ),
        {
            "id": run_id,
            "st": status,
            "sc": steps_completed,
            "sf": steps_failed,
            "em": error_message,
        },
    )
    await s.commit()


# ── Rollback helpers ─────────────────────────────────────────────────────


async def _capture_pre_state(
    s: AsyncSession, *, action_kind: str, action_payload: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    """Snapshot just enough state to undo this action later if needed."""
    if action_kind == "transition":
        doc_id = payload.get("document_id")
        if not isinstance(doc_id, str):
            return None
        row = (await s.execute(
            text("SELECT status FROM documents WHERE id = CAST(:d AS uuid)"),
            {"d": doc_id},
        )).first()
        return {"prev_status": row[0]} if row else None
    if action_kind == "add_tag":
        return {"added_tag": action_payload.get("tag")}
    return None


async def _rollback_step(
    s: AsyncSession,
    *,
    action_kind: str,
    action_payload: dict[str, Any],
    payload: dict[str, Any],
    pre_state: dict[str, Any] | None,
) -> None:
    if action_kind == "transition" and pre_state and pre_state.get("prev_status"):
        await automation_dispatcher._action_transition(
            s,
            action_payload={"status": pre_state["prev_status"]},
            trigger_kind="rollback",
            payload=payload,
        )
    elif action_kind == "add_tag" and pre_state and pre_state.get("added_tag"):
        await automation_dispatcher._action_remove_tag(
            s,
            action_payload={"tag": pre_state["added_tag"]},
            trigger_kind="rollback",
            payload=payload,
        )
    # Other actions are not undoable.


# ── Step execution ───────────────────────────────────────────────────────


async def _run_step_action(
    s: AsyncSession,
    *,
    step: dict[str, Any],
    payload: dict[str, Any],
) -> tuple[str, str | None, str, dict[str, Any]]:
    """Execute a single step and return ``(status, error, action_kind,
    action_payload)``.

    ``status`` is one of ``ok | failed | skipped``. ``action_kind`` and
    ``action_payload`` are echoed back so the caller can drive rollback.
    """
    rule_id = step.get("rule_id")
    if rule_id:
        rule = await _load_rule(s, rule_id)
        if not rule:
            return "skipped", f"rule {rule_id} not found", "", {}
        action_kind = rule["action_kind"]
        action_payload = rule["action_payload"]
        trigger_kind = rule["trigger_kind"]
    else:
        action_kind = step.get("action_kind") or ""
        action_payload = step.get("action_payload") or {}
        trigger_kind = "chain"

    handler = automation_dispatcher._ACTIONS.get(action_kind)
    if handler is None:
        return (
            "skipped",
            f"unknown action_kind={action_kind}",
            action_kind,
            action_payload,
        )
    try:
        status, err = await handler(
            s,
            action_payload=action_payload,
            trigger_kind=trigger_kind,
            payload=payload,
        )
        return status, err, action_kind, action_payload
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "chain step action %s failed: %s", action_kind, e,
        )
        return "failed", f"{type(e).__name__}: {e}", action_kind, action_payload


# ── Public entrypoint ────────────────────────────────────────────────────


async def run_chain(
    chain_id: str,
    trigger_payload: dict[str, Any] | None = None,
    *,
    sleep: Any = None,
) -> dict[str, Any]:
    """Run a chain end-to-end.

    Returns a dict with ``run_id``, ``status``, ``steps_completed``,
    ``steps_failed``, ``error_message`` (best-effort — even on internal
    errors the chain run row is finalized).
    """
    payload = trigger_payload or {}
    sleep_fn = sleep or asyncio.sleep

    sf = session_factory()
    async with sf() as s:
        chain, steps = await _load_chain(s, chain_id)
        if not chain:
            return {
                "run_id": None,
                "status": "failed",
                "steps_completed": 0,
                "steps_failed": 0,
                "error_message": "chain not found",
            }
        if not chain["enabled"]:
            return {
                "run_id": None,
                "status": "failed",
                "steps_completed": 0,
                "steps_failed": 0,
                "error_message": "chain disabled",
            }
        run_id = await _open_run(
            s, chain_id=chain_id, trigger_payload=payload,
        )

    completed = 0
    failed = 0
    overall_status = "ok"
    overall_err: str | None = None
    # Stack of (action_kind, action_payload, pre_state) so rollback
    # can unwind in reverse insertion order.
    rollback_stack: list[tuple[str, dict[str, Any], dict[str, Any] | None]] = []

    for step in steps:
        delay = max(0, min(int(step.get("delay_seconds") or 0), DELAY_CAP_SECONDS))
        if delay > 0:
            try:
                await sleep_fn(delay)
            except Exception:  # noqa: BLE001 — never break the chain
                pass

        sf2 = session_factory()
        async with sf2() as s2:
            # Capture pre-state for rollback BEFORE running the action.
            # Done in a separate session so a later commit-in-handler
            # does not pollute it.
            pre_state: dict[str, Any] | None = None
            if step.get("fail_strategy") == "rollback":
                ak_for_pre = step.get("action_kind") or ""
                ap_for_pre = step.get("action_payload") or {}
                if step.get("rule_id"):
                    rule = await _load_rule(s2, step["rule_id"])
                    if rule:
                        ak_for_pre = rule["action_kind"]
                        ap_for_pre = rule["action_payload"]
                try:
                    pre_state = await _capture_pre_state(
                        s2,
                        action_kind=ak_for_pre,
                        action_payload=ap_for_pre,
                        payload=payload,
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning("pre-state capture failed: %s", e)
                    pre_state = None

            status, err, action_kind, action_payload = await _run_step_action(
                s2, step=step, payload=payload,
            )
            try:
                await s2.commit()
            except Exception:  # noqa: BLE001
                pass

        if status == "ok":
            completed += 1
            rollback_stack.append((action_kind, action_payload, pre_state))
            continue

        # Failure or skip-as-failure path.
        failed += 1
        strategy = step.get("fail_strategy") or "halt"

        if strategy == "continue":
            # Log + keep going; final status reflects there were failures
            # but the chain itself didn't halt.
            overall_err = err or overall_err
            continue

        if strategy == "rollback":
            overall_err = err or "step failed; rolling back"
            sf3 = session_factory()
            async with sf3() as s3:
                for ak, ap, ps in reversed(rollback_stack):
                    try:
                        await _rollback_step(
                            s3,
                            action_kind=ak,
                            action_payload=ap,
                            payload=payload,
                            pre_state=ps,
                        )
                    except Exception as e:  # noqa: BLE001
                        logger.warning("rollback step failed: %s", e)
                try:
                    await s3.commit()
                except Exception:  # noqa: BLE001
                    pass
            overall_status = "rolled_back"
            break

        # halt
        overall_err = err or "step failed"
        overall_status = "failed"
        break

    if overall_status == "ok" and failed > 0:
        # ``continue`` strategy reached the end with at least one failure.
        overall_status = "failed"
        if overall_err is None:
            overall_err = f"{failed} step(s) failed (continue strategy)"

    sf4 = session_factory()
    async with sf4() as s4:
        await _close_run(
            s4,
            run_id=run_id,
            status=overall_status,
            steps_completed=completed,
            steps_failed=failed,
            error_message=overall_err,
        )

    return {
        "run_id": run_id,
        "status": overall_status,
        "steps_completed": completed,
        "steps_failed": failed,
        "error_message": overall_err,
    }
