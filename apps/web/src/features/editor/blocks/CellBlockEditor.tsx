import { useCallback } from 'react'
import type {
  CellBlock,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
} from '@/types/document'
import { ulid } from '@/features/editor/ulid'

interface Props {
  blocks: readonly CellBlock[]
  onChange: (next: CellBlock[]) => void
}

/**
 * Inline edits the rich content of a sparse cell (text OR blocks). Renders
 * each block as a small editable row; "+" buttons append a fresh paragraph
 * / list / image. Image rows are read-only (imageId display + remove) since
 * the table-cell image picker is a deferred follow-up.
 *
 * Reordering (up/down arrows) is intentionally out of scope — rows render
 * in array order only.
 */
export function CellBlockEditor({ blocks, onChange }: Props): JSX.Element {
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
      // image — deferred picker: prompt for imageId directly. Cancel ⇒ noop.
      // SSR guard: window.prompt is undefined under server-side rendering.
      if (typeof window === 'undefined') return
      const imageId = window.prompt('imageId 입력')
      if (imageId == null) return
      const trimmed = imageId.trim()
      if (trimmed === '') return
      const img: ImageBlock = {
        type: 'image',
        id: ulid(),
        imageId: trimmed,
      }
      out.push(img)
      onChange(out)
    },
    [blocks, onChange],
  )

  return (
    <div className="cell-block-editor space-y-1 text-sm">
      {blocks.length === 0 && (
        <p className="text-xs text-gray-400">셀이 비어있습니다</p>
      )}
      {blocks.map((b, idx) => {
        if (b.type === 'paragraph') {
          return (
            <ParagraphRowEditor
              key={b.id}
              block={b}
              onChange={(next) => updateAt(idx, next)}
              onRemove={() => remove(idx)}
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
            />
          )
        }
        if (b.type === 'image') {
          return (
            <ImageRowEditor
              key={b.id}
              block={b}
              onRemove={() => remove(idx)}
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
          + 🖼 image (id 직접 입력)
        </button>
      </div>
    </div>
  )
}

interface ParagraphRowProps {
  block: ParagraphBlock
  onChange: (next: ParagraphBlock) => void
  onRemove: () => void
}

function ParagraphRowEditor({ block, onChange, onRemove }: ParagraphRowProps) {
  return (
    <div className="flex items-start gap-1 group">
      <textarea
        value={block.text}
        onChange={(e) => onChange({ ...block, text: e.target.value })}
        rows={2}
        className="flex-1 rounded border border-gray-200 px-1 py-0.5 text-sm focus:border-smsg-500 focus:outline-none"
      />
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
}

function ListRowEditor({ block, onChange, onRemove }: ListRowProps) {
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
    <div className="flex items-start gap-1 group">
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
}

/**
 * Read-only image row. Full table-cell image picker (replace / upload /
 * crop) is a deferred follow-up; users append by typing imageId, then can
 * only remove. caption / alt are also display-only here.
 */
function ImageRowEditor({ block, onRemove }: ImageRowProps) {
  return (
    <div className="flex items-start gap-1 group">
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
        onClick={onRemove}
        className="text-xs px-1 hover:bg-gray-100 rounded"
      >
        × 이미지 제거
      </button>
    </div>
  )
}
