"""namu-archive 문서들의 본문에 *다른 namu-archive 문서 title*이 plain text로
포함되어있으면 markdown inline link 로 변환.

전략:
1) DB 에서 namu-archive tag 가진 모든 doc 의 title + slug 추출
2) 각 doc 의 content_json.sections[].blocks[] 의 paragraph text 를 walk
3) *다른* doc 의 title 이 본문에 그대로 있으면 → `[title](/docs/<slug>)` 치환
4) 이미 link 안에 있는 텍스트는 건드리지 않음 (regex shield)
5) 자기 자신 title 은 skip
6) 최소 2자 이상 title 만 (false positive 방지)
7) 가장 긴 title 부터 우선 매칭 (예: "안드로이드 10" 이 "안드로이드" 보다 먼저)

usage (apptainer container 안에서):
  apptainer exec --bind "$PWD:$PWD" instance://mxwp_api bash -lc \\
    "cd $PWD && python3 examples/namu-archive-bulk/post-link.py --dry-run"

  # 실제 적용 + reindex
  apptainer exec --bind "$PWD:$PWD" instance://mxwp_api bash -lc \\
    "cd $PWD && python3 examples/namu-archive-bulk/post-link.py --apply --reindex"
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass

import asyncpg

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _env_or_default(line_prefix: str, default: str) -> str:
    env_path = os.path.join(REPO_ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith(line_prefix + "="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    return default


PG_HOST = "127.0.0.1"
PG_PORT = int(_env_or_default("POSTGRES_PORT", "5532"))
PG_USER = _env_or_default("POSTGRES_USER", "mxwp")
PG_PW = _env_or_default("POSTGRES_PASSWORD", "mxwp_dev_password_change_me")
PG_DB = _env_or_default("POSTGRES_DB", "mxwp")


@dataclass
class Doc:
    id: str
    slug: str
    title: str
    content_json: dict


# already-linked text pattern
LINK_RE = re.compile(r'\[[^\]]*?\]\([^)]*?\)')


def link_text(text: str, idx: list[tuple[str, str, str]], self_id: str) -> tuple[str, int]:
    """text 안의 title 들을 markdown link 로 치환."""
    if not text:
        return text, 0

    placeholders: list[str] = []

    def _shield(m: re.Match[str]) -> str:
        placeholders.append(m.group(0))
        return f"\x00{len(placeholders) - 1}\x00"

    shielded = LINK_RE.sub(_shield, text)
    replacements = 0

    for title, slug, doc_id in idx:
        if doc_id == self_id:
            continue
        title_re = re.escape(title)
        # 한글 텍스트라 word boundary 안 통함. 앞뒤 컨텍스트가 시작/끝/공백/문장부호여야 매칭
        BOUNDARY = r'(?:^|(?<=[\s.,;:!?()\[\]\'"‘’“”]))'
        BOUNDARY_END = r'(?=$|[\s.,;:!?()\[\]\'"‘’“”])'
        pattern = BOUNDARY + title_re + BOUNDARY_END

        def _replace(m: re.Match[str], _t=title, _s=slug) -> str:
            placeholders.append(f"[{_t}](/docs/{_s})")
            return f"\x00{len(placeholders) - 1}\x00"

        new_shielded, n = re.subn(pattern, _replace, shielded)
        if n > 0:
            replacements += n
            shielded = new_shielded

    def _restore(m: re.Match[str]) -> str:
        return placeholders[int(m.group(1))]

    return re.sub(r'\x00(\d+)\x00', _restore, shielded), replacements


def walk_blocks(blocks: list, idx, self_id: str, dry: bool, stats: dict):
    for blk in blocks or []:
        bt = blk.get("type")
        if bt in ("paragraph", "callout", "quote"):
            txt = blk.get("text")
            if not txt:
                continue
            new_txt, n = link_text(txt, idx, self_id)
            if n > 0:
                stats["replacements"] += n
                if dry:
                    if stats["preview_count"] < 5:
                        print(f"\n--- doc={self_id[:8]} block={bt} (+{n}) ---")
                        print(f"BEFORE: {txt[:200]}")
                        print(f"AFTER:  {new_txt[:200]}")
                        stats["preview_count"] += 1
                else:
                    blk["text"] = new_txt
        elif bt == "list":
            items = blk.get("items") or []
            new_items = []
            changed = False
            for it in items:
                new_it, n = link_text(it, idx, self_id)
                if n > 0:
                    changed = True
                    stats["replacements"] += n
                new_items.append(new_it)
            if changed and not dry:
                blk["items"] = new_items


def process_doc(doc: Doc, idx, dry: bool, stats: dict) -> bool:
    content = doc.content_json
    before_count = stats["replacements"]
    for sect in content.get("sections", []) or []:
        walk_blocks(sect.get("blocks", []), idx, doc.id, dry, stats)
        for sub in sect.get("subsections", []) or []:
            walk_blocks(sub.get("blocks", []), idx, doc.id, dry, stats)
    return stats["replacements"] > before_count


async def amain():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--apply", action="store_true", help="실제 DB UPDATE")
    ap.add_argument("--reindex", action="store_true", help="apply 후 Meili reindex")
    args = ap.parse_args()

    dry = not args.apply
    print(f"mode: {'APPLY' if not dry else 'dry-run'}")

    conn = await asyncpg.connect(
        host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PW, database=PG_DB,
    )

    print(f"\n→ fetching namu-archive docs ...")
    rows = await conn.fetch("""
        SELECT d.id::text, d.slug, d.title, d.content_json::text
        FROM documents d
        JOIN document_tags dt ON dt.document_id = d.id
        JOIN tags t ON dt.tag_id = t.id
        WHERE t.name = 'namu-archive'
        ORDER BY length(d.title) DESC
    """)
    docs = [
        Doc(id=r["id"], slug=r["slug"], title=r["title"], content_json=json.loads(r["content_json"]))
        for r in rows
    ]
    print(f"  ✓ {len(docs)} docs")

    # idx: 긴 title 부터, 2자 이상
    idx = [(d.title, d.slug, d.id) for d in docs if len(d.title) >= 2]
    idx.sort(key=lambda x: -len(x[0]))
    print(f"  ✓ title index: {len(idx)} entries (가장 긴: {idx[0][0][:40]!r})")

    stats = {"replacements": 0, "preview_count": 0, "docs_changed": 0}

    print(f"\n→ scanning ...")
    for doc in docs:
        if process_doc(doc, idx, dry, stats):
            stats["docs_changed"] += 1
            if not dry:
                await conn.execute(
                    "UPDATE documents SET content_json = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid",
                    json.dumps(doc.content_json, ensure_ascii=False), doc.id,
                )

    print(f"\nresult:")
    print(f"  docs changed   : {stats['docs_changed']} / {len(docs)}")
    print(f"  total inserts  : {stats['replacements']}")

    await conn.close()

    if dry:
        print(f"\n(dry-run — DB 변경 없음. 실제 적용: --apply)")
        return 0

    print(f"\n  ✓ committed")

    if args.reindex:
        print(f"\n→ Meili reindex ...")
        # 본 process 는 이미 컨테이너 안. apptainer 부르지 않고 직접.
        os.environ["DATABASE_URL"] = f"postgresql+asyncpg://{PG_USER}:{PG_PW}@{PG_HOST}:{PG_PORT}/{PG_DB}"
        os.environ["MEILI_HOST"] = "http://127.0.0.1:7700"
        os.environ["MEILI_MASTER_KEY"] = _env_or_default("MEILI_MASTER_KEY", "meili_dev_master_key_change_me")
        rc = subprocess.run(
            ["python3", "-m", "app.scripts.reindex"],
            cwd="/workspace/apps/api",
            check=False,
        )
        if rc.returncode == 0:
            print(f"  ✓ reindex done")
        else:
            print(f"  ⚠ reindex failed")

    return 0


def main():
    sys.exit(asyncio.run(amain()))


if __name__ == "__main__":
    main()
