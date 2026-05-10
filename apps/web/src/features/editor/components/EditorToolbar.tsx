import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { GalleryBlock, ImageBlock, Slug } from '@/types/document'
import { useEditorStore, editorSelectors } from '../state'
import { insertBlock, isPreconditionFailed } from '../api'
import { ulid } from '../ulid'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from '@/features/upload/components/ImageDropzone'
import type { ImageRecord } from '@/features/upload/api'
import { AutoSaveStatusPill } from './AutoSaveStatusPill'
import { PartPicker } from './PartPicker'
import { ExportMenu } from '@/features/export/ExportMenu'
import { AiButton } from '@/features/ai/AiButton'
import { ShareModal } from '@/features/sharing/ShareModal'
import { useLocale } from '@/lib/i18n'

// Rarely-shown modals — keep them off the editor's critical path. Each one
// only mounts when its toggle is true so the lazy chunk is fetched on demand.
const KeyboardShortcutsModal = lazy(() =>
  import('./KeyboardShortcutsModal').then((m) => ({ default: m.KeyboardShortcutsModal })),
)
const FindReplaceModal = lazy(() =>
  import('./FindReplaceModal').then((m) => ({ default: m.FindReplaceModal })),
)
const SectionLinkPicker = lazy(() =>
  import('./SectionLinkPicker').then((m) => ({ default: m.SectionLinkPicker })),
)

interface EditorToolbarProps {
  slug: Slug
  /** Saves the current draft now (Ctrl+S). */
  onSaveNow: () => void
  /** Show the version-history side panel (toggle). */
  onToggleVersions: () => void
  /** Switch full-edit on/off. */
  onToggleEdit: () => void
}

/**
 * Top action strip rendered above the article in edit mode. Sticky so the save
 * pill and shortcut button remain reachable while scrolling. The pill morphs
 * through idle / 입력 중 / 저장 중 / 저장됨 ✓ / 충돌 ⚠ / 실패 ✗ states.
 */
