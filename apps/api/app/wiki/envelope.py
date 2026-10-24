# 위키 원천 봉투(mxwp-source/1)를 종류별 body 까지 검증하는 pydantic 모델
"""CONTRACTS §3 — 생산자(포털 · 연결기 · 사람)가 `POST /api/v1/wiki/sources` 로 보내는 꼴.

- 모르는 칸은 거부한다(`extra='forbid'`) — 조용히 버리면 생산자의 오타가 빈 칸으로 쌓인다.
- 숫자는 늘 `{value, unit}` 이다. 해석 조건에도 맨 숫자를 받지 않는다 — 단위 없는 숫자는 V3(숫자 대조)가 맞출 수 없다.
- `audience` 는 토큰(`org` · `aff:<소속>` · `plat:<열쇠>` · `user:<uuid>`)의 **그리고**다. 정규화(중복 · 순서 · 다른 토큰과 함께인
  `org`)해서 담고, 아무도 만족할 수 없는 조합(서로 다른 `aff:` 둘 · `user:` 둘)은 거부한다(CONTRACTS §2-11).
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    StrictBool,
    StrictStr,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

SCHEMA_ID = "mxwp-source/1"

SourceKind = Literal[
    "sim_result", "field_defect", "qa", "deliberation", "report",
    "card", "document", "correction", "inquiry_answer", "note",
]
OriginSystem = Literal[
    "stepforge", "dynaforge", "stcx", "ste", "signalforge", "plm-defect", "hwax-risk",
    "material-twin", "hwax-portal", "report-archive", "aidatahub", "mxwp", "human",
]

_AUDIENCE_RE = re.compile(
    r"^(org|aff:[^\s,]{1,120}|plat:[a-z0-9][a-z0-9_.-]{0,63}"
    r"|user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"
)
_TYPE_KEY_RE = re.compile(r"^[a-z][a-z0-9-]{0,40}$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def normalize_audience(tokens: list[str]) -> list[str]:
    """중복을 지우고 정렬한다. 다른 토큰이 있으면 `org` 는 뺀다(org ∧ X = X). 틀린 꼴 · 빈 목록 · 만족 불가 조합은 ValueError."""
    toks = sorted({t.strip() for t in tokens if isinstance(t, str) and t.strip()})
    if not toks:
        raise ValueError("audience 는 비울 수 없다 — 모두에게면 [\"org\"]")
    bad = [t for t in toks if not _AUDIENCE_RE.match(t)]
    if bad:
        raise ValueError(f"audience 토큰 꼴이 틀렸다: {bad} (org · aff:<소속> · plat:<열쇠> · user:<uuid>)")
    if len(toks) > 1:
        toks = [t for t in toks if t != "org"]
    for prefix in ("aff:", "user:"):
        if sum(t.startswith(prefix) for t in toks) > 1:
            raise ValueError(f"{prefix} 토큰이 둘 이상이면 만족하는 사람이 없다 — 그리고(AND)다: {toks}")
    return toks


class Quantity(_Strict):
    value: float
    unit: str = Field(min_length=1, max_length=40)


class Origin(_Strict):
    system: OriginSystem
    ref: str = Field(min_length=1, max_length=300)
    rev: str | None = Field(default=None, max_length=60)
    url: str | None = Field(default=None, max_length=1000)

    @field_validator("url")
    @classmethod
    def _relative(cls, v: str | None) -> str | None:
        # 박스마다 호스트가 다르다 — 포털 경로(/ste/… · /apps/…)처럼 상대 경로만 받는다.
        if v is not None and (not v.startswith("/") or v.startswith("//")):
            raise ValueError("origin.url 은 '/' 로 시작하는 상대 경로여야 한다")
        return v


class Owner(_Strict):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v:
            raise ValueError("owner.email 이 이메일 꼴이 아니다")
        return v


class SubjectHint(_Strict):
    type: str
    name: str = Field(min_length=1, max_length=200)
    ext: dict[str, str] = Field(default_factory=dict)

    @field_validator("type")
    @classmethod
    def _type_key(cls, v: str) -> str:
        if not _TYPE_KEY_RE.match(v):
            raise ValueError(f"subject_hints.type 은 유형 열쇠(kebab) 꼴이어야 한다: {v!r}")
        return v


class Attachment(_Strict):
    name: str = Field(min_length=1, max_length=300)
    mime: str = Field(min_length=3, max_length=120)
    upload_id: str = Field(min_length=1, max_length=120)


class Consent(_Strict):
    by: str
    at: datetime
    mode: Literal["button", "candidate", "auto"]
    note: str | None = None


# ── kind 별 body ──────────────────────────────────────────────────────────────────────────────

class SimSetup(_Strict):
    solver: str
    model: str
    # Strict — 맨 숫자 1 이 bool True 나 글 "1" 로 슬며시 바뀌지 않게(숫자는 Quantity 로만).
    conditions: dict[str, StrictStr | StrictBool | Quantity] = Field(default_factory=dict)


class SimResultItem(_Strict):
    name: str
    value: float
    unit: str = Field(min_length=1, max_length=40)
    where: str | None = None


class NamedLink(_Strict):
    name: str
    url: str


class SimResultBody(_Strict):
    summary: str
    setup: SimSetup
    results: list[SimResultItem] = Field(min_length=1)
    verdict: str | None = None
    artifacts: list[NamedLink] = Field(default_factory=list)


class Dataset(_Strict):
    name: str
    version: str


class DefectDates(_Strict):
    opened: date
    closed: date | None = None


class FieldDefectCase(_Strict):
    form: Literal["case"]
    case_ref: str
    symptom: str
    failure_mode: str | None = None
    cause: str | None = None
    action: str | None = None
    status: str
    dates: DefectDates
    model: str | None = None
    part: str | None = None
    stage: str | None = None
    dataset: Dataset


class Period(_Strict):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    from_: date = Field(alias="from")
    to: date


class AggregateScope(_Strict):
    model: str | None = None
    part: str | None = None
    region: str | None = None


class DefectCount(_Strict):
    failure_mode: str
    count: int = Field(ge=0)
    rate: float | None = None
    unit: str = Field(min_length=1, max_length=40)


class FieldDefectAggregate(_Strict):
    form: Literal["aggregate"]
    period: Period
    scope: AggregateScope
    counts: list[DefectCount] = Field(min_length=1)
    dataset: Dataset


FieldDefectBody = Annotated[FieldDefectCase | FieldDefectAggregate, Field(discriminator="form")]


class Evidence(_Strict):
    kind: Literal["tool", "doc", "source"]
    ref: str
    excerpt: str


class QaBody(_Strict):
    question: str
    answer: str
    evidence: list[Evidence] = Field(default_factory=list)
    model: str
    outcome: Literal["solved", "partial", "unknown"]
    asker_note: str | None = None


class Vote(_Strict):
    seat: str
    stance: str


class DeliberationBody(_Strict):
    question: str
    decision: str
    votes: list[Vote] = Field(min_length=1)
    evidence: list[Evidence] = Field(default_factory=list)
    minority: str | None = None
    job_id: str


class ReportSection(_Strict):
    heading: str
    text: str


class ReportFigure(_Strict):
    name: str
    caption: str | None = None
    upload_id: str | None = None


class ReportBody(_Strict):
    ra_report_id: str
    title: str
    sections: list[ReportSection] = Field(min_length=1)
    figures: list[ReportFigure] = Field(default_factory=list)


class CardClaim(_Strict):
    text: str
    evidence: str | None = None


class CardBody(_Strict):
    card_id: str
    domain: str
    title: str
    claims: list[CardClaim] = Field(min_length=1)


class DocumentBody(_Strict):
    doc_slug: str
    version: int = Field(ge=1)


class CorrectionBody(_Strict):
    doc_slug: str
    block_id: str | None = None
    text: str
    reason: str


class ToolCallDigest(_Strict):
    tool: str
    args_digest: str
    result_excerpt: str


class InquiryAnswerBody(_Strict):
    question_id: str
    answer: str
    tool_calls: list[ToolCallDigest] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


class NoteBody(_Strict):
    text: str


_BODY_ADAPTERS: dict[str, TypeAdapter[Any]] = {
    "sim_result": TypeAdapter(SimResultBody),
    "field_defect": TypeAdapter(FieldDefectBody),
    "qa": TypeAdapter(QaBody),
    "deliberation": TypeAdapter(DeliberationBody),
    "report": TypeAdapter(ReportBody),
    "card": TypeAdapter(CardBody),
    "document": TypeAdapter(DocumentBody),
    "correction": TypeAdapter(CorrectionBody),
    "inquiry_answer": TypeAdapter(InquiryAnswerBody),
    "note": TypeAdapter(NoteBody),
}


class SourceEnvelope(_Strict):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_: Literal["mxwp-source/1"] = Field(alias="schema")
    kind: SourceKind
    origin: Origin
    title: str = Field(min_length=1, max_length=300)
    captured_at: datetime
    owner: Owner | None = None
    audience: list[str]
    sensitivity: Literal["public", "internal", "restricted"]
    subject_hints: list[SubjectHint] = Field(default_factory=list)
    body: dict[str, Any]
    attachments: list[Attachment] = Field(default_factory=list)
    consent: Consent | None = None

    _parsed_body: BaseModel = PrivateAttr()

    @field_validator("audience")
    @classmethod
    def _audience(cls, v: list[str]) -> list[str]:
        return normalize_audience(v)

    @field_validator("captured_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("captured_at 에 시간대가 없다 — 예 2026-10-24T10:00:00+09:00")
        return v

    @model_validator(mode="after")
    def _body_for_kind(self) -> SourceEnvelope:
        try:
            self._parsed_body = _BODY_ADAPTERS[self.kind].validate_python(self.body)
        except ValidationError as e:
            # 그대로 올리면 위치가 'setup.conditions…' 로 나와 봉투의 어느 칸인지 모른다 — 'body.' 를 앞에 붙인다.
            raise ValidationError.from_exception_data(
                "SourceEnvelope",
                [
                    {"type": err["type"], "loc": ("body", *err["loc"]), "input": err["input"],
                     **({"ctx": err["ctx"]} if "ctx" in err else {})}
                    for err in e.errors(include_url=False)
                ],
            ) from None
        return self

    @property
    def parsed_body(self) -> BaseModel:
        return self._parsed_body

    def payload(self) -> dict[str, Any]:
        """정규화한 본문 — `wiki_sources.payload` 에 담는 꼴(빈 선택 칸은 뺀다)."""
        return self._parsed_body.model_dump(mode="json", by_alias=True, exclude_none=True)

    def payload_sha256(self) -> str:
        """정규 JSON(키 정렬 · 공백 없음)의 sha256 — 멱등 열쇠의 한 칸(CONTRACTS §2-2)."""
        canon = json.dumps(self.payload(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canon.encode("utf-8")).hexdigest()
