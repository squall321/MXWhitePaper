import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Slug } from '@/types/document'
import type { DocumentMeta } from '@/types/document'
import { compareDocs, type CrossDocCompareResult } from '@/features/cross-doc-diff/api'
import { DiffSummary } from '@/features/cross-doc-diff/DiffSummary'
import { InlineDiff } from '@/features/versions/InlineDiff'
import { WikiArticle } from '@/components/WikiArticle'
import { listDocuments, type DocumentCard } from '@/features/document/api'

type ViewMode = 'side-by-side' | 'inline' | 'metadata'

/**
 * Route: `/compare?left=<slug>&right=<slug>`
 *
 * Read-only cross-document comparison page. The left/right slugs come from
 * URL query params (shareable). Both docs must resolve before any of the
 * three tabs (나란히 / 인라인 / 메타데이터) render.
 *
 * Composition story:
 *   - `compareDocs(l, r)` reuses `getDocument` + `diffDocument`.
 *   - `<DiffSummary>` reads the precomputed `DocDiff`.
 *   - `<WikiArticle>` renders each side in 나란히 (read-only — no editor
 *     bindings).
 *   - `<InlineDiff>` renders the unified diff in 인라인.
 *   - 메타데이터 walks `document.metadata` + `row.updated_at`.
 */
export function CrossDocComparePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const leftSlug = (params.get('left') ?? '') as Slug
  const rightSlug = (params.get('right') ?? '') as Slug
  const ready = !!leftSlug && !!rightSlug

  const cmp = useQuery<CrossDocCompareResult>({
    queryKey: ['cross-doc-compare', leftSlug, rightSlug],
    queryFn: () => compareDocs(leftSlug, rightSlug),
    enabled: ready,
    staleTime: 30_000,
  })

  const [view, setView] = useState<ViewMode>('side-by-side')

  // Preserve current params on the slug pickers; rewriting them re-runs the
  // query via `enabled`.
  function setSlug(side: 'left' | 'right', slug: string): void {
    const next = new URLSearchParams(params)
    if (slug) next.set(side, slug)
    else next.delete(side)
    setParams(next, { replace: true })
  }

  function onSwap(): void {
    const next = new URLSearchParams(params)
    next.set('left', rightSlug)
    next.set('right', leftSlug)
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-3 px-4 py-3" data-testid="cross-doc-compare-page">
      <header className="space-y-2 border-b border-gray-200 pb-3">
        <h1 className="text-base font-semibold">문서 비교</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SlugPicker
            label="왼쪽 문서"
            value={leftSlug}
            onChange={(s) => setSlug('left', s)}
          />
          <span className="text-gray-400">↔</span>
          <SlugPicker
            label="오른쪽 문서"
            value={rightSlug}
            onChange={(s) => setSlug('right', s)}
          />
          <button
            type="button"
            onClick={onSwap}
            disabled={!ready}
            data-testid="cross-doc-swap"
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
          >
            좌우 바꾸기
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
          >
            홈으로
          </button>
        </div>
      </header>

      {!ready && (
        <p
          className="text-sm text-gray-500"
          data-testid="cross-doc-compare-empty"
        >
          두 슬러그를 모두 선택해 주세요.
        </p>
      )}

      {ready && cmp.isPending && (
        <p className="text-sm text-gray-500" data-testid="cross-doc-compare-loading">
          불러오는 중…
        </p>
      )}
      {ready && cmp.isError && (
        <p className="text-sm text-red-600" data-testid="cross-doc-compare-error">
          문서를 불러오지 못했습니다: {(cmp.error as Error).message}
        </p>
      )}

      {ready && cmp.data && (
        <>
          <DiffSummary diff={cmp.data.diff} />

          <nav
            role="tablist"
            className="flex gap-1 border-b border-gray-200"
            data-testid="cross-doc-compare-tabs"
          >
            <TabButton active={view === 'side-by-side'} onClick={() => setView('side-by-side')}>
              나란히
            </TabButton>
            <TabButton active={view === 'inline'} onClick={() => setView('inline')}>
              인라인
            </TabButton>
            <TabButton active={view === 'metadata'} onClick={() => setView('metadata')}>
              메타데이터
            </TabButton>
          </nav>

          {view === 'side-by-side' && <SideBySide cmp={cmp.data} />}
          {view === 'inline' && (
            <InlineDiff
              before={cmp.data.leftDoc}
              after={cmp.data.rightDoc}
              diff={cmp.data.diff}
            />
          )}
          {view === 'metadata' && <MetadataCompare cmp={cmp.data} />}
        </>
      )}
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-t px-3 py-1.5 text-sm font-medium ${
        active
          ? 'border-x border-t border-gray-200 bg-white text-smsg-900'
          : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Slug picker — combines a free-text input (the user can type a slug
 * directly) with a datalist sourced from `listDocuments` so the field
 * doubles as a search-as-you-type. We avoid a heavy combobox dep here.
 */
function SlugPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (slug: string) => void
}) {
  // Lazy + cheap: listDocuments is already cached app-wide. A 200-row pull is
  // enough for the picker dropdown; the user can always paste a slug.
  const list = useQuery<DocumentCard[]>({
    queryKey: ['cross-doc-compare-list'],
    queryFn: () => listDocuments({ limit: 200 }),
    staleTime: 60_000,
  })

  const id = label === '왼쪽 문서' ? 'cross-doc-list-left' : 'cross-doc-list-right'

  return (
    <label className="flex items-center gap-1 text-xs text-gray-600">
      <span>{label}</span>
      <input
        list={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="slug"
        data-testid={`cross-doc-picker-${label === '왼쪽 문서' ? 'left' : 'right'}`}
        className="rounded border border-gray-300 px-2 py-0.5 text-xs"
      />
      <datalist id={id}>
        {(list.data ?? []).map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.title}
          </option>
        ))}
      </datalist>
    </label>
  )
}

