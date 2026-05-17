"""Seed launch_tasks / launch_timeline / demand_forecast for the
Galaxy Flip 2026 product launch sample (sample 06).
"""
from __future__ import annotations

import asyncio
from datetime import date

from sqlalchemy import text

from app.core.db import session_scope

PROGRAM = "galaxy-flip-2026"

# Multiple launch programs. Each gets the same TASKS / TIMELINE / FORECAST
# shape but different values — demonstrates `program_slug` partitioning.
PROGRAMS = ["galaxy-flip-2026", "galaxy-watch-2026", "galaxy-buds-2026"]


TASKS = [
    # (task, start, end, progress%, owner, sort)
    ("기획 확정",      date(2026, 1,  6), date(2026, 1, 31),  100, "PM",       1),
    ("디자인 finalize", date(2026, 1, 20), date(2026, 2, 28),   88, "Design",   2),
    ("HW 시제품",      date(2026, 2,  1), date(2026, 4, 10),   72, "HW Eng",   3),
    ("SW 통합 테스트",  date(2026, 3,  1), date(2026, 4, 30),   55, "SW Eng",   4),
    ("Unpacked 공개",  date(2026, 5, 10), date(2026, 5, 10),    0, "PR",       5),
    ("출시",          date(2026, 6,  1), date(2026, 6,  1),    0, "Sales",    6),
]


TIMELINE = [
    # (week_label, activity, owner, deliverable, sort)
    ("W-6", "Press kit 작성",       "PR",    "보도자료 v1",                  1),
    ("W-5", "리테일 트레이닝",        "Sales", "교육 자료 + 평가",              2),
    ("W-4", "Pre-order 페이지 오픈",  "Web",   "랜딩 페이지 launch",            3),
    ("W-2", "Unpacked 리허설",      "PR",    "리허설 영상 + 큐시트",          4),
    ("W0",  "Unpacked 공개",        "All",   "라이브 스트리밍 + 실물 시연",   5),
]


# (quarter, scenario, units in 1000s)
FORECAST = [
    ("2026-Q3", "baseline", 850),
    ("2026-Q3", "bull",     1100),
    ("2026-Q3", "bear",     620),
    ("2026-Q4", "baseline", 1200),
    ("2026-Q4", "bull",     1550),
    ("2026-Q4", "bear",     900),
    ("2027-Q1", "baseline", 980),
    ("2027-Q1", "bull",     1280),
    ("2027-Q1", "bear",     740),
    ("2027-Q2", "baseline", 760),
    ("2027-Q2", "bull",     1000),
    ("2027-Q2", "bear",     560),
    ("2027-Q3", "baseline", 640),
    ("2027-Q3", "bull",     860),
    ("2027-Q3", "bear",     460),
]


async def _seed_program(s, program: str, scale: float) -> None:
    """Insert TASKS / TIMELINE / FORECAST for one program, multiplying
    numeric values by `scale` so each program has distinct numbers."""
    await s.execute(text("DELETE FROM launch_tasks WHERE program_slug = :p"), {"p": program})
    for task, sd, ed, pct, owner, sort in TASKS:
        await s.execute(
            text("""
                INSERT INTO launch_tasks
                  (program_slug, task, start_date, end_date, progress_pct, owner, sort_order)
                VALUES (:p, :task, :sd, :ed, :pct, :owner, :sort)
            """),
            {"p": program, "task": task, "sd": sd, "ed": ed,
             "pct": min(100.0, pct * scale), "owner": owner, "sort": sort},
        )

    await s.execute(text("DELETE FROM launch_timeline WHERE program_slug = :p"), {"p": program})
    for week, activity, owner, deliverable, sort in TIMELINE:
        await s.execute(
            text("""
                INSERT INTO launch_timeline
                  (program_slug, week_label, activity, owner, deliverable, sort_order)
                VALUES (:p, :w, :a, :o, :d, :sort)
            """),
            {"p": program, "w": week, "a": activity,
             "o": owner, "d": deliverable, "sort": sort},
        )

    await s.execute(text("DELETE FROM demand_forecast WHERE program_slug = :p"), {"p": program})
    for q, scen, units in FORECAST:
        await s.execute(
            text("""
                INSERT INTO demand_forecast (program_slug, quarter, scenario, units)
                VALUES (:p, :q, :s, :u)
            """),
            {"p": program, "q": q, "s": scen, "u": round(units * scale, 1)},
        )


async def _amain() -> int:
    # Each program a different scale so totals differ across products.
    scales = {"galaxy-flip-2026": 1.0, "galaxy-watch-2026": 0.6, "galaxy-buds-2026": 1.4}
    async with session_scope() as s:
        for prog in PROGRAMS:
            await _seed_program(s, prog, scales.get(prog, 1.0))
        await s.commit()
    print(f"✓ launch facts seeded: {len(PROGRAMS)} programs × "
          f"({len(TASKS)} tasks + {len(TIMELINE)} timeline + {len(FORECAST)} forecast)")
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    import sys
    sys.exit(main())
