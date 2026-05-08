"""AI 보조 훅 라우터 단위 테스트.

흐름:
  1) AI_ENABLED=false (default) → 모든 endpoint 가 503 + AI_DISABLED.
  2) AI_ENABLED=true 로 설정한 뒤 placeholder happy path 검증.
  3) 동일 user 가 11회 호출 → 11번째는 429 (10/min).
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app
from app.routers import ai as ai_router_mod


@pytest.fixture(autouse=True)
def _reset_state():
    # 각 테스트가 자기 own AI_ENABLED 상태를 명시하도록, 매번 reset.
    ai_router_mod._reset_rate_limit_for_tests()
    get_settings.cache_clear()
    yield
    ai_router_mod._reset_rate_limit_for_tests()
    get_settings.cache_clear()


def _enable_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_ENABLED", "true")
    get_settings.cache_clear()


# ── feature flag ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_summarize_returns_503_when_ai_disabled(monkeypatch) -> None:
    monkeypatch.setenv("AI_ENABLED", "false")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/ai/summarize", json={"text": "hello world"})
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "AI_DISABLED"


@pytest.mark.asyncio
async def test_translate_returns_503_when_ai_disabled(monkeypatch) -> None:
    monkeypatch.setenv("AI_ENABLED", "false")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/ai/translate",
            json={"text": "안녕", "target_language": "en"},
        )
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "AI_DISABLED"


@pytest.mark.asyncio
async def test_polish_returns_503_when_ai_disabled(monkeypatch) -> None:
    monkeypatch.setenv("AI_ENABLED", "false")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/ai/polish", json={"text": "hello"})
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_continue_returns_503_when_ai_disabled(monkeypatch) -> None:
    monkeypatch.setenv("AI_ENABLED", "false")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/ai/continue", json={"text": "hello"})
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_title_returns_503_when_ai_disabled(monkeypatch) -> None:
    monkeypatch.setenv("AI_ENABLED", "false")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/ai/title", json={"content": "x"})
    assert r.status_code == 503


# ── happy path ───────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_summarize_returns_first_portion_when_enabled(monkeypatch) -> None:
    _enable_ai(monkeypatch)
    txt = "First sentence. Second sentence. Third sentence. Fourth one."
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/ai/summarize",
            json={"text": txt, "target_length": "short"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert "summary" in data
    # short = 15% → ~9 chars; placeholder doesn't have to match exactly,
    # but must be a *prefix* of the input (or a rstripped sentence cut).
    assert data["summary"] and txt.startswith(data["summary"][:5])


@pytest.mark.asyncio
async def test_translate_marks_text_with_lang_arrow(monkeypatch) -> None:
    _enable_ai(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/ai/translate",
            json={"text": "안녕하세요", "target_language": "en"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["source_language"] == "ko"
    assert data["translated"].startswith("[KO→EN placeholder]")
    assert "안녕하세요" in data["translated"]


@pytest.mark.asyncio
async def test_polish_strips_and_normalizes_punctuation(monkeypatch) -> None:
    _enable_ai(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/ai/polish",
            json={"text": "  hello world!!!  ", "tone": "concise"},
        )
    assert r.status_code == 200, r.text
    polished = r.json()["data"]["polished"]
    assert polished == "hello world."


@pytest.mark.asyncio
async def test_continue_returns_placeholder_string(monkeypatch) -> None:
    _enable_ai(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/ai/continue",
            json={"text": "오늘 점심은", "max_tokens": 64},
        )
    assert r.status_code == 200, r.text
    cont = r.json()["data"]["continuation"]
    assert "이어 쓰기" in cont or "..." in cont


@pytest.mark.asyncio
async def test_title_returns_first_50_chars(monkeypatch) -> None:
    _enable_ai(monkeypatch)
    big = "A" * 200
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/ai/title", json={"content": big})
    assert r.status_code == 200, r.text
    title = r.json()["data"]["title"]
    assert title == "A" * 50


# ── 입력 검증 ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_translate_rejects_unknown_language(monkeypatch) -> None:
    _enable_ai(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/ai/translate",
            json={"text": "hi", "target_language": "fr"},
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_summarize_rejects_empty_text(monkeypatch) -> None:
    _enable_ai(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/ai/summarize", json={"text": ""})
    assert r.status_code == 422


# ── rate limit ───────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_summarize_rate_limited_after_10_calls(monkeypatch) -> None:
    _enable_ai(monkeypatch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for i in range(10):
            r = await ac.post("/api/v1/ai/summarize", json={"text": f"hi {i}"})
            assert r.status_code == 200, f"call {i}: {r.text}"
        r11 = await ac.post("/api/v1/ai/summarize", json={"text": "boom"})
    assert r11.status_code == 429, r11.text
    assert r11.json()["error"]["code"] == "RATE_LIMITED"