/**
 * 2-column grid that renders both docs read-only via `<WikiArticle>` and
 * keeps scroll positions roughly synced. The synchronization is one-way per
 * scroll event (whichever side scrolled most recently drives the other) so
 * we don't get into oscillation feedback loops.
 */
function SideBySide({ cmp }: { cmp: CrossDocCompareResult }) {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const lockRef = useRef<'left' | 'right' | null>(null)

  useEffect(() => {
    const l = leftRef.current
    const r = rightRef.current
    if (!l || !r) return
    function sync(from: 'left' | 'right'): () => void {
      return () => {
        if (lockRef.current && lockRef.current !== from) return
        lockRef.current = from
        const src = from === 'left' ? l : r
        const dst = from === 'left' ? r : l
        if (!src || !dst) return
        const max = src.scrollHeight - src.clientHeight
        const ratio = max > 0 ? src.scrollTop / max : 0
        const dstMax = dst.scrollHeight - dst.clientHeight
        dst.scrollTop = ratio * dstMax
        // Release the lock on the next frame so the listener on `dst` (which
        // fires synchronously from the assignment above) doesn't bounce back.
        requestAnimationFrame(() => {
          lockRef.current = null
        })
      }
    }
    const onL = sync('left')
    const onR = sync('right')
    l.addEventListener('scroll', onL)
    r.addEventListener('scroll', onR)
    return () => {
      l.removeEventListener('scroll', onL)
      r.removeEventListener('scroll', onR)
    }
  }, [])

  return (
    <div
      className="grid grid-cols-2 gap-3"
      data-testid="cross-doc-side-by-side"
    >
      <div
        ref={leftRef}
        className="max-h-[70vh] overflow-auto rounded border border-gray-200 bg-white p-3"
        data-side="left"
      >
        <WikiArticle document={cmp.leftDoc} row={cmp.left.row} meta={cmp.left.meta} />
      </div>
      <div
        ref={rightRef}
        className="max-h-[70vh] overflow-auto rounded border border-gray-200 bg-white p-3"
        data-side="right"
      >
        <WikiArticle document={cmp.rightDoc} row={cmp.right.row} meta={cmp.right.meta} />
      </div>
    </div>
  )
}

/**
 * Side-by-side metadata table. We deliberately surface the same fields that
 * appear in the doc reader's meta strip so this view mirrors the user's
 * mental model of "what counts as metadata".
 */
function MetadataCompare({ cmp }: { cmp: CrossDocCompareResult }) {
  const rows = useMemo(() => buildMetaRows(cmp), [cmp])
  return (
    <table
      className="w-full table-fixed border-collapse text-sm"
      data-testid="cross-doc-metadata"
    >
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
          <th className="w-32 py-1 pr-2">필드</th>
          <th className="py-1 pr-2">왼쪽</th>
          <th className="py-1">오른쪽</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.key}
            data-field={r.key}
            data-changed={r.changed ? '1' : '0'}
            className={`border-b border-gray-100 align-top ${r.changed ? 'bg-yellow-50' : ''}`}
          >
            <td className="py-1 pr-2 font-mono text-xs text-gray-500">{r.label}</td>
            <td className="py-1 pr-2 text-gray-800">{r.leftDisplay}</td>
            <td className="py-1 text-gray-800">{r.rightDisplay}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface MetaRow {
  key: string
  label: string
  leftDisplay: string
  rightDisplay: string
  changed: boolean
}

function buildMetaRows(cmp: CrossDocCompareResult): MetaRow[] {
  const lm: Partial<DocumentMeta> = cmp.leftDoc.metadata ?? ({} as DocumentMeta)
  const rm: Partial<DocumentMeta> = cmp.rightDoc.metadata ?? ({} as DocumentMeta)
  const fields: { key: keyof DocumentMeta | 'updated_at'; label: string }[] = [
    { key: 'division', label: 'division' },
    { key: 'team', label: 'team' },
    { key: 'group', label: 'group' },
    { key: 'part', label: 'part' },
    { key: 'owners', label: 'owners' },
    { key: 'tags', label: 'tags' },
    { key: 'confidentiality', label: 'confidentiality' },
    { key: 'updated_at', label: 'last edited' },
  ]
  const rows: MetaRow[] = []
  for (const f of fields) {
    let lv: unknown
    let rv: unknown
    if (f.key === 'updated_at') {
      lv = cmp.left.row.updated_at ?? cmp.left.meta.updated_at ?? ''
      rv = cmp.right.row.updated_at ?? cmp.right.meta.updated_at ?? ''
    } else {
      lv = (lm as Record<string, unknown>)[f.key]
      rv = (rm as Record<string, unknown>)[f.key]
    }
    rows.push({
      key: String(f.key),
      label: f.label,
      leftDisplay: displayMeta(lv),
      rightDisplay: displayMeta(rv),
      changed: !shallowEq(lv, rv),
    })
  }
  return rows
}

function displayMeta(v: unknown): string {
  if (v == null) return '—'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function shallowEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  return false
}
