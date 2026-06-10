"""시스템 지식 Meilisearch 인덱서 (Phase 5).

repo 의 docs/ 마크다운을 `knowledge` 인덱스로 적재한다:
  - docs/lat/*.md + docs/*.md (1-depth) — H2 (## ) 단위 섹션 1건 = 1 doc
  - docs/archive/*/_INDEX.md — 표 데이터 행당 1 doc (kind=archive)

클라이언트/retry 는 meili_indexer 의 것을 재사용. id 는 경로+heading slug
의 sha1 12자 — 재인덱스 시 같은 섹션이 같은 id 로 upsert 된다.
"""
from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Any

import meilisearch

from app.search.meili_indexer import _call_meili_with_retry, get_client

logger = logging.getLogger(__name__)

INDEX_UID = "knowledge"
PRIMARY_KEY = "id"

SEARCHABLE_ATTRS = ["heading", "body", "area"]
FILTERABLE_ATTRS = ["kind", "area"]

# knowledge_indexer.py = apps/api/app/search/ → parents[4] = repo root
# (컨테이너에선 /workspace).
_REPO_ROOT = Path(__file__).resolve().parents[4]

_NON_SLUG = re.compile(r"[^a-z0-9가-힣\-]+")
_DASHES = re.compile(r"-{2,}")
# archive _INDEX.md 의 셀 구분 — escape 된 `\|` 는 셀 내부 문자.
_UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")


def _slugify(s: str) -> str:
    out = re.sub(r"\s+", "-", s.strip().lower())
    out = _NON_SLUG.sub("", out)
    return _DASHES.sub("-", out).strip("-") or "x"


def _doc_id(doc_path: str, heading_slug: str) -> str:
    return hashlib.sha1(f"{doc_path}#{heading_slug}".encode()).hexdigest()[:12]


def _split_h2_sections(text: str, fallback_heading: str) -> list[tuple[str, str]]:
    """(heading, body) 목록 — H2 단위 분할. 첫 H2 이전 본문은 H1 제목
    (없으면 fallback) 을 heading 으로 묶는다. 빈 본문 섹션은 버린다."""
    out: list[tuple[str, str]] = []
    heading = fallback_heading
    buf: list[str] = []
    in_preamble = True
    for line in text.splitlines():
        if line.startswith("## "):
            body = "\n".join(buf).strip()
            if body:
                out.append((heading, body))
            heading = line[3:].strip() or fallback_heading
            buf = []
            in_preamble = False
        elif in_preamble and line.startswith("# "):
            heading = line[2:].strip() or fallback_heading
        else:
            buf.append(line)
    body = "\n".join(buf).strip()
    if body:
        out.append((heading, body))
    return out


def _markdown_docs(repo_root: Path) -> list[dict[str, Any]]:
    targets: list[tuple[Path, str]] = []
    for p in sorted((repo_root / "docs" / "lat").glob("*.md")):
        targets.append((p, "lat"))
    for p in sorted((repo_root / "docs").glob("*.md")):
        targets.append((p, "guide" if p.name.startswith("llm-") else "doc"))

    docs: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for path, kind in targets:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning("knowledge: cannot read %s: %s", path, e)
            continue
        rel = path.relative_to(repo_root).as_posix()
        for heading, body in _split_h2_sections(text, path.stem):
            slug = _slugify(heading)
            key = f"{rel}#{slug}"
            if key in seen_keys:  # 같은 파일에 동일 heading 중복
                n = 2
                while f"{key}-{n}" in seen_keys:
                    n += 1
                key = f"{key}-{n}"
                slug = key.rsplit("#", 1)[1]
            seen_keys.add(key)
            docs.append({
                "id": _doc_id(rel, slug),
                "doc_path": rel,
                "area": path.stem,
                "heading": heading,
                "body": body,
                "kind": kind,
            })
    return docs


