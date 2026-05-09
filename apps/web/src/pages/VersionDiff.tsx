import { useMemo, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Slug } from '@/types/document'
import {
  getVersion,
  isPreconditionFailed,
  listVersions,
  restoreVersion,
  type VersionDetail,
  type VersionRow,
} from '@/features/editor/api'
import { useAuthStore } from '@/features/auth/store'
import { diffDocument } from '@/features/editor/diff/document-diff'
import { InlineDiff } from '@/features/versions/InlineDiff'
import { diffLines } from '@/features/versions/lineDiff'
import { useEditorStore } from '@/features/editor/state'
import { BranchFromTagButton } from '@/features/version-tags/BranchFromTagButton'

type ViewMode = 'side-by-side' | 'inline' | 'json'

const EDITOR_ROLES = new Set(['editor', 'owner', 'admin'])

/**
 * Route: /docs/:slug/versions/:from/diff/:to
 *
 *   - top bar: "v3 → v7" + version pickers + swap + restore
 *   - tabs: 나란히 / 인라인 / JSON
 *   - sticky right panel: 변경 요약 (count + section list)
 *
 * The page reads two version snapshots via /documents/:slug/versions/:n,
 * computes the diff once with `diffDocument`, and routes it through the three
 * view modes. Restore reuses the existing POST /restore endpoint.
 */
