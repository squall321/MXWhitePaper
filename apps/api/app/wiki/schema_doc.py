# 위키 규칙서 문서 올리기 — 없으면 설명 한 절 + 기계용 YAML 한 덩이로 만들고, 있으면 그 YAML 블록만 바꾼다(admin · 판이 오른다)
"""request §5-3 · CONTRACTS §6 `GET /schema` · `PUT /schema`.

문서 `wiki-schema` 는 종류 `schema` · `managed='human'` · 범위 `["org"]`(모두 읽는다). YAML 은 저장 길(`validate_documentjson`)이 다시
검사하고 admin 이 아니면 막는다 — 여기서 미리 검사하는 것은 오류를 422 로 먼저 돌려주기 위해서다.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.services import document_service
from app.wiki import pages
from app.wiki import schema as wiki_schema

TITLE = "위키 규칙서"
_ABOUT = ("AI 위키 관리자가 지키는 규칙 · 문서 종류와 절 꼴 · 정책 · 예산이다. 아래 '기계용 YAML' 한 덩이가 정본이다 — 프롬프트는 그 "
          "rules 를 그대로 싣고, 변경 묶음은 이 문서의 판 번호를 남긴다. 고치기는 admin 만 하고, YAML 이 틀리면 저장되지 않는다.")


def _skeleton(yaml_text: str, owner_email: str) -> dict[str, Any]:
    return {
        "schema_version": "1.0", "id": pages.new_id(), "slug": wiki_schema.SLUG, "title": TITLE,
        "summary": "AI 위키 관리자가 지키는 규칙 · 절 꼴 · 정책 — 아래 YAML 이 정본",
        "metadata": {"division": get_settings().import_default_division, "owners": [owner_email],
                     "confidentiality": "internal"},
        "sections": [
            {"id": pages.new_id(), "level": 1, "title": "이 문서", "subsections": [],
             "blocks": [{"type": "paragraph", "id": pages.new_id(), "text": _ABOUT}]},
            {"id": pages.new_id(), "level": 1, "title": "기계용 YAML", "subsections": [],
             "blocks": [{"type": "code", "id": pages.new_id(), "language": "yaml", "code": yaml_text}]},
        ],
    }


async def _doc(s: AsyncSession) -> dict[str, Any] | None:
    row = (await s.execute(text("""
        SELECT id, version, content_json FROM documents WHERE slug = :slug AND status <> 'archived'
    """), {"slug": wiki_schema.SLUG})).first()
    if row is None:
        return None
    return {"id": str(row[0]), "version": int(row[1]),
            "content": json.loads(row[2]) if isinstance(row[2], str) else row[2]}


async def current(s: AsyncSession) -> dict[str, Any]:
    doc = await _doc(s)
    book = await wiki_schema.load(s)
    yaml_text = wiki_schema.DEFAULT_YAML
    if doc is not None:
        yaml_text = next(iter(wiki_schema._yaml_blocks(doc["content"])), yaml_text)
    return {"slug": wiki_schema.SLUG, "exists": doc is not None, "version": book.version, "yaml": yaml_text,
            "spec": book.spec.model_dump(mode="json")}


async def put(s: AsyncSession, yaml_text: str, *, user: dict[str, Any]) -> dict[str, Any]:
    try:
        wiki_schema.parse_yaml(yaml_text)
    except wiki_schema.RuleBookError as e:
        raise ValidationFailed(f"위키 규칙서가 틀렸다 — {e}", details={"errors": e.errors}) from None
    doc = await _doc(s)
    if doc is None:
        created, _ = await document_service.create_document(
            s, payload=_skeleton(yaml_text, str(user["email"])), owner_id=str(user["id"]),
            wiki={"kind": "schema", "audience": ["org"], "managed": "human"})
        return {"slug": wiki_schema.SLUG, "version": int(created["version"]), "created": True}
    content = dict(doc["content"])
    blocks = [b for sec in pages.walk_sections(content) for b in sec.get("blocks") or []
              if b.get("type") == "code" and str(b.get("language") or "").lower() in ("yaml", "yml")]
    if len(blocks) != 1:
        raise ValidationFailed(f"규칙서 문서에 YAML 코드 블록이 하나 있어야 한다(지금 {len(blocks)}개) — 문서를 먼저 고친다")
    blocks[0]["code"] = yaml_text
    saved, _ = await document_service.replace_document(
        s, slug=wiki_schema.SLUG, payload=content, if_match=document_service.make_etag(doc["id"], doc["version"]),
        actor_id=str(user["id"]), change_log="wiki schema")
    return {"slug": wiki_schema.SLUG, "version": int(saved["version"]), "created": False}
