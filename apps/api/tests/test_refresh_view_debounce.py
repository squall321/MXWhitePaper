"""M-large #1 — refresh_search_view_debounced 의 coalesce contract 검증.

배경: 동시 PUT 두 건에서 두 번째 CONCURRENT REFRESH 가 "another in progress"
실패 → plain REFRESH 폴백 (AccessExclusiveLock) → SELECT stall. debounce 로
실제 REFRESH 를 cap=2 (현재 진행 중 + 윈도우 동안의 누적 1회) 로 제한.

이 테스트는 view 자체를 만지지 않고 ``refresh_search_view`` 만 monkeypatch
해서 호출 횟수 + 동시성 시나리오를 검증한다.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.services import document_service


@pytest.fixture(autouse=True)
def _reset_debounce_state():
    """매 테스트 시작 시 모듈 전역 상태 초기화."""
    document_service._view_refresh_pending = False
    yield
    document_service._view_refresh_pending = False


@pytest.mark.asyncio
async def test_single_call_runs_once():
    """진행 중이 아닐 때 1회 요청 → 정확히 1회 REFRESH (+ window sleep, no extra)."""
    inner = AsyncMock()
    with patch.object(document_service, "refresh_search_view", inner):
        await document_service.refresh_search_view_debounced(
            None,  # session 은 monkeypatch 된 inner 가 무시
            window_s=0.01,
        )
    assert inner.await_count == 1


@pytest.mark.asyncio
async def test_concurrent_burst_coalesces_to_at_most_two():
    """5 동시 호출 → 실제 REFRESH 는 cap=2 (첫 호출 + 윈도우 끝 1회 추가)."""
    inner = AsyncMock()

    async def slow_refresh(_s):
        # REFRESH 가 실제로는 비싸다는 가정. 5개 호출이 burst 로 들어오면
        # 첫 호출만 실행되고 나머지는 _pending 만 set 한 채 종료.
        await asyncio.sleep(0.05)

    inner.side_effect = slow_refresh

    with patch.object(document_service, "refresh_search_view", inner):
        results = await asyncio.gather(
            *[
                document_service.refresh_search_view_debounced(None, window_s=0.01)
                for _ in range(5)
            ]
        )

    assert all(r is None for r in results)
    # cap=2: 첫 호출 1회 + 윈도우 안에 쌓인 요청 흡수해 1회 추가 = 최대 2회.
    assert inner.await_count <= 2
    assert inner.await_count >= 1


@pytest.mark.asyncio
async def test_pending_flag_triggers_one_extra_refresh():
    """진행 중일 때 들어온 요청이 _pending 을 set → 윈도우 끝에 1회 추가 실행."""
    refresh_calls: list[int] = []

    async def track_refresh(_s):
        refresh_calls.append(1)
        # 첫 실행 동안 두 번째 호출이 들어오게 한다.
        if len(refresh_calls) == 1:
            # _pending 만 set 하고 즉시 리턴해야 함 (lock locked).
            await document_service.refresh_search_view_debounced(None, window_s=0.001)
        await asyncio.sleep(0.01)

    with patch.object(document_service, "refresh_search_view", side_effect=track_refresh):
        await document_service.refresh_search_view_debounced(None, window_s=0.001)

    # 첫 호출 + pending 으로 인한 1회 추가 = 정확히 2회
    assert len(refresh_calls) == 2


@pytest.mark.asyncio
async def test_no_pending_no_extra_refresh():
    """진행 중이 아닐 때 들어온 단일 호출은 윈도우 끝에 *추가* refresh 없음."""
    inner = AsyncMock()
    with patch.object(document_service, "refresh_search_view", inner):
        await document_service.refresh_search_view_debounced(None, window_s=0.001)

    # 단일 호출은 정확히 1회만 (pending 미설정 → no extra).
    assert inner.await_count == 1


@pytest.mark.asyncio
async def test_sequential_calls_each_run_once():
    """직렬 호출 (윈도우 이후 다음 호출) 은 각자 1회씩 실행."""
    inner = AsyncMock()
    with patch.object(document_service, "refresh_search_view", inner):
        await document_service.refresh_search_view_debounced(None, window_s=0.001)
        await document_service.refresh_search_view_debounced(None, window_s=0.001)
        await document_service.refresh_search_view_debounced(None, window_s=0.001)
    assert inner.await_count == 3


@pytest.mark.asyncio
async def test_inner_failure_propagates_no_deadlock():
    """REFRESH 가 예외 던져도 lock 이 풀려야 한다 (deadlock 방지)."""
    inner = AsyncMock(side_effect=RuntimeError("simulated REFRESH failure"))
    with patch.object(document_service, "refresh_search_view", inner):
        with pytest.raises(RuntimeError, match="simulated"):
            await document_service.refresh_search_view_debounced(None, window_s=0.001)

    # lock 이 풀려 다음 호출이 정상 진행되는지 검증.
    inner2 = AsyncMock()
    with patch.object(document_service, "refresh_search_view", inner2):
        await document_service.refresh_search_view_debounced(None, window_s=0.001)
    assert inner2.await_count == 1
