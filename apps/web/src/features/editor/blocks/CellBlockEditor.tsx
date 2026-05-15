import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CellBlock,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
} from '@/types/document'
import { ulid } from '@/features/editor/ulid'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from '@/features/upload/components/ImageDropzone'

interface Props {
  blocks: readonly CellBlock[]
  onChange: (next: CellBlock[]) => void
}

/**
 * Inline edits the rich content of a sparse cell (text OR blocks). Renders
 * each block as a small editable row; "+" buttons append a fresh paragraph
 * / list / image. Image rows now use a proper picker modal (upload via
 * dropzone or imageId fallback) — see `CellImagePickerModal` below.
 *
 * Rows can be reordered via per-row ▲/▼ buttons (primary, keyboard/mobile
 * friendly) or native HTML5 drag-and-drop (desktop mouse bonus).
 */
export function CellBlockEditor({ blocks, onChange }: Props): JSX.Element {
  // Picker modal state: `replaceIdx` discriminates append (null) vs replace
  // (index of the image row to swap). One modal mounted at a time.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replaceIdx, setReplaceIdx] = useState<number | null>(null)

  // Native HTML5 DnD local state. `dragIdx` is the row being dragged;
  // `dropIdx` is the row currently under the pointer (highlighted with a
  // top inset border). Both clear on drop / dragend.
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  const updateAt = useCallback(
    (idx: number, next: CellBlock) => {
      const out = blocks.slice() as CellBlock[]
      out[idx] = next
      onChange(out)
    },
    [blocks, onChange],
  )

  const remove = useCallback(
    (idx: number) => {
      const out = blocks.slice() as CellBlock[]
      out.splice(idx, 1)
      onChange(out)
    },
    [blocks, onChange],
  )

  const moveUp = useCallback(
    (idx: number) => {
      if (idx <= 0) return
      onChange(moveBlock(blocks, idx, idx - 1) as CellBlock[])
    },
    [blocks, onChange],
  )

  const moveDown = useCallback(
    (idx: number) => {
      if (idx >= blocks.length - 1) return
      onChange(moveBlock(blocks, idx, idx + 1) as CellBlock[])
    },
    [blocks, onChange],
  )

  const moveTo = useCallback(
    (from: number, to: number) => {
      onChange(moveBlock(blocks, from, to) as CellBlock[])
    },
    [blocks, onChange],
  )

  const rowDragProps = useCallback(
    (idx: number): React.HTMLAttributes<HTMLDivElement> => ({
      draggable: true,
      onDragStart: (e) => {
        setDragIdx(idx)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(idx))
      },
      onDragOver: (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (dragIdx !== null && dragIdx !== idx) setDropIdx(idx)
      },
      onDragLeave: () => {
        setDropIdx(null)
      },
      onDrop: (e) => {
        e.preventDefault()
        const from = dragIdx
        const to = idx
        setDragIdx(null)
        setDropIdx(null)
        if (from === null || from === to) return
        moveTo(from, to)
      },
      onDragEnd: () => {
        setDragIdx(null)
        setDropIdx(null)
      },
      style:
        dropIdx === idx ? { boxShadow: 'inset 0 2px 0 #1428a0' } : undefined,
    }),
    [dragIdx, dropIdx, moveTo],
  )

  const append = useCallback(
    (kind: 'paragraph' | 'list' | 'image') => {
      const out = blocks.slice() as CellBlock[]
      if (kind === 'paragraph') {
        const p: ParagraphBlock = { type: 'paragraph', id: ulid(), text: '' }
        out.push(p)
        onChange(out)
        return
      }
      if (kind === 'list') {
        const l: ListBlock = {
          type: 'list',
          id: ulid(),
          style: 'bullet',
          items: [''],
        }
        out.push(l)
        onChange(out)
        return
      }
      // image — open picker modal in append mode.
      setReplaceIdx(null)
      setPickerOpen(true)
    },
    [blocks, onChange],
  )

  const openReplace = useCallback((idx: number) => {
    setReplaceIdx(idx)
    setPickerOpen(true)
  }, [])

  const onPicked = useCallback(
    (imageId: string) => {
      const trimmed = imageId.trim()
      if (trimmed === '') {
        setPickerOpen(false)
        return
      }
      const out = blocks.slice() as CellBlock[]
      if (replaceIdx == null) {
        const img: ImageBlock = { type: 'image', id: ulid(), imageId: trimmed }
        out.push(img)
      } else {
        const existing = out[replaceIdx]
        if (existing && existing.type === 'image') {
          out[replaceIdx] = { ...existing, imageId: trimmed }
        }
      }
      onChange(out)
      setPickerOpen(false)
    },
    [blocks, onChange, replaceIdx],
  )

  const onClosePicker = useCallback(() => setPickerOpen(false), [])

  return (
    <div className="cell-block-editor space-y-1 text-sm">
      {blocks.length === 0 && (
        <p className="text-xs text-gray-400">셀이 비어있습니다</p>
      )}
      {blocks.map((b, idx) => {
        const canMoveUp = idx > 0
        const canMoveDown = idx < blocks.length - 1
        const dragProps = rowDragProps(idx)
        if (b.type === 'paragraph') {
          return (
            <ParagraphRowEditor
              key={b.id}
              block={b}
              onChange={(next) => updateAt(idx, next)}
              onRemove={() => remove(idx)}
              onMoveUp={() => moveUp(idx)}
              onMoveDown={() => moveDown(idx)}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              dragProps={dragProps}
            />
          )
        }
        if (b.type === 'list') {
          return (
            <ListRowEditor
              key={b.id}
              block={b}
              onChange={(next) => updateAt(idx, next)}
              onRemove={() => remove(idx)}
              onMoveUp={() => moveUp(idx)}
              onMoveDown={() => moveDown(idx)}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              dragProps={dragProps}
            />
          )
        }
        if (b.type === 'image') {
          return (
            <ImageRowEditor
              key={b.id}
              block={b}
              onRemove={() => remove(idx)}
              onReplace={() => openReplace(idx)}
              onMoveUp={() => moveUp(idx)}
              onMoveDown={() => moveDown(idx)}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              dragProps={dragProps}
            />
          )
        }
        return null
      })}
      <div className="flex flex-wrap items-center gap-1 pt-1">
        <button
          type="button"
          onClick={() => append('paragraph')}
          className="text-xs px-1 hover:bg-gray-100 rounded"
        >
          + ¶
        </button>
        <button
          type="button"
          onClick={() => append('list')}
          className="text-xs px-1 hover:bg-gray-100 rounded"
        >
          + ⋮ list
        </button>
        <button
          type="button"
          onClick={() => append('image')}
          className="text-xs px-1 hover:bg-gray-100 rounded"
        >
          + 🖼 image
        </button>
      </div>
      {pickerOpen && (
        <CellImagePickerModal
          mode={replaceIdx == null ? 'append' : 'replace'}
          onPick={onPicked}
          onClose={onClosePicker}
        />
      )}
    </div>
  )
}

