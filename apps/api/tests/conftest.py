"""테스트 공통 설정.

1) `.env` 자동 로드 — apptainer 가 --env-file 없이 호출되어도 DB URL 이 잡히도록.
   dev admin 폴백은 시험 프로세스에서만 켠다(아래 — b5b199c 가 기본을 닫았다).
2) 매 테스트마다 SQLAlchemy async engine 을 폐기/재생성. pytest-asyncio 는 함수마다
   새 event loop 를 만들고 asyncpg connection 은 자기를 만든 loop 에만 bind 되므로,
   캐시된 engine 을 재사용하면 'Event loop is closed' 가 난다.
3) 시험 전용 DB · 색인 · 버킷(사용자 결정 2026-10-24) — 시험은 dev 의 DB · Meilisearch 색인 · MinIO 버킷을
   읽지도 쓰지도 않는다. 같은 postgres 안의 `<dev DB>_test` 를 만들어 alembic head + seed 로 올려 쓰고,
   색인은 `test_` 접두, 버킷은 `mxwp-test-*`. 시험 DB 가 dev DB 와 같거나 이름이 `_test` 로 끝나지
   않으면 시험을 시작하지 않는다(닫힌 쪽 — 예전에 토큰 시험이 dev 의 api_tokens 를 통째로 비웠다).
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from sqlalchemy.engine import URL


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

_TEST_BUCKETS = {
    "MINIO_BUCKET_IMAGES": "mxwp-test-images",
    "MINIO_BUCKET_FILES": "mxwp-test-files",
    "MINIO_BUCKET_BACKUPS": "mxwp-test-backups",
    "MINIO_BUCKET_WIKI_SOURCES": "mxwp-test-wiki-sources",
}


async def _org_chain(test: URL) -> None:
    """시험 몇(test_orgs · test_org_admin · 파트 해석)이 기대는 조직 고리 — org_reset 의 mx → dev → he-team → cae.

    org_reset 은 다른 문서 · 팀을 지우므로 돌리지 않고, 고리만 넣는다(이름은 되돌린다 — 이름을 바꿨다 되돌리는 시험이 있다).
    """
    import asyncpg

    from app.scripts import org_reset as o

    conn = await asyncpg.connect(host=test.host, port=test.port, user=test.username, password=test.password,
                                 database=test.database)
    try:
        div = await conn.fetchval("""
            INSERT INTO divisions (slug, name) VALUES ($1, $2)
            ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id
        """, o.TARGET_DIVISION_SLUG, o.TARGET_DIVISION_NAME)
        team = await conn.fetchval("""
            INSERT INTO teams (division_id, slug, name) VALUES ($1, $2, $3)
            ON CONFLICT (division_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id
        """, div, o.TARGET_TEAM_SLUG, o.TARGET_TEAM_NAME)
        group = await conn.fetchval("""
            INSERT INTO groups (team_id, slug, name) VALUES ($1, $2, $3)
            ON CONFLICT (team_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id
        """, team, o.TARGET_GROUP_SLUG, o.TARGET_GROUP_NAME)
        await conn.execute("""
            INSERT INTO parts (group_id, slug, name) VALUES ($1, $2, $3)
            ON CONFLICT (group_id, slug) DO UPDATE SET name = EXCLUDED.name
        """, group, o.TARGET_PART_SLUG, o.TARGET_PART_NAME)
    finally:
        await conn.close()


def _use_test_resources() -> None:
    """dev 주소에서 시험 DB 주소를 짓고 환경을 바꾼 뒤 DB 를 만들고(없으면) 올린다. 설정 캐시보다 먼저 돈다."""
    from sqlalchemy.engine import make_url

    from app.core.config import Settings

    dev = make_url(os.environ.get("DATABASE_URL") or Settings.model_fields["database_url"].default)
    raw = os.environ.get("TEST_DATABASE_URL")
    test = make_url(raw) if raw else dev.set(database=f"{dev.database}_test")
    if not (test.database or "").endswith("_test") or (test.host, test.port, test.database) == (dev.host, dev.port, dev.database):
        raise pytest.UsageError(f"시험 DB({test.database})가 dev DB({dev.database})와 같거나 이름이 _test 로 끝나지 않는다 — 시험을 시작하지 않는다")
    for key, name in _TEST_BUCKETS.items():
        if os.environ.get(key) == name:
            raise pytest.UsageError(f"dev 버킷 이름이 시험 버킷과 같다({key}={name}) — 시험을 시작하지 않는다")
        os.environ[key] = name
    os.environ["MINIO_BUCKET_EXPORTS"] = ""  # 비우면 files 버킷 — 위의 시험 버킷
    os.environ["MEILI_INDEX_PREFIX"] = "test_"
    os.environ["DATABASE_URL"] = test.render_as_string(hide_password=False)

    async def _create() -> None:
        import asyncpg

        # 관리 DB(postgres)로 붙는다 — dev DB 에는 붙지 않는다.
        conn = await asyncpg.connect(host=test.host, port=test.port, user=test.username, password=test.password,
                                     database="postgres")
        try:
            if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", test.database):
                try:
                    await conn.execute(f'CREATE DATABASE "{test.database}"')
                except asyncpg.DuplicateDatabaseError:
                    pass  # 다른 시험 세션이 막 만들었다
        finally:
            await conn.close()

    asyncio.run(_create())
    api = Path(__file__).resolve().parents[1]
    for args in (["-m", "alembic", "upgrade", "head"], ["-m", "app.scripts.seed"], ["-m", "app.scripts.setup_buckets"]):
        done = subprocess.run([sys.executable, *args], cwd=api, env=os.environ.copy(), capture_output=True, text=True)
        if done.returncode != 0:
            raise pytest.UsageError(f"시험 DB 준비 실패 — {' '.join(args)}\n{done.stdout[-1500:]}\n{done.stderr[-1500:]}")
    asyncio.run(_org_chain(test))

    from app.core.config import get_settings

    st = get_settings()  # 바꾼 환경으로 캐시된다 — 다른 길이 dev 주소를 읽지 못하게 한 번 더 본다
    if make_url(st.database_url).database != test.database or st.meili_index_prefix != "test_":
        raise pytest.UsageError("설정이 시험 DB · 색인을 가리키지 않는다 — 시험을 시작하지 않는다")
    from app.search import knowledge_indexer, meili_indexer

    for indexer in (meili_indexer, knowledge_indexer):
        if not indexer.INDEX_UID.startswith("test_"):
            raise pytest.UsageError(f"색인 {indexer.INDEX_UID} 가 시험 색인이 아니다 — 시험을 시작하지 않는다")
        try:
            indexer.ensure_index()  # 거르기 · 정렬 칸까지 — add_documents 가 저절로 만든 색인에는 없다
        except Exception as exc:
            print(f"[conftest] {indexer.INDEX_UID} 색인 준비 실패(검색 시험만 깨진다): {exc}")


# 토큰 없는 요청을 admin 으로 통과시키는 dev 폴백을 시험 프로세스에서만 켠다. 시험 대부분이 토큰 없이 부른다.
# b5b199c(2026-08-19)가 운영 박스의 '인증 없는 기본값' 을 막으려고 기본을 닫은 뒤로 켜는 곳이 없어 dev 에서
# 시험 380여 건이 401 로 깨져 있었다(10-19 확인). 시험은 ASGITransport 로 프로세스 안에서만 돌아 밖으로 열리지 않는다.
# .env 가 끄더라도 시험은 켠다(setdefault 가 아니다). 닫힌 기본값 자체는 test_auth 가 따로 본다.
os.environ["ALLOW_DEV_ADMIN_FALLBACK"] = "1"

# SSO 전용은 끈다 — dev .env 가 켜도(10-27). 켜진 채면 가입 · 비밀번호 로그인 · 비밀번호 찾기 시험이 403 SSO_ONLY 로 깨진다.
# 켠 모습은 test_sso_only 가 monkeypatch 로 따로 본다.
os.environ["MXWP_SSO_ONLY"] = "false"

# 검색용 materialized view refresh 는 단위 테스트에서 비활성화한다.
# (동시성 commit 흐름이 conftest 의 engine reset 과 부딪히면 timeout 발생)
os.environ.setdefault("MXWP_SKIP_VIEW_REFRESH", "1")

# 위의 환경을 다 넣은 뒤에 — 시험 DB 를 고르며 설정을 캐시한다(get_settings 는 lru_cache).
_use_test_resources()


@pytest.fixture
def fake_llm():
    """가짜 LLM 서버(tests/fakes/fake_llm.py)를 빈 시나리오로 띄운다 — 시험이 `fake_llm.load(...)` 로 답을 고른다."""
    from tests.fakes.fake_llm import FakeLLM

    with FakeLLM({"rules": []}) as llm:
        yield llm


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


# ── Prod DB 오염 방지 — 테스트가 만든 prefix row 자동 정리 ──────────────────
#
# 일부 테스트 (특히 test_signup.py) 가 divisions/teams/groups 같은 *공유* 테이블에
# 직접 INSERT 한 뒤 row 를 안 지워서, pytest 한 번 돌릴 때마다 prod 사이드바
# 조직트리에 'Test Div *' 가 수십 개씩 쌓였다 (실사용 페이지를 더럽힘).
#
# 근본 수정: 명시적 test prefix 를 정해서, **테스트 세션 시작/종료 시** 매칭 row
# 를 전부 삭제. children → parent 역순으로. 새 테스트가 추가돼도 같은 prefix
# 컨벤션만 따르면 자동 정리.
#
# 컨벤션 (sup-* = "support fixture" 의 줄임):
#   - divisions.slug → 'sup-div-*'
#   - teams.slug     → 'sup-team-*'
#   - groups.slug    → 'sup-grp-*'
#
# 시작 시점에도 한 번 청소 — 이전 세션이 중간에 죽거나 이 fixture 도입 전에
# 누적된 잔재 처리. 종료 시점이 정상 케이스.
@pytest.fixture(scope="session", autouse=True)
def _cleanup_shared_table_leftovers():
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    def _purge():
        url = os.environ.get("DATABASE_URL")
        if not url:
            return

        async def _run():
            # 세션과 무관한 신규 engine — 끝나면 dispose. _reset_engine_per_test
            # 와의 충돌을 피하려 별 인스턴스 사용.
            engine = create_async_engine(
                url, pool_pre_ping=False, pool_size=1, max_overflow=0
            )
            try:
                async with engine.begin() as conn:
                    # children → parent. FK CASCADE 의존 안 함.
                    await conn.execute(
                        text("DELETE FROM groups WHERE slug LIKE 'sup-grp-%'")
                    )
                    await conn.execute(
                        text("DELETE FROM teams WHERE slug LIKE 'sup-team-%'")
                    )
                    await conn.execute(
                        text("DELETE FROM divisions WHERE slug LIKE 'sup-div-%'")
                    )
            finally:
                await engine.dispose()

        try:
            asyncio.run(_run())
        except Exception as exc:  # noqa: BLE001
            # cleanup 실패는 fatal 이 아님 — 다음 세션이 또 시도.
            print(f"[conftest] cleanup_shared_table_leftovers failed: {exc}")

    _purge()  # session start
    yield
    _purge()  # session end
