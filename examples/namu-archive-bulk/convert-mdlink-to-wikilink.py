"""기존 [text](/docs/slug) markdown link 를 [[slug|text]] (또는 [[slug]] if text==slug)
wiki link 로 in-place 변환. 안전: paragraph/callout/quote/list 의 text 만."""
import asyncio
import json
import os
import re
import sys

import asyncpg

PG_HOST = "127.0.0.1"
PG_PORT = int(os.environ.get("POSTGRES_PORT", "5532"))
PG_USER = os.environ.get("POSTGRES_USER", "mxwp")
PG_PW = os.environ.get("POSTGRES_PASSWORD", "mxwp_dev_password_change_me")
PG_DB = os.environ.get("POSTGRES_DB", "mxwp")

# [text](/docs/slug) — slug 부분에 한글 포함 가능
MD_LINK_RE = re.compile(r'\[([^\]]+)\]\(/docs/([^)]+)\)')

def convert(text: str) -> tuple[str, int]:
    if not text:
        return text, 0
    n = 0
    def _r(m):
        nonlocal n
        n += 1
        t, s = m.group(1), m.group(2)
        return f"[[{s}]]" if t == s else f"[[{s}|{t}]]"
    return MD_LINK_RE.sub(_r, text), n

def walk_blocks(blocks, stats):
    for blk in blocks or []:
        bt = blk.get("type")
        if bt in ("paragraph", "callout", "quote"):
            t = blk.get("text")
            if not t:
                continue
            new_t, n = convert(t)
            if n > 0:
                blk["text"] = new_t
                stats["replacements"] += n
        elif bt == "list":
            items = blk.get("items") or []
            changed = False
            new_items = []
            for it in items:
                new_it, n = convert(it)
                if n > 0:
                    changed = True
                    stats["replacements"] += n
                new_items.append(new_it)
            if changed:
                blk["items"] = new_items

def process(content, stats):
    before = stats["replacements"]
    for sect in content.get("sections", []) or []:
        walk_blocks(sect.get("blocks", []), stats)
        for sub in sect.get("subsections", []) or []:
            walk_blocks(sub.get("blocks", []), stats)
    return stats["replacements"] > before

async def amain():
    conn = await asyncpg.connect(host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PW, database=PG_DB)
    rows = await conn.fetch("""
        SELECT d.id::text, d.content_json::text FROM documents d
        WHERE d.content_json::text LIKE '%](/docs/%'
    """)
    print(f"target docs: {len(rows)}")
    stats = {"replacements": 0, "docs_changed": 0}
    for r in rows:
        content = json.loads(r["content_json"])
        if process(content, stats):
            stats["docs_changed"] += 1
            await conn.execute(
                "UPDATE documents SET content_json = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid",
                json.dumps(content, ensure_ascii=False), r["id"],
            )
    print(f"docs changed: {stats['docs_changed']}, replacements: {stats['replacements']}")
    await conn.close()

asyncio.run(amain())
