"""DocumentJSON 파일 한 개를 본 백엔드 파이프라인으로 멱등하게 import.

Usage:
    apptainer exec instance://mxwp_api /bin/sh -c \\
      "cd /workspace/apps/api && python -m app.scripts.import_one /path/to/doc.json"

처리 흐름:
  1. 파일 로드 + DocumentJSON v1.0 검증
  2. slug 가 이미 있으면 PUT (replace), 없으면 POST (create)
  3. 결과: links/tags/glossary/감사로그/검색인덱스 모두 자동 갱신
  4. resolved 페이지 URL + 트리 path 출력

POST/PUT 이 아닌 *서비스 레이어*를 직접 호출하므로 인증 우회가 필요한
임포트 시나리오에서 안전하게 사용 가능 (admin user 로 동작).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from sqlalchemy import text


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if value.startswith(('"', "'")):
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        else:
            hp = value.find(" #")
            if hp != -1:
                value = value[:hp]
            value = value.strip()
        os.environ.setdefault(key, value)


for _candidate in (
    Path("/workspace/.env"),
    Path(__file__).resolve().parents[3] / ".env",
):
    _load_env_file(_candidate)


from app.core.db import session_scope
from app.repos import document_repo
from app.services import document_service


async def _resolve_path(s, doc: dict) -> str:
    """문서가 속한 division/team/group/part 슬러그 path 를 만든다."""
    if not doc.get("part_id"):
        return "(미배치 — metadata.part 미해석)"
    row = (await s.execute(
        text("""
            SELECT d.slug, t.slug, g.slug, p.slug
            FROM parts p
            JOIN groups g ON g.id = p.group_id
            JOIN teams t ON t.id = g.team_id
            JOIN divisions d ON d.id = t.division_id
            WHERE p.id = :pid
        """),
        {"pid": doc["part_id"]},
    )).first()
    if not row:
        return "(parts row 없음)"
    return f"/{row[0]}/{row[1]}/{row[2]}/{row[3]}"


async def import_one(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    slug = payload.get("slug")
    if not slug:
        raise SystemExit("payload.slug 가 없습니다.")
    async with session_scope() as s:
        owner_id = await document_repo.fetch_admin_owner_id(s)
        existing = await document_repo.find_by_slug(s, slug)
        if existing is None:
            doc, warnings = await document_service.create_document(
                s, payload=payload, owner_id=owner_id
            )
            mode = "create"
        else:
            etag = document_service.make_etag(existing["id"], existing["version"])
            doc, warnings = await document_service.replace_document(
                s,
                slug=slug,
                payload=payload,
                if_match=etag,
                actor_id=owner_id,
                change_log="import_one",
            )
            mode = "replace"
        path_str = await _resolve_path(s, doc)
    return {
        "mode": mode,
        "slug": doc["slug"],
        "version": doc["version"],
        "url": f"/api/v1/documents/{doc['slug']}",
        "tree_path": path_str,
        "warnings": warnings,
    }


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m app.scripts.import_one <path-to-DocumentJSON>")
        raise SystemExit(2)
    p = Path(sys.argv[1])
    if not p.exists():
        raise SystemExit(f"파일을 찾을 수 없습니다: {p}")
    result = asyncio.run(import_one(p))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
