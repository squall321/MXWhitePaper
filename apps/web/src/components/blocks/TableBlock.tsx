import { useState } from 'react'
import type { TableBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { Modal } from '@/components/ui/Modal'
import { ChartBlockEditor } from '@/features/editor/blocks/ChartBlockEditor'
import { buildChartFromTable } from '@/features/editor/tableToChart'
import { insertBlock, isPreconditionFailed } from '@/features/editor/api'
import { findParentSection } from '@/features/editor/findSection'

/**
 * Table block — sticky header, zebra rows, horizontal scroll on small
 * screens. Cell text runs through the inline parser so wiki links inside
 * cells are clickable.
 *
 * In full-edit mode a hover affordance ("📊 차트로") opens a modal
 * prefilled with the table's data converted to chart series. Saving the
 * modal inserts a new ChartBlock right after this table in its parent
 * section.
 */
export function TableBlockView({ block }: { block: TableBlock }) {
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  const slug = useEditorStore((s) => s.slug)
  const etag = useEditorStore((s) => s.etag)
  const draft = useEditorStore((s) => s.draft)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [modalOpen, setModalOpen] = useState(false)
  const [pending, setPending] = useState(() => buildChartFromTable(block))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openModal = () => {
    setPending(buildChartFromTable(block))
    setError(null)
    setModalOpen(true)
  }

  const onInsert = async () => {
    if (!slug || !etag) return
    setBusy(true)
    setError(null)
    try {
      const parent = findParentSection(draft, block.id)
      const sectionId = parent?.id ?? draft?.sections[0]?.id
      if (!sectionId) throw new Error('대상 섹션을 찾지 못했습니다.')
      const result = await insertBlock(
        slug,
        { section_id: sectionId, block: pending },
        etag,
        '표 → 차트 삽입',
      )
      apply(result.document, result.etag)
      setModalOpen(false)
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

  return (
    <div className="group relative">
      {/* `max-h-[60vh]` 로 자체 스크롤 컨테이너를 만들어서 sticky thead 가 표
          컨테이너 안에서만 부착되도록 한다. 그렇지 않으면 sticky 가 viewport
          기준으로 올라가 TopBar/Breadcrumb 자리에 박혀 본문이 헤더 위로 침투
          한다. */}
      <div data-no-swipe className="max-h-[60vh] overflow-x-auto overflow-y-auto rounded-md border border-gray-200 shadow-sm">
        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-content bg-smsg-50 text-smsg-900">
            <tr>
              {block.headers.map((h, i) => (
                <th
                  key={i}
                  className="border-b border-smsg-100 px-3 py-2 font-semibold whitespace-nowrap"
                  scope="col"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr
                key={r}
                className="odd:bg-white even:bg-gray-50 transition-colors hover:bg-smsg-50/50"
              >
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="border-b border-gray-100 px-3 py-2 align-top text-gray-800"
                  >
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isFullEditing && slug && (
        <button
          type="button"
          aria-label="표를 차트로 변환"
          data-table-to-chart
          onClick={openModal}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-smsg-200 bg-white/95 px-2 py-1 text-[11px] font-medium text-smsg-700 opacity-0 shadow-sm transition-opacity duration-base hover:bg-smsg-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <span aria-hidden>📊</span>
          <span>차트로</span>
        </button>
      )}

      {modalOpen && (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="표 → 차트"
          size="full"
          footer={
            <div className="flex items-center justify-end gap-2">
              {error && (
                <span className="mr-auto rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                  {error}
                </span>
              )}
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={busy}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void onInsert()}
                disabled={busy}
                data-action="insert-chart"
                className="rounded bg-smsg-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-60"
              >
                {busy ? '추가 중…' : '차트 삽입'}
              </button>
            </div>
          }
        >
          <div className="p-4">
            <ChartBlockEditor block={pending} onChange={setPending} />
          </div>
        </Modal>
      )}
    </div>
  )
}
