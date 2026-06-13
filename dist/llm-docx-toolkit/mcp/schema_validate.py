"""Block 로컬 검증 — packages/shared/schemas/document.json 기반, API 호출 없음.

src/validate.py 가 문서 *전체* 를 검증하는 것과 달리, 여기는 block 한 개를
`$defs` 의 type-매칭 Block 정의 (properties.type.const == block["type"]) 로
검증한다. insert/update 도구가 전송 전에 호출해 잘못된 block 이 서버까지
가지 않게 한다 (Claude 가 에러를 보고 고쳐 재시도하는 루프).

에러 포맷: [{"path": "items/0", "message": "..."}] — path 는 block 루트
기준 JSON pointer 비슷한 슬래시 경로, 루트는 "(root)".
"""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any


def _schema_candidates() -> list[Path]:
    """src/validate.py 의 _load_schema 와 같은 탐색 순서.

    PyInstaller _MEIPASS → 모듈 형제 → 리포 체크아웃 (packages/shared)."""
    out: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        out.append(Path(meipass) / "document.schema.json")
        out.append(Path(meipass) / "document.json")
    here = Path(__file__).resolve().parent  # …/llm-docx-toolkit/mcp
    out.append(here / "document.schema.json")
    out.append(here.parent / "document.schema.json")
    # 개발 체크아웃: mcp → llm-docx-toolkit → dist → <repo root>
    if len(here.parents) >= 3:
        out.append(
            here.parents[2] / "packages" / "shared" / "schemas" / "document.json"
        )
    return out


@lru_cache(maxsize=1)
def _load_schema() -> dict[str, Any]:
    for p in _schema_candidates():
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    raise RuntimeError(
        "document.json schema not found in: "
        + ", ".join(str(p) for p in _schema_candidates())
    )


@lru_cache(maxsize=1)
def block_types() -> dict[str, str]:
    """type const → $defs 정의 이름 (e.g. 'paragraph' → 'ParagraphBlock')."""
    defs = _load_schema().get("$defs") or {}
    out: dict[str, str] = {}
    for name, d in defs.items():
        const = ((d.get("properties") or {}).get("type") or {}).get("const")
        if isinstance(const, str):
            out[const] = name
    return out


def validate_block(block: Any) -> list[dict[str, str]]:
    """block 1개를 type-매칭 Block 정의로 검증. 빈 리스트 = 유효."""
    if not isinstance(block, dict):
        return [{"path": "(root)", "message": "block 은 JSON object 여야 합니다"}]
    btype = block.get("type")
    if not isinstance(btype, str) or not btype:
        return [{"path": "type", "message": "필수 키 'type' (문자열) 누락"}]
    types = block_types()
    if btype not in types:
        known = ", ".join(sorted(types))
        return [
            {
                "path": "type",
                "message": f"알 수 없는 block type '{btype}' — 허용: {known}",
            }
        ]
    import jsonschema  # 컨테이너/바이너리 의존성 — api 가 이미 사용

    schema = _load_schema()
    sub = {"$ref": f"#/$defs/{types[btype]}", "$defs": schema["$defs"]}
    validator = jsonschema.Draft202012Validator(sub)
    errors: list[dict[str, str]] = []
    for err in sorted(validator.iter_errors(block), key=lambda e: list(e.absolute_path)):
        path = "/".join(str(p) for p in err.absolute_path) or "(root)"
        errors.append({"path": path, "message": err.message})
    return errors


__all__ = ["validate_block", "block_types"]