/** Move the block at `from` to `to`. Returns a NEW array; original
 *  unchanged. Out-of-range indices return the array as-is.
 */
export function moveBlock<T>(arr: readonly T[], from: number, to: number): T[] {
  const n = arr.length
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return arr.slice()
  const out = arr.slice()
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item as T)
  return out
}

/** Apply moveUp at `idx` to `blocks` and call `onChange` with the result.
 *  Pure-function variant of the `moveUp` callback inside `CellBlockEditor`,
 *  extracted for testability (mirrors `applyBold` pattern).
 */
export function applyMoveUp(
  blocks: readonly CellBlock[],
  idx: number,
  onChange: (next: CellBlock[]) => void,
): void {
  if (idx <= 0) return
  onChange(moveBlock(blocks, idx, idx - 1) as CellBlock[])
}

/** Apply moveDown at `idx`. See `applyMoveUp`. */
export function applyMoveDown(
  blocks: readonly CellBlock[],
  idx: number,
  onChange: (next: CellBlock[]) => void,
): void {
  if (idx >= blocks.length - 1) return
  onChange(moveBlock(blocks, idx, idx + 1) as CellBlock[])
}

/** Wrap the substring [selStart, selEnd) in `marker` (e.g. `**`). Returns
 *  the new full text and the new cursor positions. Pure, easily tested.
 */
