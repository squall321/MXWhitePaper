/**
 * <KnowledgeResults /> — "시스템 지식" 탭 결과 리스트 (⌘K 팔레트).
 *
 * Each row shows:
 *   - kind 뱃지 (lat / guide / doc / archive 색 구분)
 *   - heading with `<mark>` highlights (Highlight 컴포넌트로 sanitize)
 *   - snippet with `<mark>` highlights
 *   - doc_path (모노스페이스 회색 — 코드 경로라 클릭 액션 없음)
 */
import type { KnowledgeSearchHit } from '../api'
import { Highlight } from '@/components/Highlight'
import { cn } from '@/components/ui/cn'

const KIND_BADGE: Record<string, string> = {
  lat: 'bg-purple-100 text-purple-700',
  guide: 'bg-emerald-100 text-emerald-700',
  doc: 'bg-sky-100 text-sky-700',
  archive: 'bg-amber-100 text-amber-700',
}

export function KnowledgeResults({
  q,
  items,
  loading,
  activeIdx,
  onActivate,
  listboxId,
  optionId,
}: {
  q: string
  items: KnowledgeSearchHit[]
  loading: boolean
  activeIdx: number
  onActivate: (i: number) => void
  listboxId: string
  optionId: (i: number) => string
}) {
  if (!q.trim()) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">검색어를 입력하세요.</p>
  }
  if (loading && items.length === 0) {
    return <p className="px-2 py-4 text-center text-xs text-gray-500">검색 중…</p>
  }
  if (items.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">결과 없음</p>
  }
  return (
    <ul role="listbox" id={listboxId} aria-label="시스템 지식 결과" className="space-y-1">
      {items.map((h, i) => {
        const active = i === activeIdx
        return (
          <li
            key={h.id}
            role="option"
            id={optionId(i)}
            aria-selected={active}
            onMouseEnter={() => onActivate(i)}
            className={cn(
              'flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors',
              active ? 'bg-smsg-100' : 'hover:bg-smsg-50',
            )}
          >
            <span
              className={cn(
                'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                KIND_BADGE[h.kind] ?? 'bg-gray-100 text-gray-600',
              )}
            >
              {h.kind}
            </span>
            <div className="min-w-0 flex-1">
              <Highlight
                html={h.highlights?.heading ?? h.heading}
                className="block truncate text-sm font-semibold text-smsg-900"
              />
              {(h.highlights?.body || h.snippet) && (
                <Highlight
                  html={h.highlights?.body ?? h.snippet}
                  className="mt-0.5 block truncate text-xs text-gray-600"
                />
              )}
              <span className="mt-0.5 block truncate font-mono text-[10px] text-gray-400">
                {h.doc_path}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
