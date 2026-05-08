import { useState } from 'react'
import type { MathBlock, Slug } from '@/types/document'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { MathBlockEditor } from './MathBlockEditor'

interface Props {
  slug: Slug
  block: MathBlock
}

export function MathBlockEditorWrapper({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<MathBlock>(block)
  const [error, setError] = useState<string | null>(null)

  const onChange = async (next: MathBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '수식 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
      else setError((err as Error).message)
    }
  }
  return (
    <div className="space-y-1">
      <MathBlockEditor block={local} onChange={onChange} />
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
