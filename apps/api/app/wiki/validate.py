# 위키 변경 묶음 검증 V1~V11 — 코드가 판정한다(모델에게 묻지 않는다). 규칙마다 판정 하나 · 까닭을 낸다
"""CONTRACTS §5.

판정 넷 — `pass` · `warn`(반영해도 된다) · `review`(사람이 본다 → pending_review) · `fail`(반영하지 않는다 → failed).
- V1 schema · V2 cited · V3 numbers · V4 audience · V7 ontology · V8 links · V10 quote 가 걸리면 fail. V4 는 계약에 '사람에게 넘김' 이지만
  그대로 승인하면 좁은 사실이 넓은 문서로 새므로 반영하지 않는 쪽(fail)에 두고, 사람은 실패 목록에서 본다.
- V5 locked · V6 scope 는 review. V9 privacy 는 가린 뒤 warn(연산의 블록을 고친다). V11 style 은 warn.
- 숫자(V3) — 블록의 숫자(+단위)가 인용한 원천의 payload(숫자 칸과 글 속 숫자) · 제목에 있어야 한다. 단위는 접두어만 맞추고(mm ↔ m · MPa ↔ Pa),
  반올림은 블록에 적힌 자릿수까지 허용한다. `계산: 식 = 값` 은 식을 셈해 값을 맞추고, 식의 수가 원천에 있어야 한다. 날짜(YYYY-MM-DD)는
  원천의 글 · 생긴 날에 있어야 한다. 시각(HH:MM)은 보지 않는다.
- 관계(`relation.add` — W5) — V7 술어가 approved 인가 · 정의역 · 치역 · 두 끝이 후보인가, V2 근거, V4 인용한 원천 범위가 두 끝 문서에
  다 있나, V10 인용 길이, V5 사람 · 잠금 문서의 '관계(자동)' 가 바뀐다. 묶음 크기(V6)는 블록 연산만 센다.
"""
from __future__ import annotations

import ast
import json
import operator
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from app.schemas.document import Block
from app.wiki import pages
from app.wiki.ontology import Predicate
from app.wiki.resolve import Target
from app.wiki.schema import RuleBook

KST = ZoneInfo("Asia/Seoul")
FACT_TYPES = {"paragraph", "list", "table", "callout", "quote", "kpi-cards", "chart", "timeline"}
HARD = ("V1", "V2", "V3", "V4", "V7", "V8", "V10")
_DOC_MAX_BYTES = 2_000_000
_NUM = re.compile(r"(?<![A-Za-z0-9_.\-])(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)"
                  r"(?:\s?([A-Za-zµμ°%²³]+(?:/[A-Za-z²³]+)?))?(?![A-Za-z0-9])")
_DATE = re.compile(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)")
_TIME = re.compile(r"(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)")
_CALC = re.compile(r"계산\s*[:：]\s*([0-9.,\s+\-*/×÷()]+?)\s*=\s*(-?\d[\d,]*(?:\.\d+)?)")
_LINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<!\d)(?:\+?82[- ]?)?0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}(?!\d)")
_EMPNO = re.compile(r"사번\s*[:：]?\s*[A-Za-z]?\d{5,10}")
_NON_SI = re.compile(r"(?<![A-Za-z])(inch(?:es)?|ft|feet|lbs?|psi|°F)(?![A-Za-z])")
_US_DATE = re.compile(r"(?<!\d)\d{1,2}/\d{1,2}/\d{2,4}(?!\d)")
_UNITS = {
    "um": ("m", 1e-6), "µm": ("m", 1e-6), "μm": ("m", 1e-6), "mm": ("m", 1e-3), "cm": ("m", 1e-2), "m": ("m", 1.0),
    "km": ("m", 1e3), "pa": ("Pa", 1.0), "kpa": ("Pa", 1e3), "mpa": ("Pa", 1e6), "gpa": ("Pa", 1e9),
    "n/mm²": ("Pa", 1e6), "n/mm2": ("Pa", 1e6), "g": ("kg", 1e-3), "kg": ("kg", 1.0), "ms": ("s", 1e-3),
    "s": ("s", 1.0), "n": ("N", 1.0), "kn": ("N", 1e3), "%": ("%", 1.0),
}
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


