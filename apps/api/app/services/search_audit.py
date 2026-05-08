"""검색 audit 로깅용 in-process rate limiter.

목적: GET /search 가 자동완성 등으로 자주 호출되어 audit_logs 가 폭주하는 것을
막는다. 같은 (user_id, query) 조합이 `WINDOW_SECONDS` 내에 여러 번 들어오면
첫 1건만 기록.

단순 dict 캐시 — 단일 프로세스 환경 (apptainer instance) 가정. 다중 worker
배포에서는 다소 누설되지만 audit 정확성보다 폭주 방어 우선.
"""
from __future__ import annotations

import time

WINDOW_SECONDS = 60.0
_MAX_CACHE = 4096

# (user_id, query) → last allowed timestamp
_last_hit: dict[tuple[str, str], float] = {}


def allow(user_id: str, query: str) -> bool:
    """`True` 면 audit_logs 에 기록해야 함."""
    key = (user_id or "", (query or "").lower()[:200])
    now = time.monotonic()
    last = _last_hit.get(key)
    if last is not None and (now - last) < WINDOW_SECONDS:
        return False
    _last_hit[key] = now
    # naive eviction
    if len(_last_hit) > _MAX_CACHE:
        # drop oldest 25%
        cutoff = now - WINDOW_SECONDS
        for k, v in list(_last_hit.items()):
            if v < cutoff:
                del _last_hit[k]
    return True


def reset() -> None:
    """tests / debugging 용."""
    _last_hit.clear()