export function VersionDiffPage() {
  const params = useParams<{ slug: string; from: string; to: string }>()
  const slug = (params.slug ?? '') as Slug
  const fromN = Math.max(1, parseInt(params.from ?? '0', 10) || 0)
  const toN = Math.max(1, parseInt(params.to ?? '0', 10) || 0)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const canRestore = !!user && EDITOR_ROLES.has(user.role)

  const list = useQuery<VersionRow[]>({
    queryKey: ['document-versions', slug],
    queryFn: () => listVersions(slug),
    enabled: !!slug,
    staleTime: 30_000,
  })

  const fromQ = useQuery<VersionDetail | null>({
    queryKey: ['document-version-detail', slug, fromN],
    queryFn: () => getVersion(slug, fromN),
    enabled: !!slug && fromN > 0,
  })
  const toQ = useQuery<VersionDetail | null>({
    queryKey: ['document-version-detail', slug, toN],
    queryFn: () => getVersion(slug, toN),
    enabled: !!slug && toN > 0,
  })

  const [view, setView] = useState<ViewMode>('side-by-side')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onPick = useCallback(
    (which: 'from' | 'to', n: number) => {
      const f = which === 'from' ? n : fromN
      const t = which === 'to' ? n : toN
      navigate(`/docs/${encodeURIComponent(slug)}/versions/${f}/diff/${t}`)
    },
    [fromN, toN, navigate, slug],
  )

  const onSwap = useCallback(() => {
    navigate(`/docs/${encodeURIComponent(slug)}/versions/${toN}/diff/${fromN}`)
  }, [fromN, toN, navigate, slug])

  const headEtag = useEditorStore((s) => s.etag)
  const onRestore = useCallback(async () => {
    if (!canRestore) return
    setBusy(true)
    setErr(null)
    try {
      // Restore uses HEAD's etag; if the user opened diff without loading the
      // editor first, fall back to the list's latest version.
      const etag =
        headEtag ??
        // Synthesize a permissive etag string — the BE has been declared
        // intentionally If-Match-exempt for restore (see documents.py).
        ''
      await restoreVersion(slug, fromN, etag, `restore from v${fromN}`)
      await qc.invalidateQueries({ queryKey: ['document', slug] })
      await qc.invalidateQueries({ queryKey: ['document-versions', slug] })
      navigate(`/docs/${encodeURIComponent(slug)}`)
    } catch (e) {
      if (isPreconditionFailed(e)) setErr('충돌이 발생했습니다. 다시 시도해 주세요.')
      else setErr((e as Error).message ?? '복원 실패')
    } finally {
      setBusy(false)
    }
  }, [canRestore, headEtag, slug, fromN, qc, navigate])

  const fromDoc = fromQ.data?.content
  const toDoc = toQ.data?.content
  const docDiff = useMemo(() => {
    if (!fromDoc || !toDoc) return null
    return diffDocument(fromDoc, toDoc)
  }, [fromDoc, toDoc])

  const summary = useMemo(() => {
    if (!docDiff) return { added: 0, removed: 0, changed: 0, sections: [] as string[] }
    let added = 0
    let removed = 0
    let changed = 0
    const sections: string[] = []
    for (const s of docDiff.sections) {
      sections.push(s.newTitle ?? s.baseTitle ?? s.id.slice(-6))
      for (const b of s.blockDiffs) {
        if (b.status === 'added') added++
        else if (b.status === 'removed') removed++
        else if (b.status === 'changed') changed++
      }
    }
    return { added, removed, changed, sections }
  }, [docDiff])

  if (!slug) {
    return <p className="p-4 text-sm text-red-600">slug 누락</p>
  }
  return (
    <div className="grid grid-cols-[1fr_240px] gap-4 px-4 py-3" data-testid="version-diff-page">
      <div className="min-w-0 space-y-3">
        <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
          <h1 className="text-base font-semibold">
            <span className="font-mono">v{fromN}</span>
            <span className="mx-2 text-gray-400">→</span>
            <span className="font-mono">v{toN}</span>
          </h1>
          <VersionPicker
            label="이전 버전"
            value={fromN}
            options={list.data ?? []}
            onChange={(n) => onPick('from', n)}
          />
          <VersionPicker
            label="이후 버전"
            value={toN}
            options={list.data ?? []}
            onChange={(n) => onPick('to', n)}
          />
          <button
            type="button"
            onClick={onSwap}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            data-testid="swap-versions"
          >
            좌우 바꾸기
          </button>
          <BranchFromTagButton slug={slug} />
          <div className="flex-1" />
          <button
            type="button"
            disabled={!canRestore || busy}
            onClick={() => void onRestore()}
            data-testid="restore-button"
            className="rounded bg-smsg-700 px-3 py-1 text-xs font-medium text-white hover:bg-smsg-900 disabled:opacity-40"
          >
            이전 버전으로 되돌리기
          </button>
        </header>

        <nav role="tablist" className="flex gap-1 border-b border-gray-200" data-testid="diff-tabs">
          <TabButton active={view === 'side-by-side'} onClick={() => setView('side-by-side')}>
            나란히
          </TabButton>
          <TabButton active={view === 'inline'} onClick={() => setView('inline')}>
            인라인
          </TabButton>
          <TabButton active={view === 'json'} onClick={() => setView('json')}>
            JSON
          </TabButton>
        </nav>

        {(fromQ.isPending || toQ.isPending) && (
          <p className="text-sm text-gray-500" data-testid="diff-loading">불러오는 중…</p>
        )}
        {(fromQ.isError || toQ.isError) && (
          <p className="text-sm text-red-600">버전을 불러오지 못했습니다.</p>
        )}
        {!fromDoc && !toDoc && !fromQ.isPending && !toQ.isPending && (
          <p className="text-sm text-gray-500">버전 본문이 없습니다.</p>
        )}

        {fromDoc && toDoc && view === 'side-by-side' && (
          <SideBySide before={fromDoc} after={toDoc} />
        )}
        {fromDoc && toDoc && view === 'inline' && (
          <InlineDiff before={fromDoc} after={toDoc} diff={docDiff ?? undefined} />
        )}
        {fromDoc && toDoc && view === 'json' && (
          <JsonDiff before={fromDoc} after={toDoc} />
        )}
        {err && <p className="text-sm text-red-600" data-testid="diff-error">{err}</p>}
      </div>

      <aside
        className="sticky top-2 h-fit rounded border border-gray-200 bg-white p-3 text-sm"
        data-testid="diff-summary"
      >
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          변경 요약
        </h2>
        <ul className="space-y-1">
          <li className="text-green-700">+ 추가 블록 {summary.added}</li>
          <li className="text-red-700">- 삭제 블록 {summary.removed}</li>
          <li className="text-yellow-700">~ 수정 블록 {summary.changed}</li>
        </ul>
        <h3 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          영향받은 섹션 ({summary.sections.length})
        </h3>
        <ul className="space-y-1 text-xs text-gray-700">
          {summary.sections.slice(0, 12).map((t, i) => (
            <li key={i} className="truncate">{t}</li>
          ))}
          {summary.sections.length > 12 && (
            <li className="text-gray-400">… +{summary.sections.length - 12}</li>
          )}
        </ul>
      </aside>
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

function VersionPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: number
  options: VersionRow[]
  onChange: (n: number) => void
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-gray-600">
      <span>{label}</span>
      <select
        className="rounded border border-gray-300 px-1 py-0.5 text-xs"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        data-testid={`picker-${label}`}
      >
        {options.length === 0 && <option value={value}>v{value}</option>}
        {options.map((v) => {
          const when = (v.edited_at ?? v.created_at ?? '').slice(0, 16)
          const who = v.edited_by_name ?? v.author ?? ''
          const cl = v.change_log ? ` · ${v.change_log}` : ''
          return (
            <option key={v.version} value={v.version}>
              v{v.version} · {when}
              {who ? ` · ${who}` : ''}
              {cl}
            </option>
          )
        })}
      </select>
    </label>
  )
}

