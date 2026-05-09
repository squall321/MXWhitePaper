import { useMemo, useState } from 'react'
import type { DocDiff, SectionDiff } from '@/features/editor/diff/document-diff'

interface DiffSummaryProps {
  diff: DocDiff
}

interface SectionRow {
  id: string
  title: string
  status: SectionDiff['status']
  added: number
  removed: number
  changed: number
}

/**
 * "두 문서 사이의 차이" panel — counts of section/block deltas across the
 * whole `DocDiff`. Per-section breakdown is collapsible (default open) so
 * the page header stays compact.
 */
export function DiffSummary({ diff }: DiffSummaryProps) {
  const [open, setOpen] = useState(true)

  const summary = useMemo(() => {
    let sectionsAdded = 0
    let sectionsRemoved = 0
    let blocksChanged = 0
    let blocksAdded = 0
    let blocksRemoved = 0
    const rows: SectionRow[] = []
    for (const s of diff.sections) {
      if (s.status === 'added') sectionsAdded++
      else if (s.status === 'removed') sectionsRemoved++
      let a = 0
      let r = 0
      let c = 0
      for (const b of s.blockDiffs) {
        if (b.status === 'added') a++
        else if (b.status === 'removed') r++
        else if (b.status === 'changed') c++
      }
      blocksAdded += a
      blocksRemoved += r
      blocksChanged += c
      rows.push({
        id: s.id,
        title: s.newTitle ?? s.baseTitle ?? s.id.slice(-6),
        status: s.status,
        added: a,
        removed: r,
        changed: c,
      })
    }
    return {
      sectionsAdded,
      sectionsRemoved,
      blocksChanged,
      blocksAdded,
      blocksRemoved,
      rows,
    }
  }, [diff])

  return (
    <section
      data-testid="cross-doc-diff-summary"
      className="rounded border border-gray-200 bg-white p-3 text-sm"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          두 문서 사이의 차이
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="cross-doc-diff-summary-toggle"
          className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
        >
          {open ? '접기' : '펴기'}
        </button>
      </header>

      <ul className="mt-2 flex flex-wrap gap-3 text-xs">
        <li className="text-green-700" data-testid="summary-sections-added">
          {summary.sectionsAdded}개 섹션 추가
        </li>
        <li className="text-red-700" data-testid="summary-sections-removed">
          {summary.sectionsRemoved}개 섹션 삭제
        </li>
        <li className="text-yellow-700" data-testid="summary-blocks-changed">
          {summary.blocksChanged}개 블록 변경
        </li>
        <li className="text-green-600">+{summary.blocksAdded} 블록</li>
        <li className="text-red-600">-{summary.blocksRemoved} 블록</li>
      </ul>

      {open && summary.rows.length > 0 && (
        <ul
          className="mt-2 max-h-48 overflow-auto border-t border-gray-100 pt-2 text-xs"
          data-testid="cross-doc-diff-summary-rows"
        >
          {summary.rows.map((row) => (
            <li
              key={row.id}
              data-row-status={row.status}
              className="flex items-center justify-between gap-2 py-0.5"
            >
              <span className="truncate">
                <StatusGlyph status={row.status} /> {row.title}
              </span>
              <span className="font-mono text-[10px] text-gray-500">
                +{row.added} -{row.removed} ~{row.changed}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && summary.rows.length === 0 && (
        <p className="mt-2 text-xs text-gray-500" data-testid="cross-doc-diff-summary-empty">
          섹션 단위 변경이 없습니다.
        </p>
      )}
    </section>
  )
}

function StatusGlyph({ status }: { status: SectionDiff['status'] }) {
  const cls =
    status === 'added'
      ? 'text-green-700'
      : status === 'removed'
        ? 'text-red-700'
        : status === 'changed'
          ? 'text-yellow-700'
          : 'text-gray-400'
  const ch =
    status === 'added' ? '+' : status === 'removed' ? '-' : status === 'changed' ? '~' : '·'
  return (
    <span className={`mr-1 font-mono ${cls}`} aria-hidden="true">
      [{ch}]
    </span>
  )
}
