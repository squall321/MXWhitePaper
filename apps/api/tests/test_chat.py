"""대화형 채팅 라우터 테스트 (mock 모드).

흐름:
  1) CHAT_ENABLED=false → 503 CHAT_DISABLED.
  2) mock 검색 의도 → SSE 에 tool_call(search_corpus) + tool_result + done.
  3) mock 생성 의도 → SSE 에 create_document tool_result(ok) + 문서 생성.
  4) messages 비면 422.
LLM 미설정(llm_backend=mock 기본)이라 mock 에이전트가 실 도구를 태운다.
"""
from __future__ import annotations

import json as _jsonmod

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.db import session_scope
from app.main import app
from app.repos import document_repo
from app.routers import chat as chat_mod
from app.services import chat_agent, document_service


@pytest.fixture(autouse=True)
def _reset_state():
    chat_mod._reset_rate_limit_for_tests()
    get_settings.cache_clear()
    yield
    chat_mod._reset_rate_limit_for_tests()
    get_settings.cache_clear()


def _parse_sse(text: str) -> list[tuple[str, str]]:
    """'event: X\\ndata: Y' 프레임들을 (event, data) 리스트로."""
    frames: list[tuple[str, str]] = []
    ev = None
    for line in text.splitlines():
        if line.startswith("event: "):
            ev = line[len("event: "):]
        elif line.startswith("data: ") and ev is not None:
            frames.append((ev, line[len("data: "):]))
            ev = None
    return frames


