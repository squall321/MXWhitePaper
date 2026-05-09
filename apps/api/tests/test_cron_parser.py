"""Cron parser unit tests (Cycle 0029).

Pure logic — no DB, no FastAPI. Validates the in-house parser & next_run
against the canonical 5-field cron grammar. The mandate calls for >= 15
cases; this file ships ~30 covering: every minute, hourly, daily,
weekly Mon, monthly 1st, ranges, steps, comma lists, OR-rule for dom/dow,
month rollover, leap day, and rejection of malformed input.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.cron_parser import next_run, parse_cron


UTC = timezone.utc


# ── parse_cron ───────────────────────────────────────────────────────────


def test_parse_every_minute():
    p = parse_cron("* * * * *")
    assert p.minute == frozenset(range(60))
    assert p.hour == frozenset(range(24))
    assert p.dom == frozenset(range(1, 32))
    assert p.month == frozenset(range(1, 13))
    assert p.dow == frozenset(range(7))
    assert p.dom_unrestricted and p.dow_unrestricted


def test_parse_questionmark_alias():
    """`?` is treated identically to `*` (Quartz compat)."""
    p = parse_cron("0 9 ? * 1")
    assert p.minute == frozenset({0})
    assert p.dom_unrestricted is True


def test_parse_range():
    p = parse_cron("0 9-17 * * *")
    assert p.hour == frozenset(range(9, 18))


def test_parse_step():
    p = parse_cron("*/15 * * * *")
    assert p.minute == frozenset({0, 15, 30, 45})


def test_parse_step_inside_range():
    p = parse_cron("0 0-23/6 * * *")
    assert p.hour == frozenset({0, 6, 12, 18})


def test_parse_comma_list():
    p = parse_cron("0 9,12,18 * * *")
    assert p.hour == frozenset({9, 12, 18})


def test_parse_combo():
    """List + range + step in one field."""
    p = parse_cron("0,30 8-17/3 * * 1-5")
    assert p.minute == frozenset({0, 30})
    assert p.hour == frozenset({8, 11, 14, 17})
    assert p.dow == frozenset({1, 2, 3, 4, 5})


def test_parse_rejects_too_few_fields():
    with pytest.raises(ValueError):
        parse_cron("* * * *")


def test_parse_rejects_too_many_fields():
    with pytest.raises(ValueError):
        parse_cron("* * * * * *")


def test_parse_rejects_out_of_range_minute():
    with pytest.raises(ValueError):
        parse_cron("60 * * * *")


def test_parse_rejects_zero_step():
    with pytest.raises(ValueError):
        parse_cron("*/0 * * * *")


def test_parse_rejects_reversed_range():
    with pytest.raises(ValueError):
        parse_cron("0 17-9 * * *")


def test_parse_rejects_named_dow():
    """Named days (`mon`, `tue`, …) are intentionally unsupported."""
    with pytest.raises(ValueError):
        parse_cron("0 9 * * mon")


def test_parse_rejects_l_extension():
    """`L` (last-day-of-month) is a Quartz extension we do not support."""
    with pytest.raises(ValueError):
        parse_cron("0 9 L * *")


def test_parse_rejects_garbage():
    with pytest.raises(ValueError):
        parse_cron("not a cron expression at all")


# ── next_run ─────────────────────────────────────────────────────────────


def test_next_run_every_minute_ticks_one_minute():
    p = parse_cron("* * * * *")
    after = datetime(2026, 5, 9, 14, 30, 15, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 5, 9, 14, 31, tzinfo=UTC)


def test_next_run_hourly_top_of_next_hour():
    p = parse_cron("0 * * * *")
    after = datetime(2026, 5, 9, 14, 30, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 5, 9, 15, 0, tzinfo=UTC)


def test_next_run_daily_midnight():
    p = parse_cron("0 0 * * *")
    after = datetime(2026, 5, 9, 14, 30, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 5, 10, 0, 0, tzinfo=UTC)


def test_next_run_daily_9am_skips_to_tomorrow_when_after_9am():
    p = parse_cron("0 9 * * *")
    after = datetime(2026, 5, 9, 14, 30, tzinfo=UTC)  # already past 9am
    assert next_run(p, after) == datetime(2026, 5, 10, 9, 0, tzinfo=UTC)


def test_next_run_daily_9am_today_when_before_9am():
    p = parse_cron("0 9 * * *")
    after = datetime(2026, 5, 9, 7, 30, tzinfo=UTC)  # before 9am
    assert next_run(p, after) == datetime(2026, 5, 9, 9, 0, tzinfo=UTC)


def test_next_run_weekly_monday_9am():
    p = parse_cron("0 9 * * 1")
    # 2026-05-09 is a Saturday. Next Monday is 2026-05-11.
    after = datetime(2026, 5, 9, 14, 30, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 5, 11, 9, 0, tzinfo=UTC)


def test_next_run_weekly_sunday_uses_zero():
    """Cron Sunday is 0 (not 7)."""
    p = parse_cron("0 9 * * 0")
    after = datetime(2026, 5, 9, 14, 30, tzinfo=UTC)  # Sat
    assert next_run(p, after) == datetime(2026, 5, 10, 9, 0, tzinfo=UTC)


def test_next_run_monthly_first_of_month():
    p = parse_cron("0 9 1 * *")
    after = datetime(2026, 5, 9, 14, 30, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 6, 1, 9, 0, tzinfo=UTC)


def test_next_run_weekday_only():
    p = parse_cron("0 8 * * 1-5")
    # Friday 2026-05-08 09:00 → next is Mon 2026-05-11 08:00 (Sat/Sun skipped).
    after = datetime(2026, 5, 8, 9, 0, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 5, 11, 8, 0, tzinfo=UTC)


def test_next_run_step_minutes_quarter_hour():
    p = parse_cron("*/15 * * * *")
    after = datetime(2026, 5, 9, 14, 7, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 5, 9, 14, 15, tzinfo=UTC)


def test_next_run_comma_list_hours():
    p = parse_cron("0 9,12,18 * * *")
    after = datetime(2026, 5, 9, 13, 0, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 5, 9, 18, 0, tzinfo=UTC)


def test_next_run_strictly_greater_than_after():
    """When `after` lands exactly on a firing minute, the next firing is
    one cycle later — NOT the same minute echoed back."""
    p = parse_cron("0 * * * *")
    after = datetime(2026, 5, 9, 14, 0, tzinfo=UTC)
    assert next_run(p, after) == datetime(2026, 5, 9, 15, 0, tzinfo=UTC)


def test_next_run_naive_datetime_treated_as_utc():
    p = parse_cron("0 0 * * *")
    after_naive = datetime(2026, 5, 9, 14, 30)
    out = next_run(p, after_naive)
    assert out.tzinfo is UTC
    assert out == datetime(2026, 5, 10, 0, 0, tzinfo=UTC)


def test_next_run_dom_or_dow_rule():
    """When both dom and dow are restricted, POSIX cron uses OR — match
    if *either* field accepts the date."""
    # 1st OR Monday at 9am
    p = parse_cron("0 9 1 * 1")
    # From a Saturday mid-month; next match is Monday 2026-05-11 09:00.
    after = datetime(2026, 5, 9, 14, 30, tzinfo=UTC)
    nxt = next_run(p, after)
    assert nxt == datetime(2026, 5, 11, 9, 0, tzinfo=UTC)
    # Now from the Monday 09:01; next match is the next Monday OR the 1st,
    # whichever comes first. Next Monday is 2026-05-18; 1st is 2026-06-01.
    after2 = datetime(2026, 5, 11, 9, 1, tzinfo=UTC)
    assert next_run(p, after2) == datetime(2026, 5, 18, 9, 0, tzinfo=UTC)


def test_next_run_month_rollover():
    p = parse_cron("0 0 1 * *")
    after = datetime(2026, 12, 15, 0, 0, tzinfo=UTC)
    assert next_run(p, after) == datetime(2027, 1, 1, 0, 0, tzinfo=UTC)


def test_next_run_leap_day():
    """Feb 29 only fires in leap years. 2027 is not a leap year, 2028 is."""
    p = parse_cron("0 0 29 2 *")
    after = datetime(2027, 3, 1, 0, 0, tzinfo=UTC)
    assert next_run(p, after) == datetime(2028, 2, 29, 0, 0, tzinfo=UTC)


def test_next_run_consecutive_calls_are_strictly_monotonic():
    """Chaining ``next_run`` produces a strictly increasing schedule."""
    p = parse_cron("*/15 * * * *")
    t = datetime(2026, 5, 9, 0, 0, tzinfo=UTC)
    seen = []
    for _ in range(8):
        t = next_run(p, t)
        seen.append(t)
    # Starting from 00:00, eight ``next_run`` hops land at 00:15, 00:30,
    # 00:45, 01:00, 01:15, 01:30, 01:45, 02:00.
    assert seen[0] == datetime(2026, 5, 9, 0, 15, tzinfo=UTC)
    assert seen[-1] == datetime(2026, 5, 9, 2, 0, tzinfo=UTC)
    for a, b in zip(seen, seen[1:], strict=False):
        assert b - a == timedelta(minutes=15)
