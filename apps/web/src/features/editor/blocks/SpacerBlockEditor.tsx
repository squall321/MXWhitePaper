import { useEffect, useRef, useState } from 'react'
import type { SpacerBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  block: SpacerBlock
}

type SpacerSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_PX: Record<SpacerSize, number> = {
  sm: 16,
  md: 32,
  lg: 64,
  xl: 128,
}

const SIZE_CLASS: Record<SpacerSize, string> = {
  sm: 'h-4',
  md: 'h-8',
  lg: 'h-16',
  xl: 'h-32',
}

/**
 * SpacerBlockEditor — size dropdown + live px preview.
 *
 * Schema (document.json #/$defs/SpacerBlock) enums size to `sm | md | lg | xl`
 * (16 / 32 / 64 / 128 px) — pass-3 N1 expansion.
 */
export function SpacerBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<SpacerBlock>(block)
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

  const persist = async (next: SpacerBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        { size: next.size } as Partial<SpacerBlock>,
        etag,
        t('editor.spacer.changeLog'),
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

  const onSizeChange = (size: SpacerSize) => {
    const next: SpacerBlock = { ...local, size }
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 300)
  }

  const size: SpacerSize = (local.size as SpacerSize | undefined) ?? 'md'
  const px = SIZE_PX[size]
  const heightCls = SIZE_CLASS[size]

  return (
    <div
      data-spacer-block-editor
      data-block-id={block.id}
      className="my-2 rounded border border-dashed border-gray-300 bg-gray-50/60 p-2 text-xs"
    >
      <div className="mb-1 flex items-center gap-2">
        <label className="flex items-center gap-1 text-gray-600">
          <span>{t('editor.spacer.label')}</span>
          <select
            aria-label={t('editor.spacer.ariaSize')}
            value={size}
            onChange={(e) => onSizeChange(e.target.value as SpacerSize)}
            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px]"
          >
            <option value="sm">sm (16px)</option>
            <option value="md">md (32px)</option>
            <option value="lg">lg (64px)</option>
            <option value="xl">xl (128px)</option>
          </select>
        </label>
        <span className="text-gray-500" data-spacer-px>
          현재: {px}px
        </span>
        {error && (
          <span role="status" aria-live="polite" className="text-red-600">
            {error}
          </span>
        )}
      </div>
      <div
        aria-hidden="true"
        data-spacer-preview
        className={`${heightCls} rounded bg-gradient-to-b from-gray-100 to-gray-200`}
      />
    </div>
  )
}
