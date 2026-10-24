# 위키 LLM 클라이언트 · 규칙서 시험 — 가짜 LLM 서버(진짜 소켓)로 구조화 출력 · 다시 묻기 · 오류 꼴 · 닿지 않음, 규칙서 YAML 검증
"""docs/llm-wiki W4 — CONTRACTS §11 '구조화 출력이 틀리면 한 번 다시 묻고, 또 틀리면 실패' · request §5-3 '틀린 YAML 은 저장 거부'."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.services import document_service
from app.wiki import llm
from app.wiki import schema as wiki_schema


class Pick(BaseModel):
    name: str
    score: int


def _ep(fake: Any, structured: str = "json_schema") -> llm.Endpoint:
    return llm.Endpoint(fake.base_url, fake.model, "", structured)


def _scenario(*rules: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"model": "fake-wiki", "rules": list(rules), **extra}


USER = [{"role": "user", "content": "고르라"}]


async def test_json_schema_mode_and_usage(fake_llm: Any) -> None:
    fake_llm.load(_scenario({"match": {"schema": "pick"}, "reply": {
        "json": {"name": "a", "score": 3}, "usage": {"prompt_tokens": 10, "completion_tokens": 5}}}))
    used = llm.Usage()
    got = await llm.structured(_ep(fake_llm), USER, Pick, name="pick", usage=used)
    assert got == Pick(name="a", score=3) and (used.tokens, used.calls) == (15, 1)
    body = fake_llm.calls[0]["body"]
    assert body["response_format"]["json_schema"]["name"] == "pick" and body["temperature"] == 0


async def test_tools_mode(fake_llm: Any) -> None:
    fake_llm.load(_scenario({"match": {"schema": "pick"}, "reply": {"json": {"name": "b", "score": 1}}}))
    got = await llm.structured(_ep(fake_llm, "tools"), USER, Pick, name="pick", usage=llm.Usage())
    body = fake_llm.calls[0]["body"]
    assert got.name == "b" and body["tool_choice"]["function"]["name"] == "pick" and "response_format" not in body


async def test_wrong_shape_is_asked_again_once(fake_llm: Any) -> None:
    fake_llm.load(_scenario({"match": {"schema": "pick"}, "reply": {"text": "이건 JSON 이 아니다"}, "times": 1},
                            {"match": {"schema": "pick"}, "reply": {"json": {"name": "c", "score": 2}}}))
    used = llm.Usage()
    got = await llm.structured(_ep(fake_llm), USER, Pick, name="pick", usage=used)
    assert got.name == "c" and used.calls == 2
    retry = fake_llm.calls[1]["body"]["messages"]
    assert retry[-1]["role"] == "user" and "스키마 pick 에 맞지 않았다" in retry[-1]["content"]


async def test_wrong_shape_twice_fails(fake_llm: Any) -> None:
    fake_llm.load(_scenario({"match": {"schema": "pick"}, "reply": {"text": json.dumps({"name": "x"})}}))
    with pytest.raises(llm.LLMFormatError, match="score"):
        await llm.structured(_ep(fake_llm), USER, Pick, name="pick", usage=llm.Usage())


@pytest.mark.parametrize("style", ["openai", "vllm-legacy"])
async def test_error_bodies_both_styles(fake_llm: Any, style: str) -> None:
    fake_llm.load(_scenario({"match": {}, "reply": {"error": {"status": 500, "message": "엔진이 쉰다"}}}, error_style=style))
    with pytest.raises(llm.LLMUnavailable, match="500 — 엔진이 쉰다"):
        await llm.structured(_ep(fake_llm), USER, Pick, name="pick", usage=llm.Usage())
    fake_llm.load(_scenario({"match": {}, "reply": {"error": {"status": 400, "message": "틀린 요청"}}}, error_style=style))
    with pytest.raises(llm.LLMError, match="400 — 틀린 요청") as caught:
        await llm.structured(_ep(fake_llm), USER, Pick, name="pick", usage=llm.Usage())
    assert not isinstance(caught.value, llm.LLMUnavailable)  # 4xx 는 다시 해도 같다


async def test_unknown_model_and_disconnect(fake_llm: Any) -> None:
    fake_llm.load(_scenario({"match": {}, "reply": {"json": {"name": "a", "score": 1}}}))
    with pytest.raises(llm.LLMError, match="does not exist"):
        await llm.structured(llm.Endpoint(fake_llm.base_url, "nope"), USER, Pick, name="pick", usage=llm.Usage())
    fake_llm.load("disconnect.json")
    with pytest.raises(llm.LLMUnavailable):
        await llm.structured(_ep(fake_llm), USER, Pick, name="pick", usage=llm.Usage())


async def test_unreachable_server() -> None:
    with pytest.raises(llm.LLMUnavailable, match="닿지 않는다"):
        await llm.structured(llm.Endpoint("http://127.0.0.1:9/v1", "m"), USER, Pick, name="pick", usage=llm.Usage())


def test_endpoints_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    st = get_settings()
    for key in ("wiki_llm_base_url", "wiki_llm_model", "wiki_query_llm_base_url", "wiki_query_llm_model"):
        monkeypatch.setattr(st, key, "")
    assert llm.background() is None and llm.interactive() is None  # mock 으로 대신하지 않는다
    monkeypatch.setattr(st, "wiki_llm_base_url", "http://bg:1/v1/")
    monkeypatch.setattr(st, "wiki_llm_model", "glm")
    assert llm.background() == llm.Endpoint("http://bg:1/v1", "glm", st.wiki_llm_api_key, "json_schema")
    assert llm.interactive() == llm.background()  # 묻기 자리가 비면 배경과 같게


# ── 규칙서 ───────────────────────────────────────────────────────────────────────────────────

def test_first_edition_parses() -> None:
    book = wiki_schema.DEFAULT
    assert book.version == 0 and len(book.spec.rules) == 10 and "`계산: 412 / 380 = 1.08`" in book.spec.rules[1]
    part = book.sections("part")
    assert part[0] == wiki_schema.SectionSpec("요약", "ai")
    assert (part[-3].owner, part[-2].owner, part[-1].owner) == ("human", "auto", "auto")
    assert book.spec.policy.auto_apply.max_docs == 12 and book.spec.budget.ingest_tokens == 60_000


@pytest.mark.parametrize(("raw", "needle"), [
    ("rules: [a]\nsections: {source: [요약]\n", "읽지 못했다"),
    ("rules: [a]\nsections: {part: [요약]}\n", "source"),
    ("rules: [a]\nsections: {source: [요약, 요약]}\n", "같은 이름"),
    ("rules: [a]\nsections: {source: [요약]}\nbudget: {ingest_tokens: 5}\n", "꼴에 맞지 않는다"),
    ("rules: [a]\nsections: {source: [요약]}\nsurprise: 1\n", "꼴에 맞지 않는다"),
])
def test_bad_yaml_is_rejected(raw: str, needle: str) -> None:
    with pytest.raises(wiki_schema.RuleBookError, match=needle):
        wiki_schema.parse_yaml(raw)


def _schema_doc(*yamls: str) -> dict[str, Any]:
    doc = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
    doc["slug"] = wiki_schema.SLUG
    doc["sections"][0]["blocks"] = [{"type": "code", "id": f"01J0000000000000000000000{i}", "language": "yaml", "code": y}
                                    for i, y in enumerate(yamls)]
    return doc


def test_saving_the_rule_book_checks_its_yaml() -> None:
    assert document_service.validate_documentjson(_schema_doc(wiki_schema.DEFAULT_YAML))["slug"] == wiki_schema.SLUG
    with pytest.raises(ValidationFailed, match="규칙서"):
        document_service.validate_documentjson(_schema_doc("rules: [a]\nsections: {part: [요약]}\n"))
    with pytest.raises(ValidationFailed, match="하나 있어야"):
        document_service.validate_documentjson(_schema_doc(wiki_schema.DEFAULT_YAML, wiki_schema.DEFAULT_YAML))
