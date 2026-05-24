import { useEffect, useRef, useState } from 'react'
import type { FigureIndexBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { FigureIndexBlockView } from '@/components/blocks/FigureIndexBlock'
import { ZebraToggle } from './ZebraToggle'

interface Props {
  slug: Slug
  block: FigureIndexBlock
}

/**
 * Tiny inline editor for `figure-index` — the block's `entries` are
 * derived at render time by walking the DOM, so the editor only needs
 * to surface what *is* configurable: title + zebra-striping toggle.
 *
 * `kinds` editing is deliberately out of scope (existing samples just
 * stay on the all-three default and the LLM rules guide that path);
 * adding a checkbox group would be ~50 LOC for low UX win.
 */
export function FigureIndexBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<FigureIndexBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLocal(block)
  }, [block])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const schedule = (next: FigureIndexBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: FigureIndexBlock) => {
    if (!etag) return
    try {
      const patch = {
        type: 'figure-index' as const,
        id: block.id,
        ...(next.title !== undefined ? { title: next.title } : {}),
        ...(next.kinds !== undefined ? { kinds: next.kinds } : {}),
        ...(next.options ? { options: next.options } : {}),
      } as Partial<FigureIndexBlock>
      const result = await patchBlock(slug, block.id, patch, etag, '그림 목차 옵션 변경')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('다른 곳에서 먼저 수정되어 충돌이 발생했습니다.')
      } else {
        setError((err as Error).message)
      }
    }
  }

  return (
    <section
      data-figure-index-block-editor
      data-block-id={block.id}
      className="my-3 space-y-2 rounded border border-gray-200 bg-white p-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={local.title ?? ''}
          onChange={(e) =>
            schedule({ ...local, title: e.target.value || undefined })
          }
          placeholder="그림 목차"
          aria-label="그림 목차 제목"
          className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-gray-800 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
        />
        <ZebraToggle
          blockType="figure-index"
          options={local.options}
          onChange={({ stripe }) =>
            schedule({ ...local, options: { ...local.options, stripe } })
          }
        />
      </div>
      <div className="rounded border border-dashed border-gray-200 p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          미리보기
        </p>
        <FigureIndexBlockView block={local} />
      </div>
      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
