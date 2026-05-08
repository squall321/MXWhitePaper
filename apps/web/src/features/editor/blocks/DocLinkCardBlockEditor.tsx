import { useMemo, useState } from 'react'
import type { DocLinkCardBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useDocumentList } from '@/features/document/hooks/useDocumentList'

interface Props {
  slug: Slug
  block: DocLinkCardBlock
}

/**
 * DocLinkCardBlockEditor — paste/search a slug, fuzzy-filter the document
 * list, click to set the target. The current target preview shows below
 * the picker.
 */
export function DocLinkCardBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showSummary, setShowSummary] = useState(block.showSummary !== false)
  const list = useDocumentList({ q: query || undefined, limit: 20 })

  // Filter the (possibly empty) list locally so a server that ignores `q`
  // still returns a usable filter result. Fuzzy-ish: case-insensitive
  // substring on title or slug.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = list.data ?? []
    if (!q) return rows.slice(0, 8)
    return rows
      .filter(
        (r) =>
          r.title.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [query, list.data])

  const persist = async (next: Partial<DocLinkCardBlock>) => {
    if (!etag) return
    setBusy(true)
    try {
      const result = await patchBlock(
        slug,
        block.id,
        next,
        etag,
        '문서 링크 편집',
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('충돌 — 새로고침 필요')
      } else {
        setError((err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  const onPick = (target: Slug) => {
    void persist({ slug: target })
    setQuery('')
  }

  const onToggleSummary = () => {
    const next = !showSummary
    setShowSummary(next)
    void persist({ showSummary: next })
  }

  return (
    <div
      data-doc-link-card-editor
      data-block-id={block.id}
      className="my-3 space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
    >
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
          현재 대상
        </p>
        <p className="text-sm text-smsg-900">
          {block.slug ? (
            <>
              <span className="font-mono">/{block.slug}</span>
            </>
          ) : (
            <span className="text-gray-400">대상이 설정되지 않았습니다.</span>
          )}
        </p>
        <label className="flex items-center gap-1 text-[11px] text-gray-700">
          <input
            type="checkbox"
            checked={showSummary}
            onChange={onToggleSummary}
            aria-label="요약 표시"
          />
          요약 표시
        </label>
      </div>

      <div className="space-y-1">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="문서 검색…"
          aria-label="문서 검색"
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        />
        <div className="max-h-48 overflow-y-auto rounded border border-gray-200 bg-white">
          {list.isPending && (
            <p className="px-2 py-2 text-[11px] text-gray-500">불러오는 중…</p>
          )}
          {!list.isPending && items.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-gray-500">
              {query ? '결과 없음' : '문서가 없습니다.'}
            </p>
          )}
          {items.map((it) => (
            <button
              key={it.slug}
              type="button"
              onClick={() => onPick(it.slug)}
              disabled={busy}
              className={
                'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-smsg-100 ' +
                (it.slug === block.slug ? 'bg-smsg-50 font-semibold' : '')
              }
            >
              <span className="truncate text-smsg-900">{it.title}</span>
              <span className="font-mono text-[10px] text-gray-500">
                /{it.slug}
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
