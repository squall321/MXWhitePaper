import { useEffect, useRef, useState } from 'react'
import type { MathBlock, Slug } from '@/types/document'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { MathBlockEditor } from './MathBlockEditor'

interface Props {
  slug: Slug
  block: MathBlock
}

/**
 * Debounced wrapper around MathBlockEditor. Mirrors CodeBlockEditor's pattern —
 * every keystroke updates local state immediately so KaTeX preview stays live,
 * and the PATCH request is coalesced to 500 ms after the last edit.
 */
export function MathBlockEditorWrapper({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const [local, setLocal] = useState<MathBlock>(block)
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

  const persist = async (next: MathBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '수식 편집')
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

  const onChange = (next: MathBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 500)
  }

  return (
    <div className="space-y-1" data-math-block-editor data-block-id={block.id}>
      <MathBlockEditor block={local} onChange={onChange} />
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
