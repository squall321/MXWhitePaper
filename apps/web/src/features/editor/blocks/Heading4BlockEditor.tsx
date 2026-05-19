import { useEffect, useRef, useState } from 'react'
import type { Heading4Block, Slug } from '@/types/document'
import { InlineTextBlockEditor } from '@/features/editor/components/InlineTextBlockEditor'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'

/**
 * Heading4BlockEditor — pairs the shared InlineTextBlockEditor with a
 * level dropdown (H2 / H3 / H4). Schema supports level ∈ {2, 3, 4} but
 * prior to pass-2 the only way to change visual level was hand-editing
 * the JSON.
 *
 * The text body itself is delegated to InlineTextBlockEditor — this
 * component owns the level picker plus the persistence for level only.
 */
interface Props {
  slug: Slug
  block: Heading4Block
}

type Heading4Level = 2 | 3 | 4

const LEVEL_CLASS: Record<Heading4Level, string> = {
  2: 'text-2xl font-semibold text-smsg-900',
  3: 'text-xl font-semibold text-smsg-900',
  4: 'text-lg font-semibold text-gray-700',
}

export function Heading4BlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  // Legacy fixtures stored level inside meta.level — read both.
  const legacy = (block.meta as { level?: number } | undefined)?.level
  const initialLevel: Heading4Level =
    ((block.level ?? legacy) as Heading4Level | undefined) ?? 4

  const [level, setLevel] = useState<Heading4Level>(initialLevel)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    // Re-sync when an external snapshot lands.
    setLevel(initialLevel)
  }, [initialLevel])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const persistLevel = async (next: Heading4Level) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        { level: next } as Partial<Heading4Block>,
        etag,
        '제목 레벨 변경',
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('충돌 — 새로고침 필요')
      } else {
        setError((err as Error).message)
      }
    }
  }

  const onLevelChange = (next: Heading4Level) => {
    setLevel(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persistLevel(next)
    }, 300)
  }

  const cls = LEVEL_CLASS[level]

  return (
    <div data-heading4-editor data-block-id={block.id} className="group">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <label className="flex items-center gap-1">
          <span>레벨</span>
          <select
            aria-label="제목 레벨"
            data-heading4-level
            value={level}
            onChange={(e) => onLevelChange(Number(e.target.value) as Heading4Level)}
            className="rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px]"
          >
            <option value={2}>H2</option>
            <option value={3}>H3</option>
            <option value={4}>H4 (기본)</option>
          </select>
        </label>
        {error && (
          <span role="status" aria-live="polite" className="text-red-600">
            {error}
          </span>
        )}
      </div>
      <InlineTextBlockEditor
        slug={slug}
        blockId={block.id}
        blockType="heading-4"
        level={level}
        initialText={block.title}
        className={`${cls} min-h-[1.5rem] py-1`}
        placeholder="제목을 입력하세요…"
      />
    </div>
  )
}
