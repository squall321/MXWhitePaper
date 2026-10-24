# 위키 W0 시험 — 합성 원천 묶음(심은 결함 포함)과 가짜 LLM 서버가 진짜 꼴로 도는지 본다
"""docs/llm-wiki START §2 W0 완료 기준 — '가짜 LLM + 합성 묶음으로 빈 시험이 돈다'.

묶음 시험은 뒤 단계(W4 검증 · W7 점검)가 잡아야 할 결함이 정말 심겨 있는지를 못 박는다 — 누가 묶음을 고치다 결함을 지우면
여기서 먼저 깨진다. DB 는 건드리지 않는다.
"""
from __future__ import annotations

import copy
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from app.wiki.envelope import SourceEnvelope, normalize_audience

SOURCES = Path(__file__).parent / "fixtures" / "wiki" / "sources"
ANSWER_SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
    "additionalProperties": False,
}


def _raw(name: str) -> dict[str, Any]:
    return json.loads((SOURCES / f"{name}.json").read_text(encoding="utf-8"))


def _envelopes() -> dict[str, SourceEnvelope]:
    return {p.stem: SourceEnvelope.model_validate(json.loads(p.read_text(encoding="utf-8")))
            for p in sorted(SOURCES.glob("*.json"))}


# ── 합성 원천 묶음 ─────────────────────────────────────────────────────────────────────────────

def test_bundle_counts_by_kind() -> None:
    counts = Counter((e.kind, getattr(e.parsed_body, "form", None)) for e in _envelopes().values())
    assert counts == {
        ("sim_result", None): 6, ("field_defect", "case"): 4, ("field_defect", "aggregate"): 2,
        ("qa", None): 5, ("deliberation", None): 2, ("correction", None): 1,
    }


def test_bundle_is_synthetic_only() -> None:
    """사내 값이 섞이지 않게 — 바깥 id 는 SYN- 로, 사람은 example.com 으로만."""
    for name, e in _envelopes().items():
        for hint in e.subject_hints:
            assert all(v.startswith("SYN-") for v in hint.ext.values()), (name, hint.ext)
        if e.owner is not None:
            assert e.owner.email.endswith("@example.com"), name
        text = json.dumps(e.payload(), ensure_ascii=False)
        domains = set(re.findall(r"[\w.+-]+@([\w-]+(?:\.[\w-]+)+)", text))
        assert domains <= {"example.com"}, (name, domains)


def test_bundle_planted_contradiction() -> None:
    """같은 부품 · 같은 조건 · 같은 설계 · 같은 지표인데 값이 다르다 — W7 `contradiction` 이 잡아야 한다."""
    values: dict[tuple[Any, ...], set[float]] = defaultdict(set)
    for e in _envelopes().values():
        if e.kind != "sim_result":
            continue
        body = e.parsed_body
        part = next(h.name for h in e.subject_hints if h.type == "part")
        cond = body.setup.conditions  # type: ignore[attr-defined]
        key = (part, cond["scenario"], cond["drop_height"].value, cond.get("design_variation"))
        for r in body.results:  # type: ignore[attr-defined]
            if r.name == "max_von_mises_stress":
                values[key].add(r.value)
    assert values[("힌지 브래킷", "전각도 낙하", 1.5, None)] == {412, 405, 296}


def test_bundle_planted_staleness() -> None:
    """같은 잡의 rev 1 · 2 — 2 가 들어오면 1 은 superseded(W7 `stale`)."""
    revs: dict[tuple[str, str], list[str | None]] = defaultdict(list)
    for e in _envelopes().values():
        revs[(e.origin.system, e.origin.ref)].append(e.origin.rev)
    assert sorted(revs[("stcx", "SYN-JOB-0001")]) == ["1", "2"]
    assert all(len(v) == 1 for k, v in revs.items() if k != ("stcx", "SYN-JOB-0001"))


def test_bundle_planted_gap() -> None:
    """시장에서 났는데 재현한 해석이 없는 불량 유형은 배터리 스웰링 하나(W7 `gap`)."""
    field: set[str] = set()
    simulated: set[str] = set()
    for e in _envelopes().values():
        fms = {h.name for h in e.subject_hints if h.type == "failure-mode"}
        if e.kind == "sim_result":
            simulated |= fms
        elif e.kind == "field_defect":
            body = e.parsed_body
            if body.form == "case":  # type: ignore[attr-defined]
                field.add(body.failure_mode)  # type: ignore[attr-defined]
            else:
                field |= {c.failure_mode for c in body.counts}  # type: ignore[attr-defined]
    assert field - simulated == {"배터리 스웰링"}


