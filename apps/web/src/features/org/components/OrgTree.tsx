import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOrgTree } from '../hooks/useOrgTree'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { EmptyState } from '@/components/ui/EmptyState'
import { toApiError } from '@/lib/api/envelope'
import { useRecentPartsStore } from '../recentPartsStore'
import { useFavoritesStore } from '@/features/favorites/store'
import { cn } from '@/components/ui/cn'
import { withBase } from '@/lib/basePath'
import type { OrgDivision, OrgTeam, OrgGroup, OrgPart } from '../types'

interface OrgTreeProps {
  /** Hide the search input (e.g., when used inside the bottom drawer where
   *  a host already provides one). */
  hideSearch?: boolean
  /** Hide the pinned "최근 본 파트" / "즐겨찾기한 파트" sections. */
  hidePinned?: boolean
}

/**
 * Left-column expandable org tree: Division → Team → Group → Part.
 *
 * QoL features:
 *   - Search input filters nodes by name (case-insensitive). Matches are
 *     highlighted; ancestors of any match auto-expand.
 *   - Recent parts + Favorited parts sections pin above the tree.
 *   - Indent guides + chevrons that rotate with `aria-expanded`.
 */
export function OrgTree({ hideSearch = false, hidePinned = false }: OrgTreeProps) {
  const { data, isPending, isError, error, refetch } = useOrgTree()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const recentParts = useRecentPartsStore((s) => s.items)
  const pushRecentPart = useRecentPartsStore((s) => s.push)
  const favorites = useFavoritesStore((s) => s.items)

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Auto-expand ancestors of any node that matches the query.
  const filtered = useMemo(() => filterTree(data ?? [], query), [data, query])

  useEffect(() => {
    if (!query.trim() || !data) return
    const ancestors = collectAncestorsToOpen(data, query)
    if (ancestors.size === 0) return
    setOpen((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [query, data])

  if (isPending) {
    return (
      <div className="space-y-2 px-3 py-2" aria-busy="true" aria-label="조직 트리 불러오는 중">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="ml-3 h-3 w-1/2" />
        <Skeleton className="ml-3 h-3 w-3/5" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="px-3 py-2">
        <ErrorState
          title="조직 트리를 불러오지 못했습니다"
          description={toApiError(error).message}
          onRetry={() => void refetch()}
          className="px-3 py-4"
        />
      </div>
    )
  }
  if (!data || data.length === 0) {
    return (
      <div className="px-3 py-2">
        <EmptyState
          title="아직 등록된 조직이 없습니다"
          description="관리자 화면에서 사업부를 추가하세요."
          className="px-3 py-4"
        />
      </div>
    )
  }

  const visible = query.trim() ? filtered : data
  const noResults = query.trim().length > 0 && visible.length === 0

  return (
    <div className="text-sm" data-testid="org-tree">
      {!hideSearch && (
        <div className="px-3 pb-2">
          <label className="relative block">
            <span className="sr-only">조직 검색</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="조직 검색…"
              data-testid="org-tree-search"
              className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-xs outline-none transition-colors focus:border-smsg-500 focus:shadow-focus"
            />
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </label>
        </div>
      )}

      {!hidePinned && (
        <PinnedSections
          recent={recentParts.slice(0, 5)}
          favorites={favorites.slice(0, 5)}
        />
      )}

      {noResults ? (
        <p className="px-3 py-4 text-xs text-gray-400">일치하는 조직이 없습니다.</p>
      ) : (
        <ul role="tree" className="px-1">
          {visible.map((division, idx) => (
            <DivisionNode
              key={division.id}
              node={division}
              open={open}
              onToggle={toggle}
              query={query}
              isLast={idx === visible.length - 1}
              onPickPart={(part, path) => pushRecentPart({ id: part.id, slug: part.slug, name: part.name, path })}
              parentPath=""
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface NodeBaseProps {
  open: Set<string>
  onToggle: (id: string) => void
  query: string
  isLast: boolean
  onPickPart: (part: OrgPart, path: string) => void
  parentPath: string
}

function DivisionNode({ node, open, onToggle, query, onPickPart, parentPath }: { node: OrgDivision } & NodeBaseProps) {
  const isOpen = open.has(node.id) || query.trim().length > 0
  const path = node.name
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <RowButton
        depth={0}
        isOpen={isOpen}
        hasChildren={node.teams.length > 0}
        onClick={() => onToggle(node.id)}
        label={node.name}
        query={query}
      />
      {isOpen && node.teams.length > 0 && (
        <ul role="group" className="relative">
          <IndentGuide depth={0} />
          {node.teams.map((team, idx) => (
            <TeamNode
              key={team.id}
              node={team}
              open={open}
              onToggle={onToggle}
              query={query}
              isLast={idx === node.teams.length - 1}
              onPickPart={onPickPart}
              parentPath={`${parentPath || ''}${path}`}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function TeamNode({ node, open, onToggle, query, onPickPart, parentPath }: { node: OrgTeam } & NodeBaseProps) {
  const isOpen = open.has(node.id) || query.trim().length > 0
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <RowButton
        depth={1}
        isOpen={isOpen}
        hasChildren={node.groups.length > 0}
        onClick={() => onToggle(node.id)}
        label={node.name}
        query={query}
      />
      {isOpen && node.groups.length > 0 && (
        <ul role="group" className="relative">
          <IndentGuide depth={1} />
          {node.groups.map((group, idx) => (
            <GroupNode
              key={group.id}
              node={group}
              open={open}
              onToggle={onToggle}
              query={query}
              isLast={idx === node.groups.length - 1}
              onPickPart={onPickPart}
              parentPath={`${parentPath} / ${node.name}`}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function GroupNode({ node, open, onToggle, query, onPickPart, parentPath }: { node: OrgGroup } & NodeBaseProps) {
  const isOpen = open.has(node.id) || query.trim().length > 0
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <RowButton
        depth={2}
        isOpen={isOpen}
        hasChildren={node.parts.length > 0}
        onClick={() => onToggle(node.id)}
        label={node.name}
        query={query}
      />
      {isOpen && node.parts.length > 0 && (
        <ul role="group" className="relative">
          <IndentGuide depth={2} />
          {node.parts.map((part) => (
            <PartNode
              key={part.id}
              node={part}
              query={query}
              onPick={() => onPickPart(part, `${parentPath} / ${node.name}`)}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function PartNode({ node, query, onPick }: { node: OrgPart; query: string; onPick: () => void }) {
  return (
    <li role="treeitem">
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-smsg-900 hover:bg-smsg-100"
        style={{ paddingLeft: indentFor(3) }}
      >
        <span className="text-gray-400">·</span>
        <Highlighted text={node.name} query={query} />
      </button>
    </li>
  )
}

function RowButton({
  depth,
  isOpen,
  hasChildren,
  onClick,
  label,
  query,
}: {
  depth: number
  isOpen: boolean
  hasChildren: boolean
  onClick: () => void
  label: string
  query: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-smsg-900 hover:bg-smsg-100"
      style={{ paddingLeft: indentFor(depth) }}
      aria-expanded={hasChildren ? isOpen : undefined}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block w-4 text-gray-500 transition-transform duration-base ease-out-soft',
          hasChildren ? (isOpen ? 'rotate-90' : 'rotate-0') : 'opacity-0',
        )}
      >
        {hasChildren ? '▸' : ''}
      </span>
      <Highlighted text={label} query={query} />
    </button>
  )
}

/** Vertical indent guide drawn inside the absolutely-positioned `<ul>`. */
function IndentGuide({ depth }: { depth: number }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-0 bottom-0 w-px bg-gray-100"
      style={{ left: `calc(${0.5 + depth * 0.75}rem + 0.6rem)` }}
    />
  )
}

function indentFor(depth: number): string {
  return `${0.5 + depth * 0.75}rem`
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase()
  if (!needle) return <span className="truncate">{text}</span>
  const lower = text.toLowerCase()
  const i = lower.indexOf(needle)
  if (i === -1) return <span className="truncate">{text}</span>
  return (
    <span className="truncate">
      {text.slice(0, i)}
      <mark className="rounded bg-yellow-100 px-0.5 not-italic font-semibold text-smsg-900">
        {text.slice(i, i + needle.length)}
      </mark>
      {text.slice(i + needle.length)}
    </span>
  )
}

function PinnedSections({
  recent,
  favorites,
}: {
  recent: { id: string; slug: string; name: string; path?: string }[]
  favorites: { slug: string; title: string }[]
}) {
  if (recent.length === 0 && favorites.length === 0) return null
  return (
    <div className="space-y-3 border-b border-gray-100 px-3 pb-3">
      {recent.length > 0 && (
        <section aria-label="최근 본 파트">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            최근 본 파트
          </p>
          <ul className="space-y-0.5" data-testid="org-tree-recent-parts">
            {recent.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-smsg-900 hover:bg-smsg-50"
                  title={p.path}
                >
                  <span aria-hidden="true" className="text-gray-300">↻</span>
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {favorites.length > 0 && (
        <section aria-label="즐겨찾기한 파트">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            즐겨찾기
          </p>
          <ul className="space-y-0.5" data-testid="org-tree-favorites">
            {favorites.map((f) => (
              <li key={f.slug}>
                <a
                  href={withBase(`/docs/${encodeURIComponent(f.slug)}`)}
                  className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-smsg-900 hover:bg-smsg-50 hover:no-underline"
                >
                  <span aria-hidden="true" className="text-amber-400">★</span>
                  <span className="truncate">{f.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/* ------------------------ tree filtering helpers ------------------------ */

function matches(name: string, q: string): boolean {
  if (!q) return true
  return name.toLowerCase().includes(q.toLowerCase())
}

/**
 * Returns a copy of the tree containing only branches that have at least one
 * matching node. An empty query returns the input unchanged.
 */
function filterTree(divisions: OrgDivision[], q: string): OrgDivision[] {
  if (!q.trim()) return divisions
  const out: OrgDivision[] = []
  for (const d of divisions) {
    const teams: OrgTeam[] = []
    for (const t of d.teams) {
      const groups: OrgGroup[] = []
      for (const g of t.groups) {
        const parts = g.parts.filter((p) => matches(p.name, q))
        if (matches(g.name, q) || parts.length > 0) {
          groups.push({ ...g, parts: parts.length > 0 ? parts : g.parts })
        }
      }
      if (matches(t.name, q) || groups.length > 0) {
        teams.push({ ...t, groups: groups.length > 0 ? groups : t.groups })
      }
    }
    if (matches(d.name, q) || teams.length > 0) {
      out.push({ ...d, teams: teams.length > 0 ? teams : d.teams })
    }
  }
  return out
}

/** Collects the ids of every node that has at least one descendant matching `q`. */
function collectAncestorsToOpen(divisions: OrgDivision[], q: string): Set<string> {
  const out = new Set<string>()
  if (!q.trim()) return out
  for (const d of divisions) {
    for (const t of d.teams) {
      for (const g of t.groups) {
        const partHit = g.parts.some((p) => matches(p.name, q))
        if (matches(g.name, q) || partHit) {
          out.add(d.id)
          out.add(t.id)
          out.add(g.id)
        }
      }
      if (matches(t.name, q)) {
        out.add(d.id)
        out.add(t.id)
      }
    }
    if (matches(d.name, q)) out.add(d.id)
  }
  return out
}