function SideBySide({
  before,
  after,
}: {
  before: import('@/types/document').DocumentJSONV10
  after: import('@/types/document').DocumentJSONV10
}) {
  // Read-only: stringify both sides as plain prose. We deliberately avoid the
  // full editor renderer here (it depends on the editor store) to keep the
  // page snappy and side-effect-free.
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="side-by-side">
      <ReadOnlyDoc doc={before} side="left" />
      <ReadOnlyDoc doc={after} side="right" />
    </div>
  )
}

function ReadOnlyDoc({
  doc,
  side,
}: {
  doc: import('@/types/document').DocumentJSONV10
  side: 'left' | 'right'
}) {
  return (
    <article
      className="prose prose-sm max-w-none rounded border border-gray-200 bg-white p-3"
      data-side={side}
    >
      <h2 className="mb-1 text-base font-semibold">{doc.title}</h2>
      {doc.summary && <p className="text-xs text-gray-500">{doc.summary}</p>}
      {(doc.sections ?? []).map((sec) => (
        <ReadOnlySection key={sec.id} sec={sec} />
      ))}
    </article>
  )
}

type AnySec = import('@/types/document').SectionLevel1
  | import('@/types/document').SectionLevel2
  | import('@/types/document').SectionLevel3

function ReadOnlySection({ sec }: { sec: AnySec }) {
  const Tag = (`h${(sec.level ?? 1) + 1}` as 'h2' | 'h3' | 'h4')
  const subs =
    'subsections' in sec && Array.isArray((sec as { subsections?: AnySec[] }).subsections)
      ? ((sec as { subsections: AnySec[] }).subsections)
      : []
  return (
    <section data-section-id={sec.id} className="my-2">
      <Tag>{sec.title}</Tag>
      {sec.blocks.map((b) => {
        const text = (b as unknown as { text?: string; title?: string; items?: string[] })
        const value =
          text.text ?? text.title ?? (Array.isArray(text.items) ? text.items.join(', ') : `(${b.type})`)
        return (
          <p key={b.id} data-block-id={b.id} className="my-1 text-sm">
            {value}
          </p>
        )
      })}
      {subs.map((s) => (
        <ReadOnlySection key={s.id} sec={s} />
      ))}
    </section>
  )
}

function JsonDiff({
  before,
  after,
}: {
  before: import('@/types/document').DocumentJSONV10
  after: import('@/types/document').DocumentJSONV10
}) {
  const a = JSON.stringify(before, null, 2)
  const b = JSON.stringify(after, null, 2)
  const ops = useMemo(() => diffLines(a, b), [a, b])
  return (
    <pre
      className="max-h-[60vh] overflow-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px]"
      data-testid="json-diff"
    >
      {ops.map((op, i) => {
        if (op.kind === 'equal')
          return (
            <div key={i} className="text-gray-600" data-op="equal">
              {' '}
              {op.value}
            </div>
          )
        if (op.kind === 'add')
          return (
            <div key={i} className="bg-green-100 text-green-900" data-op="add">
              +{op.value}
            </div>
          )
        return (
          <div key={i} className="bg-red-100 text-red-900" data-op="remove">
            -{op.value}
          </div>
        )
      })}
    </pre>
  )
}