export function wrapSelection(
  text: string,
  selStart: number,
  selEnd: number,
  marker: string,
): { text: string; selStart: number; selEnd: number } {
  if (selStart === selEnd) {
    const head = text.slice(0, selStart)
    const tail = text.slice(selStart)
    const inserted = `${marker}${marker}`
    return {
      text: `${head}${inserted}${tail}`,
      selStart: selStart + marker.length,
      selEnd: selStart + marker.length,
    }
  }
  const head = text.slice(0, selStart)
  const middle = text.slice(selStart, selEnd)
  const tail = text.slice(selEnd)
  return {
    text: `${head}${marker}${middle}${marker}${tail}`,
    selStart: selStart + marker.length,
    selEnd: selEnd + marker.length,
  }
}

/** Wrap selection as a markdown link `[text](url)`. If `url` is empty,
 *  emit `[text](url)` with the URL placeholder so user can fill it.
 *  If no selection, inserts the full template `[](url)` at the caret.
 */
export function wrapLink(
  text: string,
  selStart: number,
  selEnd: number,
  url: string,
): { text: string; selStart: number; selEnd: number } {
  const safeUrl = url.trim() || 'url'
  if (selStart === selEnd) {
    const insertion = `[](${safeUrl})`
    const head = text.slice(0, selStart)
    const tail = text.slice(selStart)
    return {
      text: `${head}${insertion}${tail}`,
      selStart: selStart + 1,
      selEnd: selStart + 1,
    }
  }
  const head = text.slice(0, selStart)
  const middle = text.slice(selStart, selEnd)
  const tail = text.slice(selEnd)
  const inserted = `[${middle}](${safeUrl})`
  return {
    text: `${head}${inserted}${tail}`,
    selStart: head.length + inserted.length - safeUrl.length - 1,
    selEnd: head.length + inserted.length - 1,
  }
}

/** Apply bold (`**`) to a paragraph's selection. Pure: returns new sel
 *  range and calls onChange with the updated block. Extracted so tests
 *  can call it without simulating DOM selection state.
 */
export function applyBold(
  current: ParagraphBlock,
  selStart: number,
  selEnd: number,
  onChange: (b: ParagraphBlock) => void,
): { selStart: number; selEnd: number } {
  const r = wrapSelection(current.text, selStart, selEnd, '**')
  onChange({ ...current, text: r.text })
  return { selStart: r.selStart, selEnd: r.selEnd }
}

/** Italic (`*`) variant of applyBold. */
export function applyItalic(
  current: ParagraphBlock,
  selStart: number,
  selEnd: number,
  onChange: (b: ParagraphBlock) => void,
): { selStart: number; selEnd: number } {
  const r = wrapSelection(current.text, selStart, selEnd, '*')
  onChange({ ...current, text: r.text })
  return { selStart: r.selStart, selEnd: r.selEnd }
}

/** Apply a markdown link with the given URL. */
export function applyLink(
  current: ParagraphBlock,
  selStart: number,
  selEnd: number,
  url: string,
  onChange: (b: ParagraphBlock) => void,
): { selStart: number; selEnd: number } {
  const r = wrapLink(current.text, selStart, selEnd, url)
  onChange({ ...current, text: r.text })
  return { selStart: r.selStart, selEnd: r.selEnd }
}

interface ParagraphRowProps {
  block: ParagraphBlock
  onChange: (next: ParagraphBlock) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  dragProps: React.HTMLAttributes<HTMLDivElement>
}

