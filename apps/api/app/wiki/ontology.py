# 위키 온톨로지 — 엔티티 유형 · 술어 표 읽기 · 제안 → admin 승인 · 거절, 관계가 술어의 정의역 · 치역에 맞나
"""request §5-10 · CONTRACTS §2-6 · SCHEMA-DRAFT §4 · §5. 용어집과 같은 길 — editor 가 제안하고 admin 이 승인하거나 까닭을 달아 거절한다.

- 들이기는 approved 만 쓴다 — 새 엔티티의 유형 · 관계의 술어(V7).
- 위임 호출은 admin 이 owner 로 깎여 승인하지 못한다(AI 가 사람 명의로 승인하지 않게 — core/auth._resolve_delegated).
- 기록은 `ontology` 한 줄(제안 · 승인 · 거절). 범위는 전사(`["org"]`) — 유형 · 술어 이름에는 범위가 없다.
- 첫 판(0054 유형 14 · 0056 술어 18)은 마이그레이션이 approved 로 넣었다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.repos import document_repo

Kind = Literal["types", "predicates"]
_TABLE = {"types": "wiki_entity_types", "predicates": "wiki_predicates"}
_LABEL = {"types": "유형", "predicates": "술어"}
_KEY = r"^[a-z][a-z0-9-]{1,40}$"


@dataclass(frozen=True)
class Predicate:
    key: str
    label_ko: str
    inverse_ko: str
    domain_types: tuple[str, ...]
    range_types: tuple[str, ...]
    symmetric: bool

    def fits(self, subject_type: str, object_type: str) -> bool:
        """주어 · 목적어 유형이 정의역 · 치역에 맞나(빈 칸은 아무 유형). same-as 는 같은 유형끼리, 대칭은 뒤집어도 된다."""
        if self.key == "same-as":
            return subject_type == object_type

        def ok(allowed: tuple[str, ...], t: str) -> bool:
            return not allowed or t in allowed

        if ok(self.domain_types, subject_type) and ok(self.range_types, object_type):
            return True
        return self.symmetric and ok(self.domain_types, object_type) and ok(self.range_types, subject_type)


async def predicates(s: AsyncSession) -> dict[str, Predicate]:
    rows = (await s.execute(text("""
        SELECT key, label_ko, inverse_ko, domain_types, range_types, is_symmetric
          FROM wiki_predicates WHERE status = 'approved' ORDER BY key
    """))).all()
    return {r[0]: Predicate(r[0], r[1], r[2], tuple(r[3]), tuple(r[4]), bool(r[5])) for r in rows}


async def approved_types(s: AsyncSession) -> set[str]:
    return {r[0] for r in (await s.execute(text("SELECT key FROM wiki_entity_types WHERE status = 'approved'"))).all()}


def _iso(v: Any) -> str | None:
    return v.isoformat() if v else None


async def listing(s: AsyncSession, *, status: str | None = None) -> dict[str, list[dict[str, Any]]]:
    """유형 · 술어 — `status` 가 비면 모두(제안 · 거절도 — 이름에 범위가 없어 감추지 않는다)."""
    where, params = ("WHERE status = :st", {"st": status}) if status else ("", {})
    types = [{"key": r[0], "label_ko": r[1], "label_en": r[2], "parent_key": r[3], "abbr": r[4], "description": r[5],
              "ext_axes": r[6], "status": r[7], "decided_at": _iso(r[8]), "decision_note": r[9], "created_at": _iso(r[10]),
              "entities": int(r[11])}
             for r in (await s.execute(text(f"""
                 SELECT t.key, t.label_ko, t.label_en, t.parent_key, t.abbr, t.description, t.ext_axes, t.status, t.decided_at,
                        t.decision_note, t.created_at,
                        (SELECT count(*) FROM wiki_entities e WHERE e.type_key = t.key AND e.status = 'active')
                   FROM wiki_entity_types t {where} ORDER BY t.status, t.created_at, t.key
             """), params)).all()]
    preds = [{"key": r[0], "label_ko": r[1], "inverse_ko": r[2], "domain_types": list(r[3]), "range_types": list(r[4]),
              "symmetric": bool(r[5]), "description": r[6], "status": r[7], "decided_at": _iso(r[8]),
              "decision_note": r[9], "created_at": _iso(r[10])}
             for r in (await s.execute(text(f"""
                 SELECT key, label_ko, inverse_ko, domain_types, range_types, is_symmetric, description, status, decided_at,
                        decision_note, created_at
                   FROM wiki_predicates {where} ORDER BY status, created_at, key
             """), params)).all()]
    return {"types": types, "predicates": preds}


class TypeProposal(BaseModel):
    key: str = Field(pattern=_KEY)
    label_ko: str = Field(min_length=1, max_length=60)
    label_en: str | None = Field(default=None, max_length=60)
    abbr: str = Field(pattern=r"^[a-z][a-z0-9]{0,11}$", description="slug 약어(SCHEMA-DRAFT §3)")
    parent_key: str | None = None
    description: str | None = Field(default=None, max_length=1000)
    ext_axes: dict[str, Any] = Field(default_factory=dict, description="바깥 어휘 대응 — 축 이름 · ext_ids 칸")


class PredicateProposal(BaseModel):
    key: str = Field(pattern=_KEY)
    label_ko: str = Field(min_length=1, max_length=60, description="[[B]] 뒤에 붙여 읽는 말 — 예 '의 일부다'")
    inverse_ko: str = Field(min_length=1, max_length=60)
    domain_types: list[str] = Field(default_factory=list, max_length=20)
    range_types: list[str] = Field(default_factory=list, max_length=20)
    symmetric: bool = False
    description: str | None = Field(default=None, max_length=1000)


async def _log(s: AsyncSession, title: str, detail: dict[str, Any], user: dict[str, Any]) -> None:
    await s.execute(text("""
        INSERT INTO wiki_log (op, title, detail, actor, audience) VALUES ('ontology', :t, CAST(:d AS jsonb), :a, ARRAY['org'])
    """), {"t": title, "d": json.dumps(detail, ensure_ascii=False), "a": f"user:{user['id']}"})


async def _taken(s: AsyncSession, kind: Kind, key: str) -> None:
    st = (await s.execute(text(f"SELECT status FROM {_TABLE[kind]} WHERE key = :k"), {"k": key})).scalar()
    if st is not None:
        raise Conflict(f"{_LABEL[kind]} {key} 가 이미 있다({st})", details={"key": key, "status": st})


async def propose_type(s: AsyncSession, body: TypeProposal, *, user: dict[str, Any]) -> dict[str, Any]:
    await _taken(s, "types", body.key)
    if (await s.execute(text("SELECT 1 FROM wiki_entity_types WHERE abbr = :a"), {"a": body.abbr})).first():
        raise Conflict(f"slug 약어 {body.abbr} 를 다른 유형이 쓴다", details={"abbr": body.abbr})
    if body.parent_key and body.parent_key not in await approved_types(s):
        raise ValidationFailed(f"상위 유형 {body.parent_key} 가 승인된 유형이 아니다", details={"parent_key": body.parent_key})
    await s.execute(text("""
        INSERT INTO wiki_entity_types (key, label_ko, label_en, parent_key, abbr, description, ext_axes, status, proposed_by)
        VALUES (:k, :ko, :en, :p, :ab, :d, CAST(:ax AS jsonb), 'proposed', CAST(:u AS uuid))
    """), {"k": body.key, "ko": body.label_ko, "en": body.label_en, "p": body.parent_key, "ab": body.abbr,
           "d": body.description, "ax": json.dumps(body.ext_axes, ensure_ascii=False), "u": user["id"]})
    return await _finish(s, "types", body.key, "propose", user)


async def propose_predicate(s: AsyncSession, body: PredicateProposal, *, user: dict[str, Any]) -> dict[str, Any]:
    await _taken(s, "predicates", body.key)
    unknown = sorted(set(body.domain_types + body.range_types) - await approved_types(s))
    if unknown:
        raise ValidationFailed(f"승인된 유형이 아니다 — {', '.join(unknown)}", details={"unknown_types": unknown})
    await s.execute(text("""
        INSERT INTO wiki_predicates (key, label_ko, inverse_ko, domain_types, range_types, is_symmetric, description, status,
                                     proposed_by)
        VALUES (:k, :ko, :inv, CAST(:dom AS text[]), CAST(:rng AS text[]), :sym, :d, 'proposed', CAST(:u AS uuid))
    """), {"k": body.key, "ko": body.label_ko, "inv": body.label_ko if body.symmetric else body.inverse_ko,
           "dom": sorted(set(body.domain_types)), "rng": sorted(set(body.range_types)), "sym": body.symmetric,
           "d": body.description, "u": user["id"]})
    return await _finish(s, "predicates", body.key, "propose", user)


async def decide(s: AsyncSession, kind: Kind, key: str, *, approve: bool, user: dict[str, Any],
                 note: str | None) -> dict[str, Any]:
    st = (await s.execute(text(f"SELECT status FROM {_TABLE[kind]} WHERE key = :k FOR UPDATE"), {"k": key})).scalar()
    if st is None:
        raise NotFound(f"{_LABEL[kind]} {key} 가 없다")
    if st != "proposed":
        raise Conflict(f"제안 중인 것만 정한다(지금 {st})", details={"status": st})
    note = (note or "").strip() or None
    if not approve and not note:
        raise ValidationFailed("거절에는 까닭 한 줄이 있어야 한다")
    await s.execute(text(f"""
        UPDATE {_TABLE[kind]} SET status = :st, decided_at = NOW(), decision_note = :n,
               approved_by = CASE WHEN :st = 'approved' THEN CAST(:u AS uuid) END
         WHERE key = :k
    """), {"st": "approved" if approve else "rejected", "n": note, "u": user["id"], "k": key})
    return await _finish(s, kind, key, "approve" if approve else "reject", user, note=note)


async def _finish(s: AsyncSession, kind: Kind, key: str, action: str, user: dict[str, Any],
                  note: str | None = None) -> dict[str, Any]:
    word = {"propose": "제안", "approve": "승인", "reject": "거절"}[action]
    detail = {"action": action, "kind": kind, "key": key, **({"note": note} if note else {})}
    await _log(s, f"{_LABEL[kind]} {word} · {key}", detail, user)
    await document_repo.insert_audit(s, user_id=user["id"], action=f"wiki.ontology.{action}", target=f"wiki_{kind}:{key}",
                                     payload=detail)
    await s.commit()
    row = next(r for r in (await listing(s))[kind] if r["key"] == key)
    return row
