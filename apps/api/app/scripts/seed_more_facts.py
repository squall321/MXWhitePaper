"""Seed cohort_retention / funnel_metrics / audit_summary_daily /
incidents_log / marketing_campaigns. Deterministic, idempotent."""
from __future__ import annotations

import asyncio
import math
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from app.core.db import session_scope


COHORTS = [
    ("2025-Q4", [(0,100),(1,72),(7,52),(14,41),(30,33),(60,28),(90,24)]),
    ("2026-Q1", [(0,100),(1,78),(7,58),(14,46),(30,38),(60,32),(90,28)]),
    ("2026-Q2", [(0,100),(1,82),(7,63),(14,52),(30,44),(60,37),(90,32)]),
]

FUNNEL = [
    ("signup", "방문", 12450, 1),
    ("signup", "가입 시작", 7820, 2),
    ("signup", "가입 완료", 5430, 3),
    ("signup", "첫 활동", 3210, 4),
    ("signup", "30일 잔존", 1980, 5),
]

INCIDENTS = [
    ("INC-2026-001", "P2", "resolved",   "로그인 지연 (5xx 1.2%)",       "SRE",        58,  datetime(2026,4,3,9,12, tzinfo=timezone.utc), datetime(2026,4,3,10,10,tzinfo=timezone.utc)),
    ("INC-2026-002", "P1", "resolved",   "결제 게이트웨이 timeout 다발", "Payments",   142, datetime(2026,4,15,3,40,tzinfo=timezone.utc), datetime(2026,4,15,6,2, tzinfo=timezone.utc)),
    ("INC-2026-003", "P3", "mitigated",  "검색 인덱스 지연",             "Search",     35,  datetime(2026,4,22,14,5,tzinfo=timezone.utc), datetime(2026,4,22,14,40,tzinfo=timezone.utc)),
    ("INC-2026-004", "P2", "resolved",   "이미지 업로드 실패율 상승",     "Platform",   72,  datetime(2026,5,1,11,30,tzinfo=timezone.utc), datetime(2026,5,1,12,42,tzinfo=timezone.utc)),
    ("INC-2026-005", "P4", "open",       "관리자 페이지 표시 깨짐",       "FE-Admin",   None,datetime(2026,5,10,16,0,tzinfo=timezone.utc), None),
]

CAMPAIGNS = [
    ("CAMP-FLIP-2026-PRE",   "Galaxy Flip 사전 예약",    "active", 1_240_000, 184_500, 18_400, 95_000.00,  date(2026,4,15),  None),
    ("CAMP-WATCH-2026-INTRO","Galaxy Watch 신제품 인지", "active", 980_000,   142_300, 11_200, 68_000.00,  date(2026,4,1),   None),
    ("CAMP-BUDS-2026-LAUNCH","Galaxy Buds 출시 캠페인",  "ended",  2_120_000, 305_800, 32_400, 142_500.00, date(2026,2,1),   date(2026,3,31)),
    ("CAMP-MX-BRAND-Q1",     "MX 브랜드 인지 Q1",        "ended",  3_400_000, 410_200, 18_900, 230_000.00, date(2026,1,1),   date(2026,3,31)),
]


def _audit_seed_rows() -> list[tuple[date, str, int]]:
    """60 days × 5 event kinds with sin-wave + weekday noise."""
    today = date(2026, 5, 1)
    kinds = [("login", 800), ("doc_edit", 320), ("search", 1100),
             ("doc_view", 2400), ("export", 95)]
    rows: list[tuple[date, str, int]] = []
    for i in range(60):
        d = today - timedelta(days=i)
        for kind, base in kinds:
            wave = 0.18 * math.sin(i / 9.0)
            weekday = -0.30 if d.weekday() >= 5 else 0.05
            val = int(base * (1.0 + wave + weekday + (i % 7) * 0.02))
            rows.append((d, kind, max(0, val)))
    return rows


async def _amain() -> int:
    async with session_scope() as s:
        # cohort
        await s.execute(text("DELETE FROM cohort_retention"))
        for cohort, points in COHORTS:
            for day, pct in points:
                await s.execute(
                    text("INSERT INTO cohort_retention (cohort_label, day_offset, retention_pct) "
                         "VALUES (:c, :d, :p)"),
                    {"c": cohort, "d": day, "p": pct},
                )

        # funnel
        await s.execute(text("DELETE FROM funnel_metrics"))
        for fkey, step, users, sort in FUNNEL:
            await s.execute(
                text("INSERT INTO funnel_metrics (funnel_key, step_label, users, sort_order) "
                     "VALUES (:k, :st, :u, :so)"),
                {"k": fkey, "st": step, "u": users, "so": sort},
            )

        # audit summary
        await s.execute(text("DELETE FROM audit_summary_daily"))
        for d, kind, n in _audit_seed_rows():
            await s.execute(
                text("INSERT INTO audit_summary_daily (day, event_kind, count) "
                     "VALUES (:d, :k, :n)"),
                {"d": d, "k": kind, "n": n},
            )

        # incidents
        await s.execute(text("DELETE FROM incidents_log"))
        for inc in INCIDENTS:
            await s.execute(
                text("""
                    INSERT INTO incidents_log
                      (incident_id, severity, status, title, owner,
                       duration_min, started_at, resolved_at)
                    VALUES (:id, :sev, :st, :title, :own, :dur, :sa, :ra)
                """),
                {"id": inc[0], "sev": inc[1], "st": inc[2], "title": inc[3],
                 "own": inc[4], "dur": inc[5], "sa": inc[6], "ra": inc[7]},
            )

        # campaigns
        await s.execute(text("DELETE FROM marketing_campaigns"))
        for c in CAMPAIGNS:
            await s.execute(
                text("""
                    INSERT INTO marketing_campaigns
                      (campaign_id, name, status, impressions, clicks,
                       conversions, spent, started_at, ended_at)
                    VALUES (:id, :name, :st, :imp, :clk, :conv, :sp, :sa, :ea)
                """),
                {"id": c[0], "name": c[1], "st": c[2], "imp": c[3], "clk": c[4],
                 "conv": c[5], "sp": c[6], "sa": c[7], "ea": c[8]},
            )

        await s.commit()
    print(f"✓ more facts seeded: "
          f"{sum(len(p) for _,p in COHORTS)} cohort + {len(FUNNEL)} funnel "
          f"+ {len(_audit_seed_rows())} audit + {len(INCIDENTS)} incidents "
          f"+ {len(CAMPAIGNS)} campaigns")
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    import sys
    sys.exit(main())
