"""Glossary-alias resolution for wiki links.

`wiki_link_extractor.extract_wiki_links()` parses `[[slug]]` purely from text
(no DB). When the user types an *alias* of an approved glossary term, the
extracted `target_slug` won't match any document slug; this module looks up
the alias in `terms.aliases` (status='approved') and rewrites `target_slug`
to the canonical term so the existing `links` resolver finds the document
the term points at (via `terms.page_doc_id`).

Wiring: called from `document_service.update_links_for_document` *after*
`extract_wiki_links` and *before* `replace_links_for_document`. The original
matched alias is preserved in `metadata.alias_of` so callers can surface
"redirected via alias" in the UI later.

Gotchas:
- Aliases must be slug-shaped (lowercase ascii/hangul, hyphen, no spaces)
  to be matchable by the wiki-link regex in the first place. Plan example
  `[[어텐션 모델]]` will *not* be parsed at all — store aliases as
  `어텐션모델` or `attention-model` in the DB if you want them clickable.
- Glossary lookup is case-sensitive on `term`; aliases are matched via
  PostgreSQL `ANY(aliases)` which is also case-sensitive. We normalize
  the query slug to lowercase before lookup since the regex already
  forces lowercase.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def resolve_term_aliases(
    s: AsyncSession,
    links: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Rewrite each link's `target_slug` to the canonical term slug when
    the extracted slug matches an approved alias. Pass-through for any
    slug that already matches a `terms.term` or has no DB hit.

    Returns the same list (mutated) for chaining ergonomics. Preserves
    original alias text in `metadata.alias_of` when redirection happens.
    """
    if not links:
        return links

    # Unique candidate slugs — one DB roundtrip regardless of duplicate
    # links to the same target.
    candidates = sorted({L["target_slug"] for L in links if L.get("target_slug")})
    if not candidates:
        return links

    # Match either by canonical term (lowercased) or by membership in aliases.
    # Returns (matched_slug, canonical_slug) so caller can rewrite in place.
    rows = (await s.execute(
        text("""
            WITH q(slug) AS (SELECT unnest(CAST(:slugs AS TEXT[])))
            SELECT q.slug AS matched,
                   lower(t.term) AS canonical,
                   t.term AS term_raw
              FROM q
              JOIN terms t
                ON t.status = 'approved'
               AND (
                    lower(t.term) = q.slug
                 OR q.slug = ANY(t.aliases)
                 OR lower(q.slug) = ANY(SELECT lower(a) FROM unnest(t.aliases) a)
               )
        """),
        {"slugs": candidates},
    )).fetchall()

    # Map matched_slug → canonical. If the same slug matches both the
    # canonical term and an alias of another term, the canonical match
    # wins (we keep the *first* row whose canonical == matched).
    redirect: dict[str, str] = {}
    for row in rows:
        matched, canonical, _term_raw = row[0], row[1], row[2]
        if matched == canonical:
            redirect[matched] = canonical  # no-op pass-through
        elif matched not in redirect:
            redirect[matched] = canonical

    for L in links:
        slug = L.get("target_slug")
        if not slug:
            continue
        canonical = redirect.get(slug)
        if canonical is None or canonical == slug:
            continue
        # Alias hit — preserve original for audit, rewrite target.
        meta = L.setdefault("metadata", {}) if isinstance(L.get("metadata"), dict) else {}
        if not isinstance(L.get("metadata"), dict):
            L["metadata"] = meta
        meta["alias_of"] = slug
        L["target_slug"] = canonical
    return links
