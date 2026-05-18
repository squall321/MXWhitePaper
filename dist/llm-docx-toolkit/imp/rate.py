"""Sleep-based rate limiter.

v1 supports `parallel=1` only — the limiter just makes sure two
consecutive `acquire()` calls are at least `delay_seconds` apart.

The interface (a class with `acquire()`) is kept so a future v2 can swap
in a token-bucket / threadpool variant without touching the uploader.
"""
from __future__ import annotations

import time
from typing import Callable


class RateLimiter:
    """Spacing-only rate limiter. `acquire()` blocks until enough wall
    time has passed since the previous call."""

    def __init__(
        self,
        delay_seconds: float,
        parallel: int = 1,
        *,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        if parallel != 1:
            # v1 is single-threaded by design (see bulk-import.design.md §3).
            # Surface this loudly rather than silently sleeping.
            raise NotImplementedError(
                f"parallel={parallel} not implemented in v1 — only parallel=1"
            )
        self.delay = max(0.0, delay_seconds)
        self.parallel = parallel
        self._last_release: float | None = None
        self._sleep = sleep
        self._monotonic = monotonic

    def acquire(self) -> None:
        now = self._monotonic()
        if self._last_release is None or self.delay <= 0:
            self._last_release = now
            return
        elapsed = now - self._last_release
        wait = self.delay - elapsed
        if wait > 0:
            self._sleep(wait)
        self._last_release = self._monotonic()


__all__ = ["RateLimiter"]
