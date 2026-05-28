import { useEffect, useMemo, useRef, useState } from 'react'
import type { Block, GalleryBlock, ImageBlock, Slug, Ulid } from '@/types/document'
import { insertBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'
import { ulid } from '../ulid'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from '@/features/upload/components/ImageDropzone'
import type { ImageRecord } from '@/features/upload/api'
import { TABLE_PRESETS } from '../blocks/tablePresets'

export interface SlashMenuItem {
  type: Block['type']
  label: string
  emoji: string
  /** Build a default block payload of this type. */
  build: () => Block
}

/**
 * 모든 SSOT Block 타입 + 한국어 라벨. The default builder fills minimum
 * required fields per JSON-Schema; placeholder blocks (chart/gantt/...) carry
 * an empty body which the editor renders as a JSON-textarea card.
 */
export const SLASH_ITEMS: SlashMenuItem[] = [
  { type: 'paragraph', label: '단락', emoji: 'T', build: () => ({ type: 'paragraph', id: ulid(), text: '' }) },
  // Special: a page break is just an empty paragraph carrying meta.note.
  // Export honors `page-break-before` to insert a CSS page-break.
  {
    type: 'paragraph',
    label: '페이지 나누기',
    emoji: '⤓',
    build: () => ({ type: 'paragraph', id: ulid(), text: '', meta: { note: 'page-break-before' } }),
  },
  // Speaker note: a paragraph carrying meta.note starting with "speaker:" is
  // hidden from read-mode AND from the slide body — it surfaces only in the
  // PresenterView's notes pane. The trailing token is just a serial label so
  // multiple notes in one section stay distinguishable in tooling; the
  // convention only requires the `speaker:` prefix.
  {
    type: 'paragraph',
    label: '발표자 메모',
    emoji: '🎤',
    build: () => ({ type: 'paragraph', id: ulid(), text: '', meta: { note: `speaker:${nextSpeakerSerial()}` } }),
  },
  { type: 'heading-4', label: '큰 제목 (H2)', emoji: 'H₂', build: () => ({ type: 'heading-4', id: ulid(), title: '', level: 2 }) },
  { type: 'heading-4', label: '중간 제목 (H3)', emoji: 'H₃', build: () => ({ type: 'heading-4', id: ulid(), title: '', level: 3 }) },
  { type: 'heading-4', label: '작은 제목 (H4)', emoji: 'H₄', build: () => ({ type: 'heading-4', id: ulid(), title: '', level: 4 }) },
  { type: 'list', label: '목록', emoji: '•', build: () => ({ type: 'list', id: ulid(), style: 'bullet', items: [''] }) },
  { type: 'quote', label: '인용', emoji: '❝', build: () => ({ type: 'quote', id: ulid(), text: '' }) },
  { type: 'callout', label: '강조 박스', emoji: '!', build: () => ({ type: 'callout', id: ulid(), variant: 'info', text: '' }) },
  { type: 'code', label: '코드', emoji: '<>', build: () => ({ type: 'code', id: ulid(), language: 'text', code: '' }) },
  { type: 'math', label: '수식', emoji: '∑', build: () => ({ type: 'math', id: ulid(), expression: '' }) },
  // Table presets — 빈 표 + 4종 (비교/일정/예산/체크리스트). Each entry
  // forwards to the centralized `tablePresets.ts` builder so the slash
  // menu and the insert palette stay in sync.
  ...TABLE_PRESETS.map((p) => ({
    type: 'table' as const,
    label: p.label,
    emoji: p.emoji,
    build: p.build,
  })),
  { type: 'kpi-cards', label: 'KPI 카드', emoji: '★', build: () => ({ type: 'kpi-cards', id: ulid(), items: [{ label: '', value: 0 }] }) },
  { type: 'chart', label: '차트', emoji: '📊', build: () => ({ type: 'chart', id: ulid(), chartType: 'line', data: { labels: [], series: [] } }) },
  { type: 'gantt', label: '간트', emoji: '📅', build: () => ({ type: 'gantt', id: ulid(), tasks: [] }) },
  { type: 'flow', label: '플로우', emoji: '🔀', build: () => ({ type: 'flow', id: ulid(), engine: 'mermaid', source: '' }) },
  { type: 'org-chart', label: '조직도', emoji: '🏢', build: () => ({ type: 'org-chart', id: ulid(), root: { id: ulid(), label: '' } }) },
  { type: 'iframe', label: '임베드 (외부 URL)', emoji: '🌐', build: () => ({ type: 'iframe', id: ulid(), src: '' }) },
  { type: 'iframe', label: 'HTML 임베드 (인라인)', emoji: '⟨/⟩', build: () => ({ type: 'iframe', id: ulid(), html: '<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"></head>\n<body>\n<!-- HTML을 작성하거나 파일을 업로드하세요 -->\n</body>\n</html>' }) },
  { type: 'video', label: '비디오', emoji: '▶', build: () => ({ type: 'video', id: ulid(), url: '' }) },
  { type: 'image', label: '이미지', emoji: '🖼', build: () => ({ type: 'image', id: ulid(), imageId: '' }) },
  { type: 'gallery', label: '갤러리', emoji: '🖼🖼', build: () => ({ type: 'gallery', id: ulid(), layout: 'grid', items: [{ imageId: '' }] }) },
  { type: 'file', label: '파일', emoji: '📎', build: () => ({ type: 'file', id: ulid(), fileId: '', name: '' }) },
  { type: 'doc-link-card', label: '문서 링크 카드', emoji: '🔗', build: () => ({ type: 'doc-link-card', id: ulid(), slug: '' }) },
  { type: 'glossary-ref', label: '용어 참조', emoji: '📖', build: () => ({ type: 'glossary-ref', id: ulid(), term: '' }) },
  { type: 'columns', label: '단(Columns)', emoji: '⫴', build: () => ({ type: 'columns', id: ulid(), columns: [[], []] }) },
  { type: 'bibliography', label: '참고문헌', emoji: '📚', build: () => ({ type: 'bibliography', id: ulid(), entries: [{ text: '' }] }) },
  { type: 'tabs', label: '탭', emoji: '⬒', build: () => ({ type: 'tabs', id: ulid(), tabs: [{ label: '탭', blocks: [] }] }) },
  { type: 'accordion', label: '아코디언', emoji: '▾', build: () => ({ type: 'accordion', id: ulid(), items: [{ label: '항목', blocks: [] }] }) },
  { type: 'data-source', label: '데이터 소스', emoji: '🛢', build: () => ({ type: 'data-source', id: ulid(), endpoint: '', render: 'table' }) },
  { type: 'dashboard-embed', label: '대시보드', emoji: '📈', build: () => ({ type: 'dashboard-embed', id: ulid(), provider: 'grafana', panelId: '' }) },
  { type: 'calculator', label: '계산기', emoji: '🧮', build: () => ({ type: 'calculator', id: ulid(), inputs: [], formula: '0' }) },
]

interface SlashCommandMenuProps {
  slug: Slug
  /** Section that the new block goes into. */
  sectionId: Ulid
  /** Insert position (defaults to append). */
  index?: number
  open: boolean
  onClose: () => void
  /** Anchor coordinates for absolute-positioned menu. */
  anchor?: { x: number; y: number }
}

/**
 * Slash command palette. Filters the SSOT Block list by the typed query and
 * dispatches POST /documents/:slug/blocks on selection.
 */
export function SlashCommandMenu({ slug, sectionId, index, open, onClose, anchor }: SlashCommandMenuProps) {
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const setPendingCaptionFocus = useEditorStore((s) => s.setPendingCaptionFocus)
  const setPendingScrollFocus = useEditorStore((s) => s.setPendingScrollFocus)

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropzoneRef = useRef<ImageDropzoneHandle>(null)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SLASH_ITEMS
    return SLASH_ITEMS.filter(
      (it) => it.type.includes(q) || it.label.toLowerCase().includes(q),
    )
  }, [query])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  if (!open) return null

  const insert = async (item: SlashMenuItem) => {
    if (item.type === 'image') {
      // For images we open the file picker instead of inserting a stub —
      // the dropzone will run the upload then we'll POST a real ImageBlock.
      dropzoneRef.current?.openFilePicker()
      return
    }
    if (!etag) return
    setBusy(true)
    setError(null)
    const built = item.build()
    try {
      const result = await insertBlock(
        slug,
        { section_id: sectionId, index, block: built },
        etag,
        `블록 추가: ${item.label}`,
      )
      applySnapshot(result.document, result.etag)
      // Scroll the new block into view — image blocks get caption focus
      // via the separate `pendingCaptionFocus` flow and don't need this.
      setPendingScrollFocus(built.id)
      onClose()
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

  /** Insert a single uploaded image as an inline ImageBlock. */
  const insertImageBlock = async (rec: ImageRecord) => {
    if (!etag) return
    const id = ulid()
    const block: ImageBlock = { type: 'image', id, imageId: rec.image_id }
    try {
      const result = await insertBlock(
        slug,
        { section_id: sectionId, index, block },
        etag,
        '이미지 추가',
      )
      applySnapshot(result.document, result.etag)
      setPendingCaptionFocus(id)
      onClose()
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
      else setError((err as Error).message)
    }
  }

  /** Insert a single GalleryBlock from a multi-file upload. */
  const insertGalleryBlock = async (records: ImageRecord[]) => {
    if (!etag || records.length < 2) return
    const id = ulid()
    const items = records.map((r) => ({ imageId: r.image_id })) as GalleryBlock['items']
    const block: GalleryBlock = { type: 'gallery', id, layout: 'grid', items }
    try {
      const result = await insertBlock(
        slug,
        { section_id: sectionId, index, block },
        etag,
        '갤러리 추가',
      )
      applySnapshot(result.document, result.etag)
      onClose()
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
      else setError((err as Error).message)
    }
  }

  const style: React.CSSProperties = anchor
    ? { position: 'absolute', top: anchor.y, left: anchor.x }
    : {}

  return (
    <>
      <div
        role="listbox"
        aria-label="Block 추가"
        style={style}
        className="z-50 max-h-72 w-72 overflow-auto rounded border border-gray-300 bg-white shadow-lg"
      >
        <input
          autoFocus
          className="w-full border-b border-gray-200 px-3 py-2 text-sm outline-none"
          placeholder="Block 검색…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
          }}
        />
        <ul className="py-1">
          {/* Dedicated upload entry — opens the file picker via the dropzone. */}
          <li>
            <button
              type="button"
              onClick={() => dropzoneRef.current?.openFilePicker()}
              disabled={busy}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-smsg-100 disabled:opacity-40"
            >
              <span className="w-5 text-center">📤</span>
              <span className="flex-1">이미지 업로드 (파일 선택)</span>
              <span className="text-xs text-gray-400">image</span>
            </button>
          </li>
          {items.map((it) => (
            <li key={it.type}>
              <button
                type="button"
                onClick={() => void insert(it)}
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-smsg-100 disabled:opacity-40"
              >
                <span className="w-5 text-center">{it.emoji}</span>
                <span className="flex-1">{it.label}</span>
                <span className="text-xs text-gray-400">{it.type}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500">결과 없음</li>
          )}
        </ul>
        {error && <p className="border-t border-gray-200 px-3 py-1 text-xs text-red-600">{error}</p>}
      </div>

      {/* Hidden dropzone — the slash menu only uses the file-picker API. */}
      <ImageDropzone
        ref={dropzoneRef}
        mode="inline"
        onImageReady={async (rec, ctx) => {
          // Multi-file gallery flow: defer insertion to onBatchReady so we
          // create one GalleryBlock instead of N ImageBlocks.
          if (ctx.mode === 'gallery' && ctx.total > 1) return
          await insertImageBlock(rec)
        }}
        onBatchReady={async (recs) => {
          if (recs.length > 1) await insertGalleryBlock(recs)
        }}
      />
    </>
  )
}

/**
 * Best-effort serial label for a new speaker-note block. Scans the current
 * draft for paragraph blocks whose `meta.note` matches `/^speaker:(\d+)$/`,
 * then returns max+1 (default 1). The `speaker:` prefix is what the convention
 * checks; this serial is purely a hint for the author.
 */
function nextSpeakerSerial(): number {
  const draft = useEditorStore.getState().draft
  if (!draft) return 1
  const used = new Set<number>()
  type Walkable = {
    blocks?: readonly { type?: string; meta?: { note?: string } }[]
    subsections?: readonly Walkable[]
  }
  const walk = (s: Walkable) => {
    for (const b of s.blocks ?? []) {
      if (b.type !== 'paragraph') continue
      const m = b.meta?.note?.match(/^speaker:(\d+)$/)
      if (m) used.add(Number(m[1]))
    }
    s.subsections?.forEach(walk)
  }
  ;(draft.sections ?? []).forEach((s) => walk(s as unknown as Walkable))
  if (used.size === 0) return 1
  return Math.max(...used) + 1
}