def _archive_docs(repo_root: Path) -> list[dict[str, Any]]:
    """docs/archive/*/_INDEX.md 의 표 데이터 행당 1 doc.

    셀 1 (feature) 에 raw `|` 가 들어갈 수 있어 마지막 3 컬럼 (match/date/
    path) 을 기준으로 앞부분을 다시 합친다 — toolkit chunker 의 검증된 패턴.
    """
    docs: list[dict[str, Any]] = []
    seen_slugs: set[str] = set()
    for path in sorted(repo_root.glob("docs/archive/*/_INDEX.md")):
        month = path.parent.name
        rel = path.relative_to(repo_root).as_posix()
        for ln in path.read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if not ln.startswith("|"):
                continue
            cells = _UNESCAPED_PIPE.split(ln)[1:-1]
            if len(cells) < 4:
                continue
            feature_cell = "|".join(cells[:-3]).strip()
            if not feature_cell:
                continue
            if feature_cell.lower().startswith("feature"):  # header row
                continue
            if set(feature_cell) <= {"-", ":"}:  # divider row
                continue
            name_part = feature_cell.split("(", 1)[0].strip()
            if not name_part:
                continue
            feature = name_part.split()[0]
            slug = f"{month}-{_slugify(feature)}"
            if slug in seen_slugs:  # 같은 달에 같은 feature 두 번
                n = 2
                while f"{slug}-{n}" in seen_slugs:
                    n += 1
                slug = f"{slug}-{n}"
            seen_slugs.add(slug)
            docs.append({
                "id": _doc_id(rel, slug),
                "doc_path": rel,
                "area": month,
                "heading": feature,
                "body": feature_cell.replace("\\|", "|"),
                "kind": "archive",
            })
    return docs


def collect_docs(repo_root: Path | None = None) -> list[dict[str, Any]]:
    root = repo_root or _REPO_ROOT
    return _markdown_docs(root) + _archive_docs(root)


def ensure_index() -> dict[str, Any]:
    """`knowledge` 인덱스 + settings 보장. 이미 있으면 settings 만 갱신."""
    cli = get_client()
    try:
        cli.create_index(INDEX_UID, {"primaryKey": PRIMARY_KEY})
    except meilisearch.errors.MeilisearchApiError:  # type: ignore[attr-defined]  # meilisearch stub omits the errors submodule
        # 이미 존재 — 무시.
        pass
    idx = cli.index(INDEX_UID)
    idx.update_settings({
        "searchableAttributes": SEARCHABLE_ATTRS,
        "filterableAttributes": FILTERABLE_ATTRS,
        "displayedAttributes": ["*"],
    })
    return {"uid": INDEX_UID, "primary_key": PRIMARY_KEY}


def _wait_task(cli: meilisearch.Client, task: Any) -> None:
    try:
        tid = getattr(task, "task_uid", None) or (
            task.get("taskUid") if isinstance(task, dict) else None
        )
        if tid is not None:
            cli.wait_for_task(tid, timeout_in_ms=10000)
    except Exception as e:
        logger.warning("knowledge wait_for_task failed: %s", e)


def rebuild_index() -> dict[str, Any]:
    """전량 교체 — delete_all 후 add. 반환 {count, by_kind}."""
    ensure_index()
    docs = collect_docs()
    cli = get_client()
    idx = cli.index(INDEX_UID)

    _wait_task(cli, _call_meili_with_retry(
        "knowledge delete_all", idx.delete_all_documents
    ))
    if docs:
        _wait_task(cli, _call_meili_with_retry(
            "knowledge add",
            lambda: idx.add_documents(docs, primary_key=PRIMARY_KEY),
        ))

    by_kind: dict[str, int] = {}
    for d in docs:
        by_kind[d["kind"]] = by_kind.get(d["kind"], 0) + 1
    return {"count": len(docs), "by_kind": by_kind}


def search(
    *,
    q: str,
    limit: int = 20,
    offset: int = 0,
    kind: str | None = None,
) -> dict[str, Any]:
    cli = get_client()
    idx = cli.index(INDEX_UID)
    payload: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "attributesToHighlight": ["heading", "body"],
        "attributesToCrop": ["body"],
        "cropLength": 30,
        "highlightPreTag": "<mark>",
        "highlightPostTag": "</mark>",
    }
    if kind:
        safe = str(kind).replace('"', '\\"')
        payload["filter"] = f'kind = "{safe}"'
    return idx.search(q, payload)
