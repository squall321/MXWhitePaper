import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Block, Slug } from '@/types/document'
import type { AnySection } from '../api'
import { patchSection, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'
import { SectionEditor } from './SectionEditor'

interface SectionQuickEditProps {
  slug: Slug
  section: AnySection
  /** Called after a successful save with the BE-returned snapshot. */
  onSaved: () => void
  /** Called when the user clicks Cancel. */
  onCancel: () => void
}

/**
 * In-place section editor. Shown by `SectionRenderer` when
 * `editorStore.mode == quickEdit:<thisId>`.
 *
 *   - PATCH /documents/:slug/sections/:id with current ETag on Save.
 *   - 412 ⇒ surface conflict modal via the editor store.
 */
export function SectionQuickEdit({ slug, section, onSaved, onCancel }: SectionQuickEditProps) {
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const [, setSearchParams] = useSearchParams()

  const [title, setTitle] = useState(section.title)
  const [blocks, setBlocks] = useState<Block[]>(section.blocks)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!etag) return
    setSaving(true)
    setError(null)
    try {
      const result = await patchSection(
        slug,
        section.id,
        { title, blocks },
        etag,
        '섹션 수정',
      )
      applySnapshot(result.document, result.etag)
      onSaved()
      // strip ?edit param
      setSearchParams((p) => {
        const next = new URLSearchParams(p)
        next.delete('edit')
        return next
      })
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null) // signal conflict; auto-save hook will fetch remote
        setError('다른 사용자의 변경 사항과 충돌했습니다. 다시 시도하세요.')
      } else {
        setError((err as Error).message ?? '저장 실패')
      }
    } finally {
      setSaving(false)
    }
  }, [etag, slug, section.id, title, blocks, applySnapshot, onSaved, setConflict, setSearchParams])

  const handleCancel = useCallback(() => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p)
      next.delete('edit')
      return next
    })
    onCancel()
  }, [onCancel, setSearchParams])

  return (
    <section
      data-section-level={section.level}
      data-quick-edit
      className="space-y-3 rounded border border-smsg-500/40 bg-smsg-100/30 p-4"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-smsg-500">{section.number}</span>
        <input
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-lg font-semibold text-smsg-900 focus:border-smsg-500 focus:outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="섹션 제목"
        />
      </div>

      <SectionEditor initialBlocks={section.blocks} onChange={setBlocks} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !etag}
          className="rounded bg-smsg-700 px-3 py-1 text-sm font-medium text-white hover:bg-smsg-900 disabled:opacity-50"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
        >
          취소
        </button>
        <span className="text-xs text-gray-500">
          서식: ↩︎ 새 단락, `/` 메뉴, **굵게**
        </span>
      </div>
    </section>
  )
}
