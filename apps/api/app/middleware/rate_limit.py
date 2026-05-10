"""In-memory per-IP token-bucket rate limiter.

No Redis dep — single-process. The bucket is keyed by client IP and the
limiter maintains an LRU cap so a flood of distinct source IPs cannot
explode memory.

Buckets refill linearly: ``capacity`` tokens spread over a one-minute
window (``refill_per_minute``). ``check`` returns ``(allowed, retry_after)``
where ``retry_after`` is the integer number of seconds the caller must
wait before another token is available. ``allowed=True`` always yields
``retry_after = 0``.

Bucket sizes (per-minute):

  - anonymous           : 60    (default for unauthenticated traffic)
  - authenticated user  : 1200  (was 300 — too tight for a single page that
                                  fans out 15-20 reads on mount, especially
                                  behind a NAT shared by a whole team)
  - personal API token  : 2400  (machine traffic — even higher headroom)
  - auth endpoints      : 10    (login / forgot / verify — brute-force shield)
  - default capacity    : 120   (matches existing settings.rate_limit_per_minute)

Stats are tracked best-effort — ``snapshot()`` returns the top N IPs by
recent activity for an admin telemetry endpoint.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field

# Hard cap on distinct buckets in memory. Above this we evict LRU.
_LRU_MAX = 10_000


@dataclass
class _Bucket:
    tokens: float
    capacity: float
    refill_per_sec: float
    updated_at: float
    # rolling counters (not perfectly minute-aligned; "last 60s" approximations).
    request_count: int = 0
    blocked_count: int = 0
    blocked_until: float = 0.0
    # window history (timestamps within last 60s) — kept small; pruned on read.
    recent_requests: list[float] = field(default_factory=list)
    recent_blocks: list[float] = field(default_factory=list)


class RateLimiter:
    """Token-bucket per key with LRU eviction.

    Thread-safe via a single lock — ASGI workers can be sync or async, and
    the per-call work is microseconds, so a single lock is fine.
    """

    def __init__(
        self,
        capacity: int = 120,
        refill_per_minute: int = 120,
        *,
        lru_max: int = _LRU_MAX,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be > 0")
        if refill_per_minute <= 0:
            raise ValueError("refill_per_minute must be > 0")
        self.capacity = float(capacity)
        self.refill_per_sec = refill_per_minute / 60.0
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()
        self._lock = threading.Lock()
        self._lru_max = lru_max

    # ── public ───────────────────────────────────────────────────────────
    def check(self, key: str) -> tuple[bool, int]:
        """Consume 1 token. Returns (allowed, retry_after_sec).

        ``retry_after`` is the integer seconds until at least one token is
        available again (always >= 1 when blocked).
        """
        if not key:
            # Empty key would collapse all callers to one bucket — refuse.
            return False, 60
        return self._consume(key, 1.0, capacity=self.capacity, refill=self.refill_per_sec)

    def check_with(
        self, key: str, *, capacity: int, refill_per_minute: int
    ) -> tuple[bool, int]:
        """Same as ``check`` but with a one-off bucket sizing.

        Useful for stricter buckets (auth endpoints) without maintaining a
        second limiter instance.
        """
        if capacity <= 0 or refill_per_minute <= 0:
            return False, 60
        return self._consume(
            key,
            1.0,
            capacity=float(capacity),
            refill=refill_per_minute / 60.0,
        )

    def reset(self) -> None:
        """Drop all buckets — used by tests."""
        with self._lock:
            self._buckets.clear()

    def snapshot(self, top_n: int = 10) -> dict:
        """Best-effort stats for admin telemetry.

        Returns top IPs by recent (last 60s) request count + global counters.
        """
        now = time.monotonic()
        with self._lock:
            self._prune_history_locked(now)
            rows = []
            active_blocks = 0
            for k, b in self._buckets.items():
                if b.blocked_until > now:
                    active_blocks += 1
                rows.append({
                    "ip": k,
                    "request_count_60s": len(b.recent_requests),
                    "blocked_count": len(b.recent_blocks),
                })
            rows.sort(key=lambda r: (-r["request_count_60s"], r["ip"]))
            return {
                "top_ips": rows[:top_n],
                "total_buckets": len(self._buckets),
                "active_block_count": active_blocks,
            }

    # ── internal ─────────────────────────────────────────────────────────
    def _consume(
        self, key: str, cost: float, *, capacity: float, refill: float
    ) -> tuple[bool, int]:
        now = time.monotonic()
        with self._lock:
            b = self._buckets.get(key)
            if b is None:
                b = _Bucket(
                    tokens=capacity,
                    capacity=capacity,
                    refill_per_sec=refill,
                    updated_at=now,
                )
                self._buckets[key] = b
                self._evict_locked()
            else:
                # If the caller passed a different per-route sizing we still
                # refill against THIS bucket's per-sec rate — the strict
                # auth check uses its own bucket below.
                elapsed = max(0.0, now - b.updated_at)
                b.tokens = min(b.capacity, b.tokens + elapsed * b.refill_per_sec)
                b.updated_at = now
                # The bucket may have been created with a larger capacity
                # earlier — for THIS call, cap by the requested capacity.
                if capacity != b.capacity:
                    b.capacity = capacity
                    b.refill_per_sec = refill
                    b.tokens = min(b.tokens, b.capacity)

            self._buckets.move_to_end(key)
            b.request_count += 1
            b.recent_requests.append(now)

            if b.tokens >= cost:
                b.tokens -= cost
                self._prune_history_for_locked(b, now)
                return True, 0

            # Denied — compute retry_after.
            deficit = cost - b.tokens
            wait = deficit / b.refill_per_sec if b.refill_per_sec > 0 else 60.0
            retry_after = max(1, int(wait + 0.999))
            b.blocked_count += 1
            b.recent_blocks.append(now)
            b.blocked_until = now + retry_after
            self._prune_history_for_locked(b, now)
            return False, retry_after

    def _evict_locked(self) -> None:
        # Called under self._lock. Pop oldest until we're at the cap.
        while len(self._buckets) > self._lru_max:
            self._buckets.popitem(last=False)

    @staticmethod
    def _prune_history_for_locked(b: _Bucket, now: float) -> None:
        cutoff = now - 60.0
        # Trim from the left — events are appended in monotonic order.
        i = 0
        for ts in b.recent_requests:
            if ts >= cutoff:
                break
            i += 1
        if i:
            del b.recent_requests[:i]
        j = 0
        for ts in b.recent_blocks:
            if ts >= cutoff:
                break
            j += 1
        if j:
            del b.recent_blocks[:j]

    def _prune_history_locked(self, now: float) -> None:
        for b in self._buckets.values():
            self._prune_history_for_locked(b, now)


# ── Module-level singletons used by the middleware. ─────────────────────
# A single global limiter for IP traffic. Tests can call ``reset()`` between
# cases via the helpers in ``conftest`` or ad-hoc.
_DEFAULT_CAPACITY = 120
_DEFAULT_REFILL_PER_MIN = 120

_global = RateLimiter(
    capacity=_DEFAULT_CAPACITY, refill_per_minute=_DEFAULT_REFILL_PER_MIN
)


def get_limiter() -> RateLimiter:
    return _global


def reset_for_tests() -> None:
    _global.reset()


# Bucket sizing matrix — kept here so middleware + admin endpoint share
# one source of truth.
ANON_PER_MIN = 60
AUTH_USER_PER_MIN = 1200
API_TOKEN_PER_MIN = 2400
AUTH_ENDPOINT_PER_MIN = 10

# Path prefixes that get the strict auth bucket.
STRICT_AUTH_PATHS: tuple[str, ...] = (
    "/api/v1/auth/login",
    "/api/v1/auth/password/forgot",
    "/api/v1/auth/email/verify",
)


def is_strict_auth_path(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in STRICT_AUTH_PATHS)


__all__ = [
    "ANON_PER_MIN",
    "API_TOKEN_PER_MIN",
    "AUTH_ENDPOINT_PER_MIN",
    "AUTH_USER_PER_MIN",
    "RateLimiter",
    "STRICT_AUTH_PATHS",
    "get_limiter",
    "is_strict_auth_path",
    "reset_for_tests",
]
