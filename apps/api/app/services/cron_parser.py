"""Tiny pure-Python cron parser (Cycle 0029).

Parses 5-field standard cron expressions and computes the next firing time
without any third-party dependency. Mirrors the FE port at
``apps/web/src/features/automation/cron.ts`` — keep both in sync.

Grammar
=======

5 whitespace-separated fields, in order::

    minute hour day-of-month month day-of-week
    0-59   0-23 1-31         1-12  0-6 (0=Sunday)

Each field accepts:

  - ``*``                    — any value in the field's range
  - ``?``                    — alias for ``*`` (compat with quartz-style)
  - ``N``                    — single integer literal
  - ``N-M``                  — inclusive range, ``N <= M``
  - ``*/S`` or ``N-M/S``     — step (every Sth value within the range)
  - ``a,b,c``                — comma list of any of the above

Not supported (intentionally — the mandate forbids the heavyweight
extensions): ``L``, ``W``, ``#``, named months/days (jan/mon/…),
``@yearly`` / ``@reboot`` macros, seconds field, year field.

``parse_cron`` raises ``ValueError`` on any unsupported / malformed input.

Time semantics
==============

``next_run(parsed, after, tz=None)`` returns the smallest ``datetime``
strictly greater than ``after`` whose minute/hour/dom/month/dow components
match the parsed sets. Day-of-month + day-of-week follows the **POSIX OR**
semantic — if both are restricted (neither is the wildcard ``*``), a date
matches when *either* matches (this is what every ops-grade cron does).

When ``tz`` is supplied (``zoneinfo.ZoneInfo``), the schedule is evaluated
in that local zone — the candidate time is converted to local before the
field-match comparison and converted back to UTC for the return value.
This is what users mean when they say "fire at 09:00 Asia/Seoul". Without
``tz``, behaviour is unchanged: the comparison runs in whatever tzinfo
``after`` carries, defaulting to UTC for naïve inputs.

DST: candidate stepping is at one-minute granularity, so spring-forward
gaps simply yield "no match" and the loop moves on; fall-back duplicates
fire twice (once per civil minute) — same as cron(8). Acceptable for the
30s ticker which de-duplicates by ``next_cron_run_at`` advancement.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from datetime import tzinfo as _tzinfo

# Inclusive (min, max) for each field, matching standard cron.
_FIELD_RANGES: tuple[tuple[int, int], ...] = (
    (0, 59),   # minute
    (0, 23),   # hour
    (1, 31),   # day-of-month
    (1, 12),   # month
    (0, 6),    # day-of-week (0 = Sunday)
)
_FIELD_NAMES: tuple[str, ...] = ("minute", "hour", "dom", "month", "dow")


@dataclass(frozen=True)
class ParsedCron:
    """Pre-expanded sets of allowed values per field."""
    minute: frozenset[int]
    hour: frozenset[int]
    dom: frozenset[int]
    month: frozenset[int]
    dow: frozenset[int]
    # True iff the original field token was ``*`` or ``?``. Used for the
    # POSIX OR rule — when both dom and dow are wildcarded, AND-match
    # behaves identically; the special case kicks in only when *one* of
    # dom/dow is wildcarded and the other is a restricted set.
    dom_unrestricted: bool
    dow_unrestricted: bool


def _parse_field(token: str, lo: int, hi: int) -> tuple[frozenset[int], bool]:
    """Return ``(allowed_values, is_unrestricted)`` for one cron field."""
    if not token:
        raise ValueError("empty cron field")
    out: set[int] = set()
    unrestricted = False
    for piece in token.split(","):
        p = piece.strip()
        if not p:
            raise ValueError(f"empty cron list element in {token!r}")
        # Step?
        step = 1
        if "/" in p:
            base, step_s = p.split("/", 1)
            try:
                step = int(step_s)
            except ValueError as e:
                raise ValueError(f"invalid step {step_s!r}") from e
            if step <= 0:
                raise ValueError(f"step must be > 0 (got {step})")
            p = base
        # Range / wildcard / single?
        if p in ("*", "?"):
            start, end = lo, hi
            if step == 1:
                # Pure wildcard for this list element. The whole field is
                # unrestricted only when the *whole* token was a wildcard
                # (no step, no comma list) — handled by the caller via
                # the post-loop check.
                unrestricted = True
        elif "-" in p:
            a_s, b_s = p.split("-", 1)
            try:
                start = int(a_s)
                end = int(b_s)
            except ValueError as e:
                raise ValueError(f"invalid range {p!r}") from e
            if start > end:
                raise ValueError(f"reversed range {p!r}")
        else:
            try:
                start = int(p)
            except ValueError as e:
                raise ValueError(f"invalid cron literal {p!r}") from e
            end = start
        if start < lo or end > hi:
            raise ValueError(
                f"value out of range {start}-{end} for [{lo},{hi}]"
            )
        for v in range(start, end + 1, step):
            out.add(v)
    if not out:
        raise ValueError("cron field expanded to empty set")
    # `unrestricted` here is True if *any* sub-element was a wildcard.
    # The caller's stricter "is the whole token just `*`?" check is below.
    return frozenset(out), unrestricted


def parse_cron(expr: str) -> ParsedCron:
    """Parse a 5-field cron expression, raising ValueError on garbage."""
    if not isinstance(expr, str):
        raise ValueError("cron expression must be a string")
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError(
            f"expected 5 fields (minute hour dom month dow), got {len(parts)}"
        )
    sets: list[frozenset[int]] = []
    raw_unrestricted: list[bool] = []
    for raw, (lo, hi) in zip(parts, _FIELD_RANGES, strict=True):
        values, _ = _parse_field(raw, lo, hi)
        sets.append(values)
        # The whole field is "unrestricted" only when the bare token is
        # ``*`` or ``?``. A ``*/2`` step or a ``0-59`` explicit range is
        # **restricted** for the POSIX OR rule on dom/dow.
        raw_unrestricted.append(raw.strip() in ("*", "?"))
    return ParsedCron(
        minute=sets[0],
        hour=sets[1],
        dom=sets[2],
        month=sets[3],
        dow=sets[4],
        dom_unrestricted=raw_unrestricted[2],
        dow_unrestricted=raw_unrestricted[4],
    )


def _matches_date(parsed: ParsedCron, dt: datetime) -> bool:
    """Whether ``dt``'s month/dom/dow satisfies the parsed schedule.

    Implements the POSIX OR rule for dom/dow: when both are restricted,
    the date matches if *either* matches. When one is the wildcard, the
    other is the binding constraint (AND behaviour).
    """
    if dt.month not in parsed.month:
        return False
    # Python's weekday(): Monday=0..Sunday=6. Cron's: Sunday=0..Saturday=6.
    cron_dow = (dt.weekday() + 1) % 7
    dom_ok = dt.day in parsed.dom
    dow_ok = cron_dow in parsed.dow
    if parsed.dom_unrestricted and not parsed.dow_unrestricted:
        return dow_ok
    if parsed.dow_unrestricted and not parsed.dom_unrestricted:
        return dom_ok
    if parsed.dom_unrestricted and parsed.dow_unrestricted:
        return True  # both wildcards
    return dom_ok or dow_ok  # both restricted → OR


def next_run(
    parsed: ParsedCron,
    after: datetime,
    tz: _tzinfo | None = None,
) -> datetime:
    """Smallest minute-aligned datetime strictly greater than ``after``
    whose components all satisfy ``parsed``.

    Naïve minute-by-minute search — cheap and correct, ≤ 60 * 24 * 366
    iterations in the absolute worst case (~530k) but typically <10.

    When ``tz`` is provided, field-matching runs in that local zone (so
    "0 9 * * 1-5" with ``ZoneInfo('Asia/Seoul')`` fires at 09:00 KST,
    which is 00:00 UTC).  The returned datetime is in UTC for callers that
    persist it in a ``TIMESTAMPTZ`` column, regardless of ``tz``.

    Returns a ``datetime`` with ``tzinfo``:
      - UTC if ``tz`` is provided (canonical persisted form);
      - matching ``after.tzinfo`` (UTC if naïve) when ``tz`` is None.
    """
    if after.tzinfo is None:
        after = after.replace(tzinfo=UTC)
    # Step to the *next* minute boundary. ``next_run`` is documented as
    # strictly greater than ``after`` so a tick scheduled exactly on the
    # boundary fires once, not twice.
    candidate = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    # Hard cap: 4 years (covers leap-cycle fences). Anything that fails to
    # match in 4y is unrepresentable in a valid 5-field cron expression.
    deadline = candidate + timedelta(days=4 * 366)
    while candidate < deadline:
        # Evaluate the cron predicate in local time when a tz is supplied;
        # the underlying instant is unchanged, only the field projection
        # differs.
        local = candidate.astimezone(tz) if tz is not None else candidate
        if (
            local.minute in parsed.minute
            and local.hour in parsed.hour
            and _matches_date(parsed, local)
        ):
            # Persist as UTC when a tz was supplied so callers don't have
            # to remember the convention.
            return (
                candidate.astimezone(UTC)
                if tz is not None
                else candidate
            )
        candidate += timedelta(minutes=1)
    raise ValueError("cron expression has no firing time within 4 years")
