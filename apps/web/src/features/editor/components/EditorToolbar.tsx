import { useEffect, useRef, useState } from 'react'
import type { GalleryBlock, ImageBlock, Slug } from '@/types/document'
import { useEditorStore, editorSelectors } from '../state'
import { insertBlock, isPreconditionFailed } from '../api'
import { ulid } from '../ulid'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from '@/features/upload/components/ImageDropzone'
import type { ImageRecord } from '@/features/upload/api'
import { SaveStatusPill } from './SaveStatusPill'
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal'
import { FindReplaceModal } from './FindReplaceModal'
import { PartPicker } from './PartPicker'
import { SectionLinkPicker } from './SectionLinkPicker'
import { ExportMenu } from '@/features/export/ExportMenu'
import { AiButton } from '@/features/ai/AiButton'

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
  const dropzoneRef = useRef<ImageDropzoneHandle>(null)

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [sectionLinkOpen, setSectionLinkOpen] = useState(false)
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
      const t = ev.target
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA')
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
      const t = setTimeout(() => setManualLabel(null), 1200)
      return () => clearTimeout(t)
    }
    lastStatusRef.current = status
    return
  }, [status, manualLabel])

  const handleManualSave = () => {
    setManualLabel('수동 저장됨')
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
        className="sticky top-[var(--header-h)] z-sticky -mx-4 flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-4 py-2 text-sm shadow-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-gray-800 dark:bg-gray-900"
      >
        <button
          type="button"
          onClick={onToggleEdit}
          className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all duration-base hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
          title="편집/미리보기 전환 (E)"
        >
          {isEditing ? '미리보기' : '편집'}
        </button>

        <button
          type="button"
          onClick={handleManualSave}
          disabled={!dirty}
          className="inline-flex h-8 items-center rounded-md bg-smsg-700 px-3 text-xs font-semibold text-white transition-all duration-base hover:-translate-y-px hover:bg-smsg-900 hover:shadow-md disabled:cursor-not-allowed disabled:bg-smsg-700/40 disabled:hover:translate-y-0 disabled:hover:shadow-none focus-visible:outline-none focus-visible:shadow-focus"
          title="저장 (Cmd/Ctrl+S)"
        >
          저장
        </button>

        <button
          type="button"
          onClick={() => document.execCommand('undo')}
          className="inline-grid h-8 w-8 place-items-center rounded-md border border-gray-300 bg-white text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
          title="실행 취소 (Ctrl+Z)"
          aria-label="실행 취소"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 7h7a4 4 0 010 8H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M5 4L2.5 7 5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => document.execCommand('redo')}
          className="inline-grid h-8 w-8 place-items-center rounded-md border border-gray-300 bg-white text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
          title="다시 실행 (Ctrl+Shift+Z)"
          aria-label="다시 실행"
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
          title="이미지 추가"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6" cy="7" r="1.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 12l3-3 3 3 2-2 2 2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          이미지
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
          자동저장
        </label>

        <PartPicker slug={slug} />

        <span data-testid="save-status">
          <SaveStatusPill
            manualLabel={manualLabel}
            onClick={
              status === 'conflict'
                ? () => {
                    /* Modal already opens via store conflictRemote — clicking the pill
                         should just bring it into view. We re-render the same conflict. */
                  }
                : undefined
            }
          />
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden truncate font-mono text-[11px] text-gray-500 md:inline">{slug}</span>
          <ExportMenu slug={slug} />
          <AiButton />
          <a
            href={`/present/${encodeURIComponent(slug)}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
            title="프레젠테이션 모드 (새 창)"
            data-testid="present-link"
          >
            <span aria-hidden>⛶</span> 프레젠테이션
          </a>
          <button
            type="button"
            onClick={openSectionLinkPicker}
            disabled={!isEditing}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none focus-visible:outline-none focus-visible:shadow-focus"
            title="현재 문서의 섹션으로 가는 링크 삽입"
            data-testid="open-section-link"
            aria-label="섹션 링크 삽입"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6.5 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M9 5l1.5-1.5a2.1 2.1 0 113 3L12 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M7 8l-1.5 1.5a2.1 2.1 0 11-3-3L4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            섹션 링크
          </button>
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
            title="찾기 / 바꾸기 (Ctrl+F)"
            data-testid="open-find-replace"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            찾기
          </button>
          <button
            type="button"
            onClick={onToggleVersions}
            className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
          >
            버전 이력
          </button>
          {isEditing && (
            <a
              href={`/docs/${encodeURIComponent(slug)}/variables`}
              data-testid="open-variables"
              title="문서에 정의된 {{var}} 토큰 값 관리"
              className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
            >
              변수 관리
            </a>
          )}
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="inline-grid h-8 w-8 place-items-center rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
            data-testid="open-shortcuts"
            title="단축키 안내 (?)"
            aria-label="단축키 안내"
          >
            ?
          </button>
          <span className="hidden rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 sm:inline">
            {mode.kind}
          </span>
        </div>
      </div>

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <FindReplaceModal
        open={findOpen}
        onClose={() => setFindOpen(false)}
        slug={slug}
      />

      {sectionLinkOpen && draft && (
        <SectionLinkPicker
          document={draft}
          onSelect={(pick) => {
            // Build the wiki-link source: `[[#section-X.Y|타이틀]]`.
            const text = `[[#${pick.anchor}|${pick.display}]]`
            insertSectionLink(text)
          }}
          onCancel={() => setSectionLinkOpen(false)}
        />
      )}
    </>
  )
}