@dataclass
class Check:
    rule: str
    verdict: str  # pass · warn · review · fail
    detail: str = ""

    def as_dict(self) -> dict[str, str]:
        return {"rule": self.rule, "verdict": self.verdict, "detail": self.detail}


@dataclass
class Context:
    book: RuleBook
    targets: dict[str, Target]  # 계획이 고른 문서(slug → 문서)
    base: dict[str, dict[str, Any]]  # slug → 연산을 얹을 내용(있는 문서는 지금 내용, 새 문서는 빈 꼴)
    sources: dict[str, dict[str, Any]]  # source_id → {payload, title, audience, kind, captured_at}
    existing_slugs: set[str] = field(default_factory=set)  # V8 — 링크가 가리키는 문서 중 있는 것
    link_audience: dict[str, list[str]] = field(default_factory=dict)  # 그 문서의 범위(위키 문서가 아니면 org)
    approved_types: set[str] = field(default_factory=set)
    cited_blocks: set[tuple[str, str]] = field(default_factory=set)  # (slug, block_id) — 근거가 이미 달린 블록
    predicates: dict[str, Predicate] = field(default_factory=dict)  # approved 술어
    endpoints: dict[str, Target] = field(default_factory=dict)  # 관계의 끝이 될 수 있는 문서(고른 문서 + 있는 후보)
    doubts: list[str] = field(default_factory=list)  # 엔티티 해석이 의심스러운 힌트(W5) — V7 검토


def _num(raw: str) -> tuple[float, int]:
    raw = raw.replace(",", "")
    return float(raw), len(raw.split(".", 1)[1]) if "." in raw else 0


def text_numbers(text: str) -> list[tuple[float, int, str | None]]:
    return [(*_num(m.group(1)), m.group(2)) for m in _NUM.finditer(text)]


def payload_numbers(payload: Any) -> list[tuple[float, str | None]]:
    """payload 의 숫자 칸(값 옆 unit 이 있으면 그 단위)과 글 속 숫자."""
    out: list[tuple[float, str | None]] = []

    def walk(v: Any, unit: str | None = None) -> None:
        if isinstance(v, dict):
            u = v.get("unit") if isinstance(v.get("unit"), str) else None
            for k, x in v.items():
                if k != "unit":
                    walk(x, u if k == "value" else None)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, bool):
            return
        elif isinstance(v, int | float):
            out.append((float(v), unit))
        elif isinstance(v, str):
            out.extend((val, u) for val, _, u in text_numbers(_TIME.sub(" ", v)))

    walk(payload)
    return out


def _strings(payload: Any) -> list[str]:
    if isinstance(payload, dict):
        return [s for v in payload.values() for s in _strings(v)]
    if isinstance(payload, list):
        return [s for v in payload for s in _strings(v)]
    return [payload] if isinstance(payload, str) else []


def _matches(value: float, decimals: int, unit: str | None, pool: list[tuple[float, str | None]]) -> bool:
    tu = _UNITS.get(unit.lower()) if unit else None
    for pv, punit in pool:
        pu = _UNITS.get(punit.lower()) if punit else None
        if tu and pu:
            if tu[0] != pu[0]:
                continue
            pv = pv * pu[1] / tu[1]
        if abs(round(pv, decimals) - value) <= 1e-9 * max(1.0, abs(value)):
            return True
    return False


def _eval(expr: str) -> float:
    node = ast.parse(expr.replace("×", "*").replace("÷", "/").replace(",", ""), mode="eval").body

    def ev(n: ast.AST) -> float:
        if isinstance(n, ast.Constant) and isinstance(n.value, int | float):
            return float(n.value)
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.USub):
            return -ev(n.operand)
        raise ValueError("식에는 수와 + - * / 괄호만")

    return ev(node)