def test_bundle_planted_correction_and_contact() -> None:
    envs = _envelopes()
    assert envs["01-sim-stcx-job0001-r1"].parsed_body.setup.conditions["bracket_material"] == "SUS304"  # type: ignore[attr-defined]
    correction = envs["20-cor-hinge-material"].parsed_body
    assert correction.doc_slug == "ent-part-hinge-bracket" and "SUS301" in correction.text  # type: ignore[attr-defined]
    answer = envs["17-qa-test-contact"].parsed_body.answer  # type: ignore[attr-defined]
    assert re.search(r"01[016-9]-\d{3,4}-\d{4}", answer) and "@example.com" in answer


def test_bundle_audience_mix() -> None:
    aud = {name: tuple(e.audience) for name, e in _envelopes().items()}
    assert aud["03-sim-stcx-job0002-rib"] == ("org",)
    assert aud["01-sim-stcx-job0001-r1"] == ("aff:SYN-CAE1",)
    assert aud["07-fdc-plm1001-hinge"] == ("plat:plmdefect",)
    assert aud["18-dlb-rib-adopt"] == ("aff:SYN-CAE1", "plat:plmdefect")


# ── 봉투 규칙 ────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("mutate", "loc"), [
    (lambda d: d.update(extra=1), ("extra",)),
    (lambda d: d["body"].update(oops=1), ("body", "oops")),
    (lambda d: d["body"]["setup"]["conditions"].update(drop_count=1), ("body", "setup", "conditions", "drop_count")),
    (lambda d: d.update(audience=[]), ("audience",)),
    (lambda d: d.update(audience=["aff:A", "aff:B"]), ("audience",)),
    (lambda d: d.update(audience=["team:x"]), ("audience",)),
    (lambda d: d.update(captured_at="2026-08-04T10:12:00"), ("captured_at",)),
    (lambda d: d["origin"].update(url="http://host/abs"), ("origin", "url")),
    (lambda d: d.update(kind="qa"), ("body", "question")),
])
def test_envelope_rejects(mutate: Any, loc: tuple[str, ...]) -> None:
    data = _raw("01-sim-stcx-job0001-r1")
    mutate(data)
    with pytest.raises(ValidationError) as ei:
        SourceEnvelope.model_validate(data)
    assert any(tuple(err["loc"])[: len(loc)] == loc for err in ei.value.errors()), ei.value.errors()


def test_envelope_audience_normalized() -> None:
    assert normalize_audience(["plat:plmdefect", "org", "aff:SYN-CAE1", "aff:SYN-CAE1"]) == [
        "aff:SYN-CAE1", "plat:plmdefect"]
    assert normalize_audience(["org", "org"]) == ["org"]


def test_envelope_payload_hash_is_canonical() -> None:
    a = SourceEnvelope.model_validate(_raw("01-sim-stcx-job0001-r1"))
    reordered = _raw("01-sim-stcx-job0001-r1")
    reordered["body"] = dict(reversed(list(reordered["body"].items())))
    assert SourceEnvelope.model_validate(reordered).payload_sha256() == a.payload_sha256()
    changed = _raw("01-sim-stcx-job0001-r1")
    changed["body"]["results"][0]["value"] = 413
    assert SourceEnvelope.model_validate(changed).payload_sha256() != a.payload_sha256()


# ── 가짜 LLM ─────────────────────────────────────────────────────────────────────────────────

def _json_req(*, name: str = "w0_answer", content: str = "질문", model: str = "fake-wiki") -> dict[str, Any]:
    return {
        "model": model, "messages": [{"role": "system", "content": "규칙"}, {"role": "user", "content": content}],
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": name, "schema": copy.deepcopy(ANSWER_SCHEMA), "strict": True}},
    }


def _post(llm: Any, payload: Any, *, timeout: float = 5.0, **kw: Any) -> httpx.Response:
    return httpx.post(f"{llm.base_url}/chat/completions", json=payload, timeout=timeout, **kw)


def test_fake_llm_models_and_json_schema(fake_llm: Any) -> None:
    fake_llm.load({"rules": [{"match": {"schema": "w0_answer"}, "reply": {"json": {"answer": "좋다"}}}]})
    models = httpx.get(f"{fake_llm.base_url}/models", timeout=5).json()
    assert models["object"] == "list" and models["data"][0]["id"] == "fake-wiki"

    r = _post(fake_llm, _json_req())
    assert r.status_code == 200
    data = r.json()
    assert data["object"] == "chat.completion" and data["id"].startswith("chatcmpl-")
    choice = data["choices"][0]
    assert choice["finish_reason"] == "stop"
    assert choice["message"]["tool_calls"] == []  # vLLM 은 null 이 아니라 [] 다
    assert json.loads(choice["message"]["content"]) == {"answer": "좋다"}
    usage = data["usage"]
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]
    assert [c["rule"] for c in fake_llm.calls] == [0]
    assert fake_llm.calls[0]["body"]["messages"][1]["content"] == "질문"


