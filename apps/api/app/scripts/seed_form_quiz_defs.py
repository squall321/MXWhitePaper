"""Lift form + quiz definitions from samples 11 / 13 into DB tables.

Walks every sample JSON, finds form / quiz blocks, upserts the
definition into form_definitions / quiz_definitions plus the per-
question rows. Idempotent.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from sqlalchemy import text

from app.core.db import session_scope


SAMPLES_DIR = Path("/workspace/packages/shared/samples")
if not SAMPLES_DIR.exists():
    SAMPLES_DIR = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"


def _walk_blocks(sections):
    for s in sections:
        for b in s.get("blocks", []):
            yield b
        yield from _walk_blocks(s.get("subsections") or [])


async def _seed_forms(s):
    n = 0
    for sample in sorted(SAMPLES_DIR.glob("*.json")):
        doc = json.loads(sample.read_text(encoding="utf-8"))
        slug = doc.get("slug") or doc.get("id")
        for blk in _walk_blocks(doc.get("sections", [])):
            if blk.get("type") != "form":
                continue
            fid = f"{slug}::{blk['id']}"
            await s.execute(
                text("""
                    INSERT INTO form_definitions
                      (id, title, description, submit_label, thanks_text, max_attempts)
                    VALUES (:id, :title, :desc, :sl, :tx, :mx)
                    ON CONFLICT (id) DO UPDATE
                      SET title=EXCLUDED.title, description=EXCLUDED.description,
                          submit_label=EXCLUDED.submit_label,
                          thanks_text=EXCLUDED.thanks_text,
                          max_attempts=EXCLUDED.max_attempts
                """),
                {"id": fid, "title": blk.get("title", ""),
                 "desc": blk.get("description"), "sl": blk.get("submit_label"),
                 "tx": blk.get("thanks_message"), "mx": blk.get("max_attempts")},
            )
            # wipe + reinsert fields
            await s.execute(text("DELETE FROM form_fields WHERE form_id = :id"), {"id": fid})
            for i, q in enumerate(blk.get("questions", [])):
                opts = q.get("options")
                await s.execute(
                    text("""
                        INSERT INTO form_fields
                          (form_id, question_id, kind, label, required, placeholder, options, sort_order)
                        VALUES (:fid, :qid, :kind, :label, :req, :ph, :opts, :sort)
                    """),
                    {"fid": fid, "qid": q["id"], "kind": q["kind"],
                     "label": q["label"], "req": bool(q.get("required")),
                     "ph": q.get("placeholder"),
                     "opts": json.dumps(opts) if opts is not None else None,
                     "sort": i},
                )
            n += 1
    return n


async def _seed_quizzes(s):
    n = 0
    for sample in sorted(SAMPLES_DIR.glob("*.json")):
        doc = json.loads(sample.read_text(encoding="utf-8"))
        slug = doc.get("slug") or doc.get("id")
        for blk in _walk_blocks(doc.get("sections", [])):
            if blk.get("type") != "quiz":
                continue
            qid = f"{slug}::{blk['id']}"
            await s.execute(
                text("""
                    INSERT INTO quiz_definitions
                      (id, title, description, passing_score, max_attempts)
                    VALUES (:id, :title, :desc, :ps, :mx)
                    ON CONFLICT (id) DO UPDATE
                      SET title=EXCLUDED.title, description=EXCLUDED.description,
                          passing_score=EXCLUDED.passing_score,
                          max_attempts=EXCLUDED.max_attempts
                """),
                {"id": qid, "title": blk.get("title", ""),
                 "desc": blk.get("description"),
                 "ps": blk.get("passing_score"),
                 "mx": blk.get("max_attempts")},
            )
            await s.execute(text("DELETE FROM quiz_questions WHERE quiz_id = :id"), {"id": qid})
            for i, q in enumerate(blk.get("questions", [])):
                await s.execute(
                    text("""
                        INSERT INTO quiz_questions
                          (quiz_id, question_id, kind, label, options, correct, explanation, points, sort_order)
                        VALUES (:qid, :id, :kind, :label, :opts, :correct, :expl, :pts, :sort)
                    """),
                    {"qid": qid, "id": q["id"], "kind": q["kind"],
                     "label": q["label"],
                     "opts": json.dumps(q.get("options")) if q.get("options") is not None else None,
                     "correct": json.dumps(q.get("correct_answer") or q.get("correct")),
                     "expl": q.get("explanation"),
                     "pts": q.get("points", 1), "sort": i},
                )
            n += 1
    return n


async def _amain() -> int:
    async with session_scope() as s:
        n_forms = await _seed_forms(s)
        n_quizzes = await _seed_quizzes(s)
        await s.commit()
    print(f"✓ form_definitions  : {n_forms} forms")
    print(f"✓ quiz_definitions  : {n_quizzes} quizzes")
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    import sys
    sys.exit(main())