function ParagraphRowEditor({
  block,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  dragProps,
}: ParagraphRowProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const pendingSel = useRef<{ start: number; end: number } | null>(null)

  // IME-safe: we never touch composition events. The buttons read the
  // textarea's selection only on click — Korean (or any IME) composition
  // continues uninterrupted.
  const getSel = (): { start: number; end: number } => {
    const ta = ref.current
    if (ta) {
      return { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 }
    }
    return { start: block.text.length, end: block.text.length }
  }

  const onBold = () => {
    const { start, end } = getSel()
    const next = wrapSelection(block.text, start, end, '**')
    pendingSel.current = { start: next.selStart, end: next.selEnd }
    onChange({ ...block, text: next.text })
  }
  const onItalic = () => {
    const { start, end } = getSel()
    const next = wrapSelection(block.text, start, end, '*')
    pendingSel.current = { start: next.selStart, end: next.selEnd }
    onChange({ ...block, text: next.text })
  }
  const onLink = () => {
    if (typeof window === 'undefined') return
    const url = window.prompt('URL:')
    if (url == null) return
    if (url.trim() === '') return
    const { start, end } = getSel()
    const next = wrapLink(block.text, start, end, url)
    pendingSel.current = { start: next.selStart, end: next.selEnd }
    onChange({ ...block, text: next.text })
  }

  useEffect(() => {
    if (pendingSel.current && ref.current) {
      const { start, end } = pendingSel.current
      ref.current.focus()
      ref.current.setSelectionRange(start, end)
      pendingSel.current = null
    }
  }, [block.text])

  return (
    <div className="flex items-start gap-1 group/para group/row" {...dragProps}>
      <div className="flex flex-col gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label="위로 이동"
          title="위로 이동"
          className="text-xs px-1 hover:bg-gray-100 rounded disabled:opacity-30"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="아래로 이동"
          title="아래로 이동"
          className="text-xs px-1 hover:bg-gray-100 rounded disabled:opacity-30"
        >
          ▼
        </button>
      </div>
      <div className="flex-1 flex flex-col gap-0.5">
        <div className="flex gap-0.5 opacity-0 group-hover/para:opacity-100 group-focus-within/para:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onBold}
            title="굵게"
            aria-label="굵게"
            className="px-1 text-xs rounded hover:bg-gray-100"
          >
            <b>B</b>
          </button>
          <button
            type="button"
            onClick={onItalic}
            title="기울임"
            aria-label="기울임"
            className="px-1 text-xs rounded hover:bg-gray-100"
          >
            <i>I</i>
          </button>
          <button
            type="button"
            onClick={onLink}
            title="링크"
            aria-label="링크"
            className="px-1 text-xs rounded hover:bg-gray-100"
          >
            🔗
          </button>
        </div>
        <textarea
          ref={ref}
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          rows={2}
          className="rounded border border-gray-200 px-1 py-0.5 text-sm focus:border-smsg-500 focus:outline-none"
        />
      </div>
      <button
        type="button"
        aria-label="문단 제거"
        onClick={onRemove}
        className="text-xs px-1 hover:bg-gray-100 rounded"
      >
        ×
      </button>
    </div>
  )
}

interface ListRowProps {
  block: ListBlock
  onChange: (next: ListBlock) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  dragProps: React.HTMLAttributes<HTMLDivElement>
}