def _number_problems(text: str, pool: list[tuple[float, str | None]], dates: set[str]) -> list[str]:
    problems: list[str] = []
    allowed: list[tuple[float, str | None]] = list(pool)
    for m in list(_CALC.finditer(text)):
        claimed, decimals = _num(m.group(2))
        try:
            result = _eval(m.group(1))
        except (ValueError, SyntaxError, ZeroDivisionError):
            problems.append(f"계산 식을 셀 수 없다 — {m.group(0)}")
            continue
        if abs(round(result, decimals) - claimed) > 1e-9 * max(1.0, abs(claimed)):
            problems.append(f"계산이 맞지 않는다 — {m.group(0)}(셈하면 {round(result, decimals + 2)})")
        problems.extend(f"계산의 수 {_fmt(v, d)} 가 원천에 없다" for v, d, u in text_numbers(m.group(1))
                        if not _matches(v, d, u, pool))
        allowed.append((claimed, None))
    text = _CALC.sub(" ", text)
    for d in _DATE.findall(text):
        if d not in dates:
            problems.append(f"원천에 없는 날짜 {d}")
    text = _TIME.sub(" ", _DATE.sub(" ", text))
    problems.extend(f"원천에 없는 숫자 {_fmt(v, d)}{(' ' + u) if u else ''}" for v, d, u in text_numbers(text)
                    if not _matches(v, d, u, allowed))
    return problems


def _fmt(v: float, decimals: int) -> str:
    return f"{v:.{decimals}f}"


def _mask(text: str) -> str:
    return _EMPNO.sub("[가림]", _PHONE.sub("[가림]", _EMAIL.sub("[가림]", text)))


def _section_owner(ctx: Context, target: Target, title: str | None) -> str:
    if not title:
        return "ai"
    return next((spec.owner for spec in ctx.book.sections(target.type_key) if spec.title == title), "ai")


def _block_section(content: dict[str, Any], block_id: str) -> tuple[str | None, dict[str, Any] | None]:
    found = pages.find_block(content, block_id)
    if found is None:
        return None, None
    sec, i = found
    return sec.get("title"), sec["blocks"][i]


def _relation(op: dict[str, Any], ctx: Context, found: dict[str, list[str]], review: dict[str, list[str]],
              quote_max: int) -> None:
    where = f"관계 {op['subject']} {op['predicate']} {op['object']}"
    subj, obj = ctx.endpoints.get(op["subject"]), ctx.endpoints.get(op["object"])
    pred = ctx.predicates.get(op["predicate"])
    if subj is None or obj is None:
        found["V7"].append(f"{where}: 끝이 후보 문서가 아니다")
        return
    if pred is None:
        found["V7"].append(f"{where}: 승인된 술어가 아니다")
    elif not pred.fits(subj.type_key, obj.type_key):
        found["V7"].append(f"{where}: 술어의 정의역 · 치역에 맞지 않는다({subj.type_key} → {obj.type_key})")
    if subj.slug == obj.slug:
        found["V7"].append(f"{where}: 자기 자신과의 관계다")
    cites = op.get("cites") or []
    if not cites:
        found["V2"].append(f"{where}: 관계에 근거가 없다")
    missing = [c.get("sid") for c in cites if c.get("source_id") not in ctx.sources]
    if missing:
        found["V2"].append(f"{where}: 근거 원천을 찾지 못했다 — {', '.join(str(m) for m in missing)}")
    for c in cites:
        src = ctx.sources.get(c.get("source_id") or "")
        if src is not None:
            narrow = set(src["audience"]) - {"org"}
            for end in (subj, obj):
                if not narrow <= set(end.audience):
                    found["V4"].append(f"{where}: 원천 범위 {sorted(src['audience'])} 가 {end.slug} 범위 {end.audience} 에 없다")
        if c.get("quote") and len(c["quote"]) > quote_max:
            found["V10"].append(f"{where}: 인용이 {len(c['quote'])}자 — {quote_max}자까지")
    for end in (subj, obj):
        if end.managed != "ai":
            review["V5"].append(f"{end.slug}: 사람이 관리하는 문서의 관계(자동) 절이 바뀐다")
        if end.review_lock:
            review["V5"].append(f"{end.slug}: 검토 잠금이 켜진 문서의 관계(자동) 절이 바뀐다")