export function EditorToolbar({
  slug,
  onSaveNow,
  onToggleVersions,
  onToggleEdit,
}: EditorToolbarProps) {
  const { t } = useLocale()
  const mode = useEditorStore((s) => s.mode)
  const dirty = useEditorStore((s) => s.dirty)
  const status = useEditorStore((s) => s.autoSaveStatus)
  const autoOn = useEditorStore((s) => s.autoSaveEnabled)
  const setAuto = useEditorStore((s) => s.setAutoSaveEnabled)
  const etag = useEditorStore((s) => s.etag)
  const draft = useEditorStore((s) => s.draft)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const setPendingCaptionFocus = useEditorStore((s) => s.setPendingCaptionFocus)
  const canUndo = useEditorStore((s) => s.undoStack.length > 0)
  const canRedo = useEditorStore((s) => s.redoStack.length > 0)
  const dropzoneRef = useRef<ImageDropzoneHandle>(null)

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [sectionLinkOpen, setSectionLinkOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const savedSelectionRef = useRef<Range | null>(null)
  const [manualLabel, setManualLabel] = useState<string | null>(null)
  const lastStatusRef = useRef(status)

  // Capture the current contentEditable Range so we can restore the cursor
  // after the modal steals focus, then drop the wiki-link text at the
  // original position.
  const openSectionLinkPicker = () => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange()
    } else {
      savedSelectionRef.current = null
    }
    setSectionLinkOpen(true)
  }

  const insertSectionLink = (text: string) => {
    setSectionLinkOpen(false)
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    const saved = savedSelectionRef.current
    if (sel && saved) {
      sel.removeAllRanges()
      sel.addRange(saved)
    }
    // execCommand('insertText') only runs against the currently-focused
    // contentEditable. When the user opens the picker from the toolbar
    // without a prior cursor, we silently no-op rather than dropping text
    // somewhere unexpected.
    try {
      document.execCommand('insertText', false, text)
    } catch {
      /* ignore — happens in non-editable focus */
    }
    savedSelectionRef.current = null
  }

  // Override Ctrl/Cmd+F: the browser's native find can't see across our
  // contentEditable swarm + only highlights one block at a time. Capture
  // phase so we beat any contentEditable that might preventDefault first.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const mod = ev.metaKey || ev.ctrlKey
      if (mod && (ev.key === 'f' || ev.key === 'F')) {
        ev.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const isEditing = editorSelectors.isEditing({
    ...useEditorStore.getState(),
  })

  /** Pick a default insert target — first top-level section. */
  const targetSectionId = draft?.sections[0]?.id

  // Open the shortcuts modal on global "?" (when not typing). The editor
  // shortcut hook handles the typing-target check.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== '?' || ev.shiftKey === false) {
        // shift+? is what most kbds emit for "?".
        if (ev.key !== '?') return
      }
      const tgt = ev.target
      if (
        tgt instanceof HTMLElement &&
        (tgt.isContentEditable ||
          tgt.tagName === 'INPUT' ||
          tgt.tagName === 'TEXTAREA')
      )
        return
      ev.preventDefault()
      setShortcutsOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Listen for the slash-menu image trigger.
  useEffect(() => {
    function trigger() {
      dropzoneRef.current?.openFilePicker()
    }
    window.addEventListener('mxwp:open-image-picker', trigger as EventListener)
    return () =>
      window.removeEventListener('mxwp:open-image-picker', trigger as EventListener)
  }, [])

  // Show "수동 저장됨" on Cmd+S transitions (saving → saved within ~1.5s).
  useEffect(() => {
    if (status === 'saved' && lastStatusRef.current === 'saving' && manualLabel) {
      const id = setTimeout(() => setManualLabel(null), 1200)
      return () => clearTimeout(id)
    }
    lastStatusRef.current = status
    return
  }, [status, manualLabel])

  const handleManualSave = () => {
    setManualLabel(t('toolbar.savedManual'))
    onSaveNow()
  }

  const insertImage = async (rec: ImageRecord) => {
    if (!etag || !targetSectionId) return
    const id = ulid()
    const block: ImageBlock = { type: 'image', id, imageId: rec.image_id }
    try {
      const result = await insertBlock(
        slug,
        { section_id: targetSectionId, block },
        etag,
        '이미지 추가',
      )
      applySnapshot(result.document, result.etag)
      setPendingCaptionFocus(id)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  const insertGallery = async (recs: ImageRecord[]) => {
    if (!etag || !targetSectionId || recs.length < 2) return
    const id = ulid()
    const items = recs.map((r) => ({ imageId: r.image_id })) as GalleryBlock['items']
    const block: GalleryBlock = { type: 'gallery', id, layout: 'grid', items }
    try {
      const result = await insertBlock(
        slug,
        { section_id: targetSectionId, block },
        etag,
        '갤러리 추가',
      )
      applySnapshot(result.document, result.etag)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  return (
    <>
      <div
        data-editor-toolbar
        data-testid="editor-toolbar"
        className="sticky top-[calc(var(--header-h)+2rem)] z-10 -mx-4 flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-4 py-2 text-sm shadow-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-gray-800 dark:bg-gray-900"
      >
        <button
          type="button"
          onClick={onToggleEdit}
          className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all duration-base hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
          title={t('toolbar.toggleEdit.title')}
        >
          {isEditing ? t('toolbar.preview') : t('toolbar.edit')}
        </button>

        {/* Save action — reflects autoSaveStatus so the button never looks
            "broken" when the doc is already saved. Always clickable: a
            click forces an immediate PUT (Ctrl+S equivalent) which is
            useful when the user wants to confirm a save before navigating
            away. The label morphs through the live state so the user
            always knows what's happening. */}
        <button
          type="button"
          onClick={handleManualSave}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-all duration-base hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus ${
            status === 'saving' || dirty
              ? 'bg-smsg-700 text-white hover:bg-smsg-900'
              : status === 'conflict' || status === 'error'
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
          }`}
          title={
            dirty
              ? t('toolbar.save.title')
              : status === 'saving'
                ? '저장 중…'
                : status === 'conflict'
                  ? '동기화 충돌 — 새로고침 필요'
                  : status === 'error'
                    ? '저장 실패 — 클릭으로 재시도'
                    : '모든 변경 저장됨 — 클릭하면 강제 저장'
          }
        >
          <span aria-hidden="true">
            {status === 'saving' ? '⟳' : dirty ? '●' : status === 'conflict' || status === 'error' ? '⚠' : '✓'}
          </span>
          <span>
            {status === 'saving'
              ? '저장 중'
              : dirty
                ? t('toolbar.save')
                : status === 'conflict'
                  ? '충돌'
                  : status === 'error'
                    ? '재시도'
                    : '저장됨'}
          </span>
        </button>

        {/* Undo / Redo: route through the editor store so we walk the
            *patch* history (blocks added/deleted/moved/columns resized,
            etc.), not just contentEditable text edits. The button gets
            disabled when the corresponding stack is empty so users
            can tell at a glance whether anything is left to undo. */}
        <button
          type="button"
          onClick={() => void useEditorStore.getState().undo()}
          disabled={!canUndo}
          className="inline-grid h-8 w-8 place-items-center rounded-md border border-gray-300 bg-white text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          title={canUndo ? t('toolbar.undo.title') : t('toolbar.undo.empty')}
          aria-label={t('toolbar.undo')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 7h7a4 4 0 010 8H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M5 4L2.5 7 5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => void useEditorStore.getState().redo()}
          disabled={!canRedo}
          className="inline-grid h-8 w-8 place-items-center rounded-md border border-gray-300 bg-white text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          title={canRedo ? t('toolbar.redo.title') : t('toolbar.redo.empty')}
          aria-label={t('toolbar.redo')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13 7H6a4 4 0 000 8h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M11 4l2.5 3L11 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => dropzoneRef.current?.openFilePicker()}
          disabled={!isEditing || !targetSectionId}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none focus-visible:outline-none focus-visible:shadow-focus"
          title={t('toolbar.image.title')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6" cy="7" r="1.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 12l3-3 3 3 2-2 2 2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          {t('toolbar.image')}
        </button>

        <ImageDropzone
          ref={dropzoneRef}
          mode="inline"
          onImageReady={async (rec, ctx) => {
            if (ctx.mode === 'gallery' && ctx.total > 1) return
            await insertImage(rec)
          }}
          onBatchReady={async (recs) => {
            if (recs.length > 1) await insertGallery(recs)
          }}
        />

        <span className="mx-1 hidden h-5 w-px bg-gray-200 sm:inline-block" aria-hidden="true" />

        <label className="hidden cursor-pointer items-center gap-1.5 text-xs text-gray-700 sm:inline-flex">
          <input
            type="checkbox"
            checked={autoOn}
            onChange={(e) => setAuto(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-smsg-700 focus:ring-smsg-500"
          />
          {t('toolbar.autoSave')}
        </label>

        <PartPicker slug={slug} />

        <span data-testid="save-status">
          {/* Sprint 5 auto-save UX: 4-state pill with relative timestamp +
              offline backlog counter + conflict click-through. The legacy
              `manualLabel` flash is no longer surfaced — the new pill shows
              "저장됨 N분 전" instead, which already implies a recent save. */}
          <AutoSaveStatusPill />
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden truncate font-mono text-[11px] text-gray-500 md:inline">{slug}</span>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            data-testid="open-share"
            title="공유 링크 관리"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.7 7l4.6-2M5.7 9l4.6 2" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            공유
          </button>
          <ExportMenu slug={slug} />
          <AiButton />
          <a
            href={`/present/${encodeURIComponent(slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
            title={t('toolbar.present.title')}
            data-testid="present-link"
          >
            <span aria-hidden>⛶</span> {t('toolbar.present')}
          </a>
          <button
            type="button"
            onClick={openSectionLinkPicker}
            disabled={!isEditing}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none focus-visible:outline-none focus-visible:shadow-focus"
            title={t('toolbar.sectionLink.title')}
            data-testid="open-section-link"
            aria-label={t('toolbar.sectionLink.aria')}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6.5 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M9 5l1.5-1.5a2.1 2.1 0 113 3L12 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M7 8l-1.5 1.5a2.1 2.1 0 11-3-3L4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {t('toolbar.sectionLink')}
          </button>
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
            title={t('toolbar.find.title')}
            data-testid="open-find-replace"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {t('toolbar.find')}
          </button>
          <button
            type="button"
            onClick={onToggleVersions}
            title="모든 변경이 자동 기록됨 — 어느 시점이든 복원 가능"
            data-testid="toolbar-versions"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 4v4l2.5 1.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M14 8a6 6 0 11-1.76-4.24M14 3v3h-3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t('toolbar.versions')}
          </button>
          {isEditing && (
            <a
              href={`/docs/${encodeURIComponent(slug)}/variables`}
              data-testid="open-variables"
              title={t('toolbar.variables.title')}
              className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t('toolbar.variables')}
            </a>
          )}
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="inline-grid h-8 w-8 place-items-center rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
            data-testid="open-shortcuts"
            title={t('toolbar.shortcuts.title')}
            aria-label={t('toolbar.shortcuts.aria')}
          >
            ?
          </button>
          <span className="hidden rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 sm:inline">
            {mode.kind}
          </span>
        </div>
      </div>

      {/* Lazy-loaded modals — only mount when their toggle flips on so the
          chunk download is deferred until first open. */}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcutsModal
            open={shortcutsOpen}
            onClose={() => setShortcutsOpen(false)}
          />
        </Suspense>
      )}

      {findOpen && (
        <Suspense fallback={null}>
          <FindReplaceModal
            open={findOpen}
            onClose={() => setFindOpen(false)}
            slug={slug}
          />
        </Suspense>
      )}

      {sectionLinkOpen && draft && (
        <Suspense fallback={null}>
          <SectionLinkPicker
            document={draft}
            onSelect={(pick) => {
              // Build the wiki-link source: `[[#section-X.Y|타이틀]]`.
              const text = `[[#${pick.anchor}|${pick.display}]]`
              insertSectionLink(text)
            }}
            onCancel={() => setSectionLinkOpen(false)}
          />
        </Suspense>
      )}

      <ShareModal
        open={shareOpen}
        slug={slug}
        onClose={() => setShareOpen(false)}
      />
    </>
  )
}
