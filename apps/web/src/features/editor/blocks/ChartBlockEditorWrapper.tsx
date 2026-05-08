import { useState } from 'react'
import type { ChartBlock, Slug } from '@/types/document'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { ChartBlockEditor } from './ChartBlockEditor'

interface Props {
  slug: Slug
  block: ChartBlock
}

/**
 * Bridges the pure ChartBlockEditor (which is just a controlled editor)
 * to the network: every change is debounced and pushed via patchBlock.
 */
export function ChartBlockEditorWrapper({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [error, setError] = useState<string | null>(null)
  const [local, setLocal] = useState<ChartBlock>(block)

  const onChange = async (next: ChartBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '차트 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
      else setError((err as Error).message)
    }
  }

  return (
    <div className="space-y-1">
      <ChartBlockEditor block={local} onChange={onChange} />
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