def test_fake_llm_tool_call(fake_llm: Any) -> None:
    fake_llm.load({"rules": [{"match": {"schema": "write_ops"}, "reply": {"json": {"answer": "도구"}}}]})
    req = {
        "model": "fake-wiki", "messages": [{"role": "user", "content": "써라"}],
        "tools": [{"type": "function", "function": {"name": "write_ops", "parameters": ANSWER_SCHEMA}}],
        "tool_choice": {"type": "function", "function": {"name": "write_ops"}},
    }
    choice = _post(fake_llm, req).json()["choices"][0]
    assert choice["finish_reason"] == "tool_calls" and choice["message"]["content"] is None
    call = choice["message"]["tool_calls"][0]
    assert call["type"] == "function" and call["id"].startswith("chatcmpl-tool-")
    assert call["function"]["name"] == "write_ops"
    assert json.loads(call["function"]["arguments"]) == {"answer": "도구"}  # arguments 는 JSON 글이다


def test_fake_llm_rejects_like_real_server(fake_llm: Any) -> None:
    fake_llm.load({"rules": [{"reply": {"json": {"answer": "x"}}}]})
    url = f"{fake_llm.base_url}/chat/completions"

    r = _post(fake_llm, _json_req(model="other-model"))
    assert r.status_code == 404
    assert r.json()["error"] == {"message": "The model `other-model` does not exist.", "type": "NotFoundError",
                                 "param": None, "code": 404}
    assert httpx.post(url, content=b"not json", timeout=5).status_code == 400
    assert _post(fake_llm, {"model": "fake-wiki", "messages": []}).status_code == 400
    assert _post(fake_llm, {**_json_req(), "stream": True}).status_code == 400
    bad_schema = _json_req()
    bad_schema["response_format"]["json_schema"]["schema"] = {"type": "nope"}
    assert _post(fake_llm, bad_schema).status_code == 400

    fake_llm.load({"error_style": "vllm-legacy", "rules": []})
    legacy = _post(fake_llm, _json_req(model="other-model")).json()
    assert legacy["object"] == "error" and legacy["code"] == 404 and legacy["type"] == "NotFoundError"

    fake_llm.load({"api_key": "k-test", "rules": [{"reply": {"json": {"answer": "x"}}}]})
    unauthorized = _post(fake_llm, _json_req())
    assert unauthorized.status_code == 401 and unauthorized.json() == {"error": "Unauthorized"}
    assert _post(fake_llm, _json_req(), headers={"Authorization": "Bearer k-test"}).status_code == 200


def test_fake_llm_scenario_faults_are_loud(fake_llm: Any) -> None:
    """시나리오 결함은 500 으로 소리 낸다 — 시험이 엉뚱한 까닭으로 통과하지 않게."""
    fake_llm.load({"rules": []})
    r = _post(fake_llm, _json_req())
    assert r.status_code == 500 and "맞는 규칙이 없다" in r.json()["error"]["message"]

    fake_llm.load({"rules": [{"reply": {"json": {"wrong": 1}}}]})
    r = _post(fake_llm, _json_req())
    assert r.status_code == 500 and "스키마에 안 맞는다" in r.json()["error"]["message"]

    fake_llm.load({"rules": [{"reply": {"capture": {"sid": r"(src_[0-9a-f]{8})"}, "json": {"answer": "{{sid}}"}}}]})
    r = _post(fake_llm, _json_req(content="원천 없음"))
    assert r.status_code == 500 and "capture" in r.json()["error"]["message"]


def test_fake_llm_capture_and_times(fake_llm: Any) -> None:
    """'처음엔 틀리고 다시 물으면 맞음' — times 로 짜고, 실행 때 정해지는 id 는 capture 로 받는다."""
    fake_llm.load({"rules": [
        {"times": 1, "reply": {"text": "{ 틀린 꼴"}},
        {"reply": {"capture": {"sid": r"(src_[0-9a-f]{8})"}, "json": {"answer": "근거 {{sid}}"}}},
    ]})
    req = _json_req(content="원천 src_1a2b3c4d 를 읽고 답하라")
    first = _post(fake_llm, req).json()["choices"][0]["message"]["content"]
    with pytest.raises(ValueError):
        json.loads(first)
    second = _post(fake_llm, req).json()["choices"][0]["message"]["content"]
    assert json.loads(second) == {"answer": "근거 src_1a2b3c4d"}
    assert [c["rule"] for c in fake_llm.calls] == [0, 1]


def test_fake_llm_transport_scenarios(fake_llm: Any) -> None:
    fake_llm.load("malformed.json")
    content = _post(fake_llm, _json_req()).json()["choices"][0]["message"]["content"]
    with pytest.raises(ValueError):
        json.loads(content)

    fake_llm.load("server_error.json")
    r = _post(fake_llm, _json_req())
    assert r.status_code == 500 and r.json()["error"]["type"] == "InternalServerError"

    fake_llm.load("disconnect.json")
    with pytest.raises(httpx.RemoteProtocolError):
        _post(fake_llm, _json_req())

    fake_llm.load("slow.json")
    with pytest.raises(httpx.ReadTimeout):
        _post(fake_llm, _json_req(), timeout=0.3)
