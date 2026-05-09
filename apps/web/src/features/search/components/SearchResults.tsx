/**
 * <SearchResults /> — full results list for the /search page.
 *
 * Each row shows:
 *   - title with `<mark>` highlights (so the user sees WHY it matched)
 *   - cropped body snippet with `<mark>` highlights
 *   - meta (slug, part, updated_at, tags)
 *
 * When multiple parts have hits, group by part with a collapsible sub-header.
 * When everything sits in one part, render a flat list.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DocSearchHit } from '../api'
import { Highlight } from '@/components/Highlight'
import { BulkDocCheckbox } from '@/features/admin/bulk-docs/BulkDocCheckbox'
import { BulkDocActionsBar } from '@/features/admin/bulk-docs/BulkDocActionsBar'
import { SaveViewButton } from '@/features/saved-views/SaveViewButton'
import type { SavedViewFilters } from '@/features/saved-views/api'

export interface SearchResultsProps {
  query: string
  items: DocSearchHit[]
  loading?: boolean
  total?: number
  queryTimeMs?: number
  /** Cycle 0030 — current filter set, used to render the SaveViewButton. */
  filters?: SavedViewFilters
}

export function SearchResults({ query, items, loading, total, queryTimeMs, filters }: SearchResultsProps) {
  const groups = useMemo(() => groupByPart(items), [items])
  const partCount = groups.length
  const showGroups = partCount > 1

  if (loading && items.length === 0) {
    return (
      <p className="px-2 py-12 text-center text-sm text-gray-500" data-testid="search-results-loading">
        검색 중…
      </p>
    )
  }
  if (items.length === 0) {
    return (
      <p className="px-2 py-12 text-center text-sm text-gray-400" data-testid="search-results-empty">
        결과 없음
      </p>
    )
  }

  return (
    <div data-testid="search-results">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <p className="text-xs text-gray-500">
          총 <strong className="text-gray-800">{typeof total === 'number' ? total : items.length}</strong>건
          {typeof queryTimeMs === 'number' && queryTimeMs > 0 && (
            <span className="ml-1 text-gray-400">({queryTimeMs}ms)</span>
          )}
        </p>
        {filters && <SaveViewButton filters={filters} />}
      </div>
      {showGroups ? (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.part}>
              <PartGroup part={g.part} items={g.items} query={query} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {items.map((hit, i) => (
            <li key={`${hit.slug}-${i}`}>
              <ResultCard hit={hit} query={query} />
            </li>
          ))}
        </ul>
      )}
      <BulkDocActionsBar />
    </div>
  )
}

interface PartGroupProps {
  part: string
  items: DocSearchHit[]
  query: string
}

function PartGroup({ part, items, query }: PartGroupProps) {
  const [open, setOpen] = useState(true)
  return (
    <section className="rounded-md border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-50"
        data-testid={`group-toggle-${part}`}
      >
        <span>
          {part || '기타'} <span className="ml-1 text-gray-400">({items.length})</span>
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="divide-y divide-gray-100">
          {items.map((hit, i) => (
            <li key={`${hit.slug}-${i}`} className="p-2">
              <ResultCard hit={hit} query={query} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface ResultCardProps {
  hit: DocSearchHit
  query: string
}

function ResultCard({ hit, query }: ResultCardProps) {
  const titleHtml = hit.highlights?.title || hit._formatted?.title
  const bodyHtml =
    hit.highlights?.body || hit._formatted?.body_text || hit._formatted?.text
  const summaryHtml = hit.highlights?.summary || hit._formatted?.summary
  const snippet = hit.snippet || bodyHtml || summaryHtml || hit.summary || ''
  const terms = useMemo(() => splitTerms(query), [query])

  return (
    <article
      className="flex gap-2 rounded-md p-2 transition-colors hover:bg-smsg-50"
      data-testid="result-card"
    >
      <BulkDocCheckbox slug={hit.slug} />
      <Link to={`/docs/${encodeURIComponent(hit.slug)}`} className="block flex-1">
        <h3 className="text-base font-semibold text-smsg-900">
          {titleHtml ? (
            <Highlight html={titleHtml} />
          ) : (
            <Highlight text={hit.title} terms={terms} />
          )}
        </h3>
        {snippet && (
          <p className="mt-1 text-sm text-gray-700" data-testid="result-snippet">
            {hit.snippet || bodyHtml ? (
              <Highlight html={hit.snippet || bodyHtml || ''} />
            ) : (
              <Highlight text={snippet} terms={terms} />
            )}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
          <span className="font-mono text-gray-400">/{hit.slug}</span>
          {hit.part && <span>부서: {hit.part}</span>}
          {hit.author && <span>작성자: {hit.author}</span>}
          {hit.updated_at && <time>{formatDate(hit.updated_at)}</time>}
          {hit.tags && hit.tags.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {hit.tags.slice(0, 4).map((t) => (
                <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                  #{t}
                </span>
              ))}
            </span>
          )}
        </div>
      </Link>
    </article>
  )
}

function groupByPart(items: DocSearchHit[]): { part: string; items: DocSearchHit[] }[] {
  const map = new Map<string, DocSearchHit[]>()
  for (const h of items) {
    const k = h.part || h.part_slug || ''
    const arr = map.get(k) ?? []
    arr.push(h)
    map.set(k, arr)
  }
  return Array.from(map.entries())
    .map(([part, items]) => ({ part, items }))
    .sort((a, b) => b.items.length - a.items.length)
}

function splitTerms(q: string): string[] {
  return q.split(/\s+/).filter((t) => t.length >= 2)
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  } catch {
    return iso.slice(0, 10)
  }
}
