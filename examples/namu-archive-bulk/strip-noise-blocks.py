"""namu-archive doc 들에서 *placeholder paragraph block* 제거.

배경: Namu_Archive 정제 ETL 이 모든 docx 끝에 'Widget: org-chart' 같은
placeholder 를 *visible* 텍스트로 박음. 본 사이트의 widget marker 패턴은
hidden run 이라야 인식하는데 visible 이라 marker 로 못 풀고 plain paragraph
로 흡수 → 본문에 의미 없는 'Widget: org-chart' 가 표시됨.

해결: namu-archive tag 가진 doc 들의 sections[].blocks[] (및 subsections)
중 *paragraph 이면서 정확히 NOISE_TEXTS 와 일치* 하는 block 만 제거.
다른 텍스트는 절대 안 건드림.

사용 (apptainer container 안에서, asyncpg 필요):
  apptainer exec --bind "$PWD:$PWD" instance://mxwp_api bash -lc \\
    "cd $PWD && python3 examples/namu-archive-bulk/strip-noise-blocks.py"

  # 다른 noise 도 같이 제거:
  NOISE_TEXTS='Widget: org-chart,Widget: chart' python3 ... strip-noise-blocks.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

import asyncpg

PG_HOST = "127.0.0.1"
PG_PORT = int(os.environ.get("POSTGRES_PORT", "5532"))
PG_USER = os.environ.get("POSTGRES_USER", "mxwp")
PG_PW = os.environ.get("POSTGRES_PASSWORD", "mxwp_dev_password_change_me")
PG_DB = os.environ.get("POSTGRES_DB", "mxwp")

# 기본 — Namu_Archive 에서 발견된 placeholder.
NOISE_TEXTS = set(
    t.strip()
    for t in os.environ.get("NOISE_TEXTS", "Widget: org-chart").split(",")
    if t.strip()
)

TAG_FILTER = os.environ.get("TAG_FILTER", "namu-archive")


def clean_blocks(blocks):
    out, removed = [], 0
    for blk in blocks or []:
        if blk.get("type") == "paragraph" and (blk.get("text") or "").strip() in NOISE_TEXTS:
            removed += 1
            continue
        out.append(blk)
    return out, removed


def clean_doc(content):
    total = 0
    for sect in content.get("sections", []) or []:
        new_blocks, n = clean_blocks(sect.get("blocks"))
        if n > 0:
            sect["blocks"] = new_blocks
            total += n
        for sub in sect.get("subsections", []) or []:
            new_blocks, n = clean_blocks(sub.get("blocks"))
            if n > 0:
                sub["blocks"] = new_blocks
                total += n
    return total


async def amain():
    conn = await asyncpg.connect(
        host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PW, database=PG_DB,
    )
    print(f"tag filter: {TAG_FILTER!r}")
    print(f"noise texts: {sorted(NOISE_TEXTS)}")

    like_filter = " OR ".join([f"d.content_json::text LIKE '%{n}%'" for n in NOISE_TEXTS])
    sql = f"""
        SELECT d.id::text, d.content_json::text
        FROM documents d
        JOIN document_tags dt ON dt.document_id = d.id
        JOIN tags t ON dt.tag_id = t.id
        WHERE t.name = $1
          AND ({like_filter})
    """
    rows = await conn.fetch(sql, TAG_FILTER)
    print(f"target docs: {len(rows)}")

    total_removed = 0
    docs_changed = 0
    for r in rows:
        content = json.loads(r["content_json"])
        n = clean_doc(content)
        if n > 0:
            docs_changed += 1
            total_removed += n
            await conn.execute(
                "UPDATE documents SET content_json = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid",
                json.dumps(content, ensure_ascii=False), r["id"],
            )

    print(f"docs changed: {docs_changed}, blocks removed: {total_removed}")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(amain())