@pytest.mark.asyncio
async def test_chat_disabled_returns_503(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_ENABLED", "false")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "CHAT_DISABLED"


@pytest.mark.asyncio
async def test_chat_mock_search_flow(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_ENABLED", "true")
    monkeypatch.setenv("LLM_BACKEND", "mock")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/chat",
            json={"messages": [{"role": "user", "content": "배터리 백서 찾아줘"}]},
        )
    assert r.status_code == 200, r.text
    events = [e for e, _ in _parse_sse(r.text)]
    assert "tool_call" in events
    assert "tool_result" in events
    assert events[-1] == "done"
    # 검색 도구가 호출됐는지
    assert "search_corpus" in r.text


@pytest.mark.asyncio
async def test_chat_mock_create_flow(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_ENABLED", "true")
    monkeypatch.setenv("LLM_BACKEND", "mock")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/chat",
            json={"messages": [{"role": "user", "content": "pytest 채팅 생성 테스트 문서로 만들어줘"}]},
        )
        assert r.status_code == 200, r.text
        assert "create_document" in r.text
        # tool_result 에 slug 가 실려야 한다 (실제 생성됨).
        import json as _json
        slug = None
        for ev, data in _parse_sse(r.text):
            if ev == "tool_result":
                d = _json.loads(data)
                if d.get("name") == "create_document" and d.get("ok"):
                    slug = d.get("slug")
        assert slug, f"create_document 가 문서를 만들지 못함: {r.text}"
        # 생성된 문서가 실제로 조회되는지
        got = await ac.get(f"/api/v1/documents/{slug}")
        assert got.status_code == 200, got.text
    # 테스트가 만든 문서 정리(반복 실행 시 draft 누적 방지).
    await _archive(slug)


@pytest.mark.asyncio
async def test_chat_empty_messages_422(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_ENABLED", "true")
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/chat", json={"messages": []})
    assert r.status_code == 422, r.text


# ── 헬퍼 ────────────────────────────────────────────────────────────
async def _admin_ctx(s) -> dict:
    # 라우터의 _resolve_actor 는 항상 이메일을 채운다(admin/ JWT 사용자).
    # DocumentJSON metadata.owners 는 min_length=1 이라 이메일이 있어야 한다.
    owner = await document_repo.fetch_admin_owner_id(s)
    return {"actor_id": owner, "actor_email": "chat-test@example.com", "role": "admin"}


async def _archive(slug: str) -> None:
    """테스트가 만든 문서를 정리(soft delete)."""
    try:
        async with session_scope() as s:
            owner = await document_repo.fetch_admin_owner_id(s)
            await document_service.archive_document(s, slug=slug, actor_id=owner)
    except Exception:
        pass


class _FakeResp:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


def _fake_httpx(monkeypatch, responses: list) -> list:
    """httpx.AsyncClient.post 를 순차 응답으로 대체. 보낸 요청 payload 를 기록.

    responses 원소가 Exception 이면 그 시점에 raise (LLM 실패 시뮬레이션).
    응답이 소진되면 마지막 항목을 반복한다.
    """
    sent: list = []
    state = {"i": 0}

    async def _post(self, url, json=None, headers=None):  # noqa: A002
        sent.append(json)
        item = responses[min(state["i"], len(responses) - 1)]
        state["i"] += 1
        if isinstance(item, Exception):
            raise item
        return _FakeResp(item)

    monkeypatch.setattr(httpx.AsyncClient, "post", _post)
    return sent


def _openai_msg(*, content=None, tool_calls=None) -> dict:
    return {"choices": [{"message": {
        "role": "assistant", "content": content, "tool_calls": tool_calls}}]}


def _tc(name: str, arguments, tid="call_1") -> dict:
    d = {"type": "function", "function": {"name": name, "arguments": arguments}}
    if tid is not None:
        d["id"] = tid
    return d


def _live_settings(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_ENABLED", "true")
    monkeypatch.setenv("LLM_BACKEND", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "http://fake-llm/v1")
    monkeypatch.setenv("LLM_MODEL", "fake-model")
    get_settings.cache_clear()


def _events(frames: list[str]) -> list[tuple[str, dict]]:
    """SSE 프레임 문자열들을 (event, data_dict) 로 파싱."""
    out: list[tuple[str, dict]] = []
    for fr in frames:
        lines = fr.strip().splitlines()
        ev = lines[0][len("event: "):]
        data = _jsonmod.loads(lines[1][len("data: "):])
        out.append((ev, data))
    return out


# ── 도구 단위 테스트 (실 DB) ────────────────────────────────────────
@pytest.mark.asyncio
async def test_tool_append_section_increments(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_ENABLED", "true")
    monkeypatch.setenv("LLM_BACKEND", "mock")
    get_settings.cache_clear()
    slug = None
    try:
        async with session_scope() as s:
            ctx = await _admin_ctx(s)
            created = await chat_agent._tool_create_document(s, ctx, {
                "title": "pytest append base doc",
                "summary": "append 테스트",
                "sections": [{"heading": "처음", "paragraphs": ["첫 섹션"]}],
            })
        assert not created.get("error"), created
        slug = created["slug"]
        # 존재 slug 에 append → 섹션 수 증가
        async with session_scope() as s:
            ctx = await _admin_ctx(s)
            res = await chat_agent._tool_append_section(s, ctx, {
                "slug": slug, "heading": "덧붙임", "paragraphs": ["추가 문단"],
            })
        assert not res.get("error"), res
        assert res["section_count"] == 2, res
        # 없는 slug → error (예외 아님)
        async with session_scope() as s:
            ctx = await _admin_ctx(s)
            miss = await chat_agent._tool_append_section(s, ctx, {
                "slug": "does-not-exist-zzz", "heading": "x", "paragraphs": ["y"],
            })
        assert miss.get("error"), miss
    finally:
        if slug:
            await _archive(slug)


@pytest.mark.asyncio
async def test_create_post_commit_failure_reports_success(monkeypatch) -> None:
    """M3: 커밋 성공 후 부수효과가 던져도 문서는 생성됐으니 성공으로 보고."""
    monkeypatch.setenv("CHAT_ENABLED", "true")
    monkeypatch.setenv("LLM_BACKEND", "mock")
    get_settings.cache_clear()
    real_create = document_service.create_document

    async def flaky(sess, *, payload, owner_id):
        doc = await real_create(sess, payload=payload, owner_id=owner_id)
        raise RuntimeError("meili down (post-commit)")

    monkeypatch.setattr(chat_agent.document_service, "create_document", flaky)
    slug = None
    try:
        async with session_scope() as s:
            ctx = await _admin_ctx(s)
            res = await chat_agent._tool_create_document(s, ctx, {
                "title": "pytest post commit guard",
                "summary": "x",
                "sections": [{"heading": "내용", "paragraphs": ["본문"]}],
            })
        assert not res.get("error"), res
        assert res.get("slug"), res
        slug = res["slug"]
    finally:
        if slug:
            await _archive(slug)


@pytest.mark.asyncio
async def test_get_document_sql_error_rolls_back() -> None:
    """LOW: SELECT 예외 시 rollback 후 error dict — 전파 금지."""
    class _BoomSession:
        def __init__(self) -> None:
            self.rolled = False

        async def execute(self, *a, **k):
            raise RuntimeError("db boom")

        async def rollback(self) -> None:
            self.rolled = True

    s = _BoomSession()
    res = await chat_agent._tool_get_document(s, {}, {"slug": "x"})
    assert res.get("error")
    assert s.rolled is True


# ── M1: _build_documentjson 방어적 정규화 ───────────────────────────
@pytest.mark.asyncio
async def test_build_documentjson_string_sections() -> None:
    doc = chat_agent._build_documentjson(
        slug="x", title="T", summary="", sections="플레인문자열", owner_email=None)
    assert isinstance(doc["sections"], list) and len(doc["sections"]) >= 1


@pytest.mark.asyncio
async def test_build_documentjson_wraps_string_paragraphs() -> None:
    doc = chat_agent._build_documentjson(
        slug="x", title="T", summary="",
        sections=[{"heading": "H", "paragraphs": "한문단전체"}], owner_email=None)
    assert len(doc["sections"]) == 1
    assert doc["sections"][0]["title"] == "H"
    blocks = doc["sections"][0]["blocks"]
    # 글자 단위로 쪼개지지 않고 한 블록
    assert len(blocks) == 1
    assert blocks[0]["text"] == "한문단전체"


@pytest.mark.asyncio
async def test_build_documentjson_single_dict_section() -> None:
    doc = chat_agent._build_documentjson(
        slug="x", title="T", summary="",
        sections={"heading": "단일", "paragraphs": ["a", "b"]}, owner_email=None)
    assert len(doc["sections"]) == 1
    assert doc["sections"][0]["title"] == "단일"
    assert len(doc["sections"][0]["blocks"]) == 2


# ── _run_llm 경로 (fake httpx 로 tool_calls 주입) ────────────────────
@pytest.mark.asyncio
async def test_run_llm_tool_flow_string_args(monkeypatch) -> None:
    _live_settings(monkeypatch)
    sent = _fake_httpx(monkeypatch, [
        _openai_msg(tool_calls=[_tc("search_corpus", '{"query": "배터리", "limit": 3}')]),
        _openai_msg(content="검색 결과를 종합했습니다."),
    ])
    ctx = {"actor_id": "x", "actor_email": None, "role": "admin"}
    frames = [f async for f in chat_agent._run_llm(
        None, ctx, [{"role": "user", "content": "배터리 찾아줘"}])]
    evs = _events(frames)
    kinds = [e for e, _ in evs]
    assert "tool_call" in kinds
    assert "tool_result" in kinds
    assert kinds[-1] == "done"
    tokens = [d.get("text", "") for e, d in evs if e == "token"]
    assert any("종합" in t for t in tokens)
    # convo append 검증: 2번째 요청 messages 에 role=tool + non-null id
    assert len(sent) == 2
    tool_msgs = [m for m in sent[1]["messages"] if m.get("role") == "tool"]
    assert tool_msgs and tool_msgs[0]["tool_call_id"]


@pytest.mark.asyncio
async def test_run_llm_tool_flow_object_args(monkeypatch) -> None:
    _live_settings(monkeypatch)
    _fake_httpx(monkeypatch, [
        _openai_msg(tool_calls=[_tc("search_corpus", {"query": "재료", "limit": 2})]),
        _openai_msg(content="완료"),
    ])
    ctx = {"actor_id": "x", "actor_email": None, "role": "admin"}
    frames = [f async for f in chat_agent._run_llm(
        None, ctx, [{"role": "user", "content": "재료"}])]
    kinds = [e for e, _ in _events(frames)]
    assert "tool_call" in kinds and "tool_result" in kinds and kinds[-1] == "done"


@pytest.mark.asyncio
async def test_run_llm_synthesizes_tool_call_id(monkeypatch) -> None:
    """M2: tool_call.id 가 없어도 합성 id 로 assistant/tool 쌍을 일치시킨다."""
    _live_settings(monkeypatch)
    sent = _fake_httpx(monkeypatch, [
        _openai_msg(tool_calls=[_tc("search_corpus", '{"query":"x"}', tid=None)]),
        _openai_msg(content="끝"),
    ])
    ctx = {"actor_id": "x", "actor_email": None, "role": "admin"}
    _ = [f async for f in chat_agent._run_llm(
        None, ctx, [{"role": "user", "content": "x"}])]
    tool_msgs = [m for m in sent[1]["messages"] if m.get("role") == "tool"]
    assert tool_msgs and tool_msgs[0]["tool_call_id"]
    asst = [m for m in sent[1]["messages"]
            if m.get("role") == "assistant" and m.get("tool_calls")]
    assert asst and asst[0]["tool_calls"][0]["id"] == tool_msgs[0]["tool_call_id"]


@pytest.mark.asyncio
async def test_run_llm_unknown_tool(monkeypatch) -> None:
    _live_settings(monkeypatch)
    _fake_httpx(monkeypatch, [
        _openai_msg(tool_calls=[_tc("nonexistent_tool", "{}")]),
        _openai_msg(content="처리했습니다"),
    ])
    ctx = {"actor_id": "x", "actor_email": None, "role": "admin"}
    evs = _events([f async for f in chat_agent._run_llm(
        None, ctx, [{"role": "user", "content": "hi"}])])
    results = [d for e, d in evs if e == "tool_result"]
    assert results and results[0]["ok"] is False
    assert [e for e, _ in evs][-1] == "done"


@pytest.mark.asyncio
async def test_run_llm_max_rounds_graceful(monkeypatch) -> None:
    _live_settings(monkeypatch)
    # 항상 tool_calls 만 반환 → 라운드 한도까지 돌고 graceful 종료
    _fake_httpx(monkeypatch, [
        _openai_msg(tool_calls=[_tc("search_corpus", '{"query":"loop"}')]),
    ])
    ctx = {"actor_id": "x", "actor_email": None, "role": "admin"}
    evs = _events([f async for f in chat_agent._run_llm(
        None, ctx, [{"role": "user", "content": "x"}])])
    kinds = [e for e, _ in evs]
    assert kinds.count("tool_call") == chat_agent._MAX_ROUNDS
    assert kinds[-1] == "done"
    assert any("한도" in d.get("text", "") for e, d in evs if e == "token")


@pytest.mark.asyncio
async def test_run_no_mock_rerun_after_output_started(monkeypatch) -> None:
    """H1: _run_llm 이 출력을 시작한 뒤 실패하면 mock 재실행(이중 생성) 금지."""
    _live_settings(monkeypatch)
    _fake_httpx(monkeypatch, [
        _openai_msg(tool_calls=[_tc("create_document", _jsonmod.dumps({
            "title": "pytest h1 double create guard",
            "summary": "x",
            "sections": [{"heading": "내용", "paragraphs": ["본문"]}]}))]),
        RuntimeError("llm boom round2"),
    ])
    slug = None
    try:
        async with session_scope() as s:
            ctx = await _admin_ctx(s)
            evs = _events([f async for f in chat_agent.run(
                s, ctx=ctx, messages=[{"role": "user", "content": "만들어줘"}])])
        kinds = [e for e, _ in evs]
        creates = [d for e, d in evs
                   if e == "tool_call" and d.get("name") == "create_document"]
        assert len(creates) == 1, evs
        assert not any("(mock 모드)" in d.get("text", "")
                       for e, d in evs if e == "token"), evs
        assert "error" in kinds and kinds[-1] == "done"
        for e, d in evs:
            if e == "tool_result" and d.get("name") == "create_document" and d.get("slug"):
                slug = d["slug"]
    finally:
        if slug:
            await _archive(slug)
