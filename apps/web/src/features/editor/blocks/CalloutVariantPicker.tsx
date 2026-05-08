import { useState } from 'react'
import type { CalloutBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'

interface Props {
  slug: Slug
  block: CalloutBlock
}

const VARIANTS: {
  value: CalloutBlock['variant']
  label: string
  swatch: string
}[] = [
  { value: 'info', label: '정보', swatch: 'bg-smsg-100 text-smsg-700' },
  { value: 'warn', label: '경고', swatch: 'bg-amber-100 text-amber-800' },
  { value: 'danger', label: '위험', swatch: 'bg-red-100 text-red-700' },
  { value: 'tip', label: '팁', swatch: 'bg-emerald-100 text-emerald-700' },
]

/**
 * CalloutVariantPicker — chip row above the inline text editor that lets the
 * user switch the callout tone. Uses `patchBlock` directly so the inline
 * text editor (which owns text-level edits) is unaffected.
 */
export function CalloutVariantPicker({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const [error, setError] = useState<string | null>(null)

  const onPick = async (variant: NonNullable<CalloutBlock['variant']>) => {
    if (!etag || variant === block.variant) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        { variant },
        etag,
        '콜아웃 색상',
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

  return (
    <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px]">
      {VARIANTS.map((v) => {
        const active = (block.variant ?? 'info') === v.value
        return (
          <button
            key={v.value}
            type="button"
            aria-label={`${v.label} 콜아웃`}
            aria-pressed={active}
            onClick={() => void onPick(v.value)}
            className={
              'rounded-full px-2 py-0.5 transition-colors ' +
              v.swatch +
              (active ? ' ring-2 ring-offset-1 ring-current' : ' opacity-60 hover:opacity-100')
            }
          >
            {v.label}
          </button>
        )
      })}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  )
}