def run(ops: list[dict[str, Any]], ctx: Context) -> list[Check]:
    """연산 목록을 본다. V9 는 블록의 개인정보 꼴을 가린다(연산을 그 자리에서 고친다)."""
    found: dict[str, list[str]] = {f"V{i}": [] for i in range(1, 12)}
    review: dict[str, list[str]] = {"V5": [], "V6": []}
    by_doc: dict[str, list[dict[str, Any]]] = {}
    for op in ops:
        if op["op"].startswith("block."):
            by_doc.setdefault(op["doc"], []).append(op)
    policy = ctx.book.spec.policy.auto_apply
    quote_max = ctx.book.spec.ingest.quote_max_chars

    # V9 먼저 — 가린 글로 나머지를 본다
    for op in ops:
        if op.get("block"):
            masked = pages.map_text(op["block"], _mask)
            if masked != op["block"]:
                found["V9"].append(f"{op['doc']} 블록 {op['block'].get('id') or op.get('block_id')}: 연락처 · 사번 꼴을 가렸다")
                op["block"] = masked

    for op in ops:
        doc, kind = op["doc"], op["op"]
        if kind.startswith("relation."):
            _relation(op, ctx, found, review, quote_max)
            continue
        target = ctx.targets.get(doc)
        where = f"{doc} 블록 {op.get('block_id') or (op.get('block') or {}).get('id')}"
        if target is None:
            review["V6"].append(f"{doc}: 계획에 없던 문서를 건드린다")
            continue
        base = ctx.base.get(doc) or {}
        if kind in ("block.update", "block.delete"):
            title, old = _block_section(base, op["block_id"])
            if old is None:
                found["V1"].append(f"{where}: 그 문서에 없는 블록이다")
                continue
            if (old.get("meta") or {}).get("locked"):
                review["V5"].append(f"{where}: 잠긴 블록을 고친다")
            if _section_owner(ctx, target, title) != "ai":
                review["V5"].append(f"{where}: AI 가 고치지 않는 절({title})이다")
            if kind == "block.delete":
                review["V6"].append(f"{where}: 지우는 연산은 늘 검토" +
                                    (" — 근거가 달린 블록" if (doc, op["block_id"]) in ctx.cited_blocks else ""))
        elif kind == "block.insert" and _section_owner(ctx, target, op.get("section")) != "ai":
            review["V5"].append(f"{doc} 절 {op.get('section')}: AI 가 쓰지 않는 절이다")
        if target.managed != "ai":
            review["V5"].append(f"{doc}: 사람이 관리하는 문서다")
        if target.review_lock:
            review["V5"].append(f"{doc}: 검토 잠금이 켜진 문서다")
        if target.kind in ctx.book.spec.policy.always_review_kinds:
            review["V5"].append(f"{doc}: 종류 {target.kind} 는 늘 검토")

        block = op.get("block")
        if block is None:
            continue
        try:
            Block.model_validate(block)
        except ValidationError as e:
            first = e.errors(include_url=False)[0]
            found["V1"].append(f"{where}: 블록 꼴이 틀렸다 — {'.'.join(str(x) for x in first['loc'])} {first['msg']}")
            continue
        cites = op.get("cites") or []
        if block.get("type") in FACT_TYPES and not cites:
            found["V2"].append(f"{where}: 사실 블록에 근거가 없다")
        missing = [c.get("sid") for c in cites if c.get("source_id") not in ctx.sources]
        if missing:
            found["V2"].append(f"{where}: 근거 원천을 찾지 못했다 — {', '.join(str(m) for m in missing)}")
        cited = [ctx.sources[c["source_id"]] for c in cites if c.get("source_id") in ctx.sources]
        body = pages.block_text(block)
        if cited and block.get("type") in FACT_TYPES:
            # 원천 제목도 생산자가 보낸 원천의 일부다(예 '… 3분기 …') — payload 와 함께 본다.
            pool = [n for src in cited for n in payload_numbers([src["payload"], src.get("title") or ""])]
            dates = {d for src in cited for s in _strings([src["payload"], src.get("title") or ""])
                     for d in _DATE.findall(s)}
            dates |= {src["captured_at"].astimezone(KST).strftime("%Y-%m-%d") for src in cited
                      if isinstance(src.get("captured_at"), datetime)}
            found["V3"].extend(f"{where}: {p}" for p in _number_problems(body, pool, dates))
        for src in cited:
            narrow = set(src["audience"]) - {"org"}
            if not narrow <= set(target.audience):
                found["V4"].append(f"{where}: 원천 범위 {sorted(src['audience'])} 가 문서 범위 {target.audience} 에 없다")
        for c in cites:
            if c.get("quote") and len(c["quote"]) > quote_max:
                found["V10"].append(f"{where}: 인용이 {len(c['quote'])}자 — {quote_max}자까지")
        for src in cited:
            if any(len(s) > quote_max and s[:quote_max] in body for s in _strings(src["payload"])):
                found["V10"].append(f"{where}: 원천 본문을 통째로 옮겼다")
        for slug in _LINK.findall(body):
            slug = slug.strip()
            if slug not in ctx.existing_slugs and slug not in ctx.targets:
                found["V8"].append(f"{where}: 없는 문서로 링크한다 — [[{slug}]]")
                continue
            linked = ctx.targets[slug].audience if slug in ctx.targets else ctx.link_audience.get(slug, ["org"])
            if not set(linked) - {"org"} <= set(target.audience):
                found["V8"].append(f"{where}: 더 좁은 문서로 링크한다 — [[{slug}]](범위 {linked})")
        if block.get("type") == "paragraph" and body.strip() and body.strip()[-1] not in ".?!)」』\"'":
            found["V11"].append(f"{where}: 문장 끝이 마침표가 아니다")
        if _NON_SI.search(body):
            found["V11"].append(f"{where}: SI 가 아닌 단위")
        if _US_DATE.search(body):
            found["V11"].append(f"{where}: 날짜는 YYYY-MM-DD")

    for target in ctx.targets.values():
        if target.entity and target.entity["type_key"] not in ctx.approved_types:
            found["V7"].append(f"{target.slug}: 승인되지 않은 유형 {target.entity['type_key']}")
    if ctx.doubts:
        review["V7"] = [f"엔티티 해석이 의심스럽다 — {d}" for d in ctx.doubts]
    for slug, doc_ops in by_doc.items():
        if slug not in ctx.targets:
            continue
        try:
            content = pages.apply_ops(ctx.base.get(slug) or {}, doc_ops)
            if len(json.dumps(content, ensure_ascii=False).encode("utf-8")) > _DOC_MAX_BYTES:
                found["V1"].append(f"{slug}: 문서가 {_DOC_MAX_BYTES} 바이트를 넘는다")
        except pages.PageOpError as e:
            found["V1"].append(f"{slug}: {e}")
    touched = len(by_doc)
    block_ops = sum(1 for op in ops if op["op"].startswith("block."))
    if touched > policy.max_docs:
        review["V6"].append(f"문서 {touched}장 — 한 묶음 {policy.max_docs}장까지")
    if block_ops > policy.max_blocks:
        review["V6"].append(f"블록 연산 {block_ops} — 한 묶음 {policy.max_blocks}까지")

    checks: list[Check] = []
    for i in range(1, 12):
        rule = f"V{i}"
        if found[rule] and rule in HARD:  # 실패가 검토보다 앞선다(V7 은 둘 다 날 수 있다)
            checks.append(Check(rule, "fail", "; ".join(found[rule])[:2000]))
        elif review.get(rule):
            checks.append(Check(rule, "review", "; ".join(review[rule])[:2000]))
        elif found[rule]:
            checks.append(Check(rule, "warn", "; ".join(found[rule])[:2000]))
        else:
            checks.append(Check(rule, "pass"))
    return checks


def decide(checks: list[Check], ops: list[dict[str, Any]], book: RuleBook) -> str:
    """auto_applied · pending_review · failed — 자동 반영은 fail · review 가 없고 지우는 연산이 없을 때(CONTRACTS §5)."""
    if any(c.verdict == "fail" for c in checks):
        return "failed"
    policy = book.spec.policy.auto_apply
    deletes = any(op["op"] == "block.delete" for op in ops)
    if any(c.verdict == "review" for c in checks) or not policy.enabled or (deletes and not policy.allow_delete):
        return "pending_review"
    return "auto_applied"
