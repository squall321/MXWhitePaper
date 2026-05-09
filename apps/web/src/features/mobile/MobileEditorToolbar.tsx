import { useState } from 'react'
import type { Slug } from '@/types/document'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { SaveStatusPill } from '@/features/editor/components/SaveStatusPill'

/**
 * MobileEditorToolbar — compact toolbar for <768px viewports. Mounted by the
 * AppShell (or DocumentReader) above the article in place of the desktop
 * `EditorToolbar` when the viewport is mobile.
 *
 * Rationale: the desktop toolbar packs ~12 buttons in a sticky bar and
 * overflows on phones. Rather than monkey-patching wrap/hide rules onto every
 * button there, mobile gets a 5-slot strip:
 *   [편집/미리보기] [저장] [이미지] [동기화 상태] [더 보기 ⋯]
 *
 * "더 보기" pops a bottom sheet with the full action list (deferred to the
 * caller via `onOpenMore` so this file doesn't have to know about every
 * downstream surface — keeps the deps surface small).
 */

export interface MobileEditorToolbarProps {
  slug: Slug
  /** Manual save trigger (Ctrl+S / "저장" button). */
  onSaveNow: () => void
  /** Toggle full-edit / preview. */
  onToggleEdit: () => void
  /** Open the image picker (delegated to the parent). */
  onOpenImage: () => void
  /** Open the bottom-sheet overflow menu. */
  onOpenMore: () => void
}

export function MobileEditorToolbar({
  slug: _slug,
  onSaveNow,
  onToggleEdit,
  onOpenImage,
  onOpenMore,
}: MobileEditorToolbarProps) {
  const dirty = useEditorStore((s) => s.dirty)
  const isEditing = useEditorStore(editorSelectors.isFullEditing)
  const [manualLabel, setManualLabel] = useState<string | null>(null)

  const handleSave = () => {
    setManualLabel('수동 저장됨')
    onSaveNow()
    window.setTimeout(() => setManualLabel(null), 1200)
  }

  return (
    <div
      data-testid="mobile-editor-toolbar"
      className="sticky top-[var(--header-h)] z-sticky -mx-4 flex items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-2 text-sm shadow-sm md:hidden dark:border-gray-800 dark:bg-gray-900"
    >
      <button
        type="button"
        onClick={onToggleEdit}
        className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700"
      >
        {isEditing ? '미리보기' : '편집'}
      </button>

      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty}
        className="inline-flex h-8 items-center rounded-md bg-smsg-700 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-smsg-700/40"
      >
        저장
      </button>

      <button
        type="button"
        onClick={onOpenImage}
        className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700"
        aria-label="이미지 추가"
      >
        이미지
      </button>

      <span className="ml-auto" data-testid="mobile-save-status">
        <SaveStatusPill manualLabel={manualLabel} />
      </span>

      <button
        type="button"
        onClick={onOpenMore}
        data-testid="mobile-more-button"
        className="inline-grid h-8 w-8 place-items-center rounded-md border border-gray-300 bg-white text-gray-700"
        aria-label="더 보기"
      >
        ⋯
      </button>
    </div>
  )
}