function ListRowEditor({
  block,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  dragProps,
}: ListRowProps) {
  const updateItem = (i: number, value: string) => {
    const items = block.items.slice()
    items[i] = value
    onChange({ ...block, items })
  }
  const removeItem = (i: number) => {
    const items = block.items.slice()
    items.splice(i, 1)
    onChange({ ...block, items })
  }
  const addItem = () => {
    onChange({ ...block, items: [...block.items, ''] })
  }

  return (
    <div className="flex items-start gap-1 group group/row" {...dragProps}>
      <div className="flex flex-col gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label="위로 이동"
          title="위로 이동"
          className="text-xs px-1 hover:bg-gray-100 rounded disabled:opacity-30"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="아래로 이동"
          title="아래로 이동"
          className="text-xs px-1 hover:bg-gray-100 rounded disabled:opacity-30"
        >
          ▼
        </button>
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-1">
          <select
            value={block.style}
            onChange={(e) =>
              onChange({ ...block, style: e.target.value as ListBlock['style'] })
            }
            className="text-xs rounded border border-gray-200 px-1 py-0.5"
          >
            <option value="bullet">• 불릿</option>
            <option value="number">1. 번호</option>
            <option value="check">☑ 체크</option>
          </select>
        </div>
        {block.items.map((it, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type="text"
              value={it}
              onChange={(e) => updateItem(i, e.target.value)}
              className="flex-1 rounded border border-gray-200 px-1 py-0.5 text-sm focus:border-smsg-500 focus:outline-none"
            />
            <button
              type="button"
              aria-label="항목 제거"
              onClick={() => removeItem(i)}
              className="text-xs px-1 hover:bg-gray-100 rounded"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="text-xs px-1 hover:bg-gray-100 rounded"
        >
          + 항목
        </button>
      </div>
      <button
        type="button"
        aria-label="리스트 제거"
        onClick={onRemove}
        className="text-xs px-1 hover:bg-gray-100 rounded"
      >
        ×
      </button>
    </div>
  )
}

interface ImageRowProps {
  block: ImageBlock
  onRemove: () => void
  onReplace: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  dragProps: React.HTMLAttributes<HTMLDivElement>
}

/**
 * Read-only image row. Users can remove the image, or open the picker modal
 * to swap the underlying imageId (upload a new file or paste a ULID).
 * caption / alt remain display-only here — full caption editing lives in
 * the standalone `ImageBlockEditor` used at article level.
 */
function ImageRowEditor({
  block,
  onRemove,
  onReplace,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  dragProps,
}: ImageRowProps) {
  return (
    <div className="flex items-start gap-1 group group/row" {...dragProps}>
      <div className="flex flex-col gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label="위로 이동"
          title="위로 이동"
          className="text-xs px-1 hover:bg-gray-100 rounded disabled:opacity-30"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="아래로 이동"
          title="아래로 이동"
          className="text-xs px-1 hover:bg-gray-100 rounded disabled:opacity-30"
        >
          ▼
        </button>
      </div>
      <div className="flex-1 space-y-0.5">
        <code className="block text-xs bg-gray-50 px-1 py-0.5 rounded">
          {block.imageId || '(no image)'}
        </code>
        {block.caption && (
          <p className="text-xs text-gray-500">caption: {block.caption}</p>
        )}
        {block.alt && (
          <p className="text-xs text-gray-500">alt: {block.alt}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onReplace}
        className="text-xs px-1 hover:bg-gray-100 rounded"
      >
        교체
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-xs px-1 hover:bg-gray-100 rounded"
      >
        × 이미지 제거
      </button>
    </div>
  )
}

interface PickerModalProps {
  mode: 'append' | 'replace'
  onPick: (imageId: string) => void
  onClose: () => void
}

/**
 * Modal wrapper around `ImageDropzone` for cell-scoped image insertion.
 * Two entry points:
 *   1. Upload (drag-drop or file picker) — auto-picks the uploaded image.
 *   2. Direct imageId input — preserves the legacy prompt() power-user flow
 *      for callers who already know a library ULID.
 *
 * Closes on Escape, backdrop click, successful upload, or imageId submit.
 */
function CellImagePickerModal({ mode, onPick, onClose }: PickerModalProps) {
  const [manualId, setManualId] = useState('')
  const dropzoneRef = useRef<ImageDropzoneHandle>(null)
  const title = mode === 'replace' ? '이미지 교체' : '셀에 이미지 추가'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onSubmitManual = () => {
    const trimmed = manualId.trim()
    if (trimmed === '') return
    onPick(trimmed)
  }

  return (
    <div
      data-cell-image-picker-modal
      role="dialog"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow-lg p-4 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="text-xs px-1 hover:bg-gray-100 rounded"
          >
            ×
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <button
              type="button"
              onClick={() => dropzoneRef.current?.openFilePicker()}
              className="w-full rounded border border-dashed border-gray-300 px-3 py-4 text-sm hover:border-smsg-500 hover:bg-smsg-50"
            >
              파일 선택 / 드래그 앤 드롭
            </button>
            <ImageDropzone
              ref={dropzoneRef}
              mode="replace"
              onImageReady={(rec) => onPick(rec.image_id)}
            />
          </div>
          <div className="border-t border-gray-100 pt-3">
            <label className="block text-xs text-gray-500 mb-1">
              imageId 직접 입력 (라이브러리 ULID)
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="01H..."
                className="flex-1 rounded border border-gray-200 px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={onSubmitManual}
                className="text-xs px-2 py-1 rounded bg-smsg-500 text-white hover:bg-smsg-600"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
