"""테스트 공통 설정.

1) `.env` 자동 로드 — apptainer 가 --env-file 없이 호출되어도 DB URL 이 잡히도록.
2) 매 테스트마다 SQLAlchemy async engine 을 폐기/재생성. pytest-asyncio 는 함수마다
   새 event loop 를 만들고 asyncpg connection 은 자기를 만든 loop 에만 bind 되므로,
   캐시된 engine 을 재사용하면 'Event loop is closed' 가 난다.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        # 따옴표가 없으면 첫 ' #' 이후를 inline 주석으로 간주해 잘라낸다
        value = value.strip()
        if value.startswith(('"', "'")):
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        else:
            hash_pos = value.find(" #")
            if hash_pos != -1:
                value = value[:hash_pos]
            value = value.strip()
        os.environ.setdefault(key, value)


# 1) container 내부: /workspace/.env, 2) host 직접 실행: repo root .env
for candidate in (
    Path("/workspace/.env"),
    Path(__file__).resolve().parents[3] / ".env",
):
    _load_env_file(candidate)

# 검색용 materialized view refresh 는 단위 테스트에서 비활성화한다.
# (동시성 commit 흐름이 conftest 의 engine reset 과 부딪히면 timeout 발생)
os.environ.setdefault("MXWP_SKIP_VIEW_REFRESH", "1")


@pytest.fixture(autouse=True)
def _reset_rate_limiter_per_test():
    """매 테스트마다 글로벌 per-IP token bucket 을 비운다.

    한 테스트의 burst 가 다음 테스트로 새지 않도록 한다. 미들웨어 자체가
    같은 source IP (`testclient`) 로 이뤄지는 모든 ASGI 트래픽을 한 버킷으로
    묶기 때문에, 리셋을 하지 않으면 60/min 익명 cap 을 금방 초과해 테스트
    파일 한 두 개를 넘기면 줄줄이 429 가 떨어진다.
    """
    try:
        from app.middleware.rate_limit import reset_for_tests as _rl_reset
    except Exception:
        _rl_reset = None
    if _rl_reset is not None:
        _rl_reset()
    yield
    if _rl_reset is not None:
        _rl_reset()


@pytest.fixture(autouse=True)
async def _reset_engine_per_test():
    """매 테스트마다 새 engine 을 사용해 loop-affinity 충돌을 피한다."""
    from typing import cast

    from sqlalchemy.ext.asyncio import AsyncEngine

    from app.core import db as db_mod

    # 기존 engine 이 있으면 (이전 테스트 잔재) 정리 시도
    if db_mod._engine is not None:
        try:
            await db_mod._engine.dispose()
        except Exception:
            pass
    db_mod._engine = None
    db_mod._sessionmaker = None

    yield

    # Re-read after yield because tests may have repopulated _engine via
    # get_engine(). `cast` resets pyright's narrowing (set-to-None above
    # would otherwise leave it as Literal[None]).
    eng = cast("AsyncEngine | None", db_mod._engine)
    if eng is not None:
        try:
            await eng.dispose()
        except Exception:
            pass
    db_mod._engine = None
    db_mod._sessionmaker = None
