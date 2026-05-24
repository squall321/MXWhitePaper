import { useState } from 'react'
import type { CalloutBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import {
  CALLOUT_LABEL,
  nextCalloutVariant,
} from '@/features/editor/calloutVariant'

interface VariantSpec {
  border: string
  bg: string
  iconBg: string
  iconColor: string
  label: string
  labelText: string
  icon: 'info' | 'warn' | 'danger' | 'tip'
}

const VARIANT_STYLES: Record<CalloutBlock['variant'], VariantSpec> = {
  info: {
    border: 'border-smsg-500',
    bg: 'bg-smsg-50',
    iconBg: 'bg-smsg-100',
    iconColor: 'text-smsg-700',
    label: '정보',
    labelText: 'text-smsg-700',
    icon: 'info',
  },
  warn: {
    border: 'border-amber-400',
    bg: 'bg-amber-50',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    label: '주의',
    labelText: 'text-amber-700',
    icon: 'warn',
  },
  danger: {
    border: 'border-red-400',
    bg: 'bg-red-50',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-700',
    label: '경고',
    labelText: 'text-red-700',
    icon: 'danger',
  },
  tip: {
    border: 'border-emerald-400',
    bg: 'bg-emerald-50',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-700',
    label: '팁',
    labelText: 'text-emerald-700',
    icon: 'tip',
  },
}

export function CalloutBlockView({ block }: { block: CalloutBlock }) {
  const v = VARIANT_STYLES[block.variant]
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  const slug = useEditorStore((s) => s.slug)
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const [busy, setBusy] = useState(false)

  const onCycle = async () => {
    if (busy || !slug || !etag) return
    setBusy(true)
    try {
      const next = nextCalloutVariant(block.variant)
      const result = await patchBlock(
        slug,
        block.id,
        { variant: next },
        etag,
        '콜아웃 변형 변경',
      )
      apply(result.document, result.etag)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      className={`group relative flex gap-3 rounded-md border-l-4 ${v.border} ${v.bg} p-4 text-[15px] leading-7`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${v.iconBg} ${v.iconColor}`}
      >
        <CalloutIcon kind={v.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold uppercase tracking-wide ${v.labelText}`}>
          {block.title ?? v.label}
        </p>
        <p className="mt-1 text-smsg-900">
          <Inline text={block.text} />
        </p>
      </div>
      {isFullEditing && slug && (
        <button
          type="button"
          aria-label={`콜아웃 변형 변경 (현재: ${CALLOUT_LABEL[block.variant]})`}
          data-callout-variant-chip
          data-variant={block.variant}
          onClick={() => void onCycle()}
          disabled={busy}
          className="absolute right-2 top-2 rounded-full border border-gray-300 bg-white/95 px-2 py-0.5 text-[11px] font-medium text-gray-700 opacity-0 shadow-sm transition-opacity hover:bg-gray-50 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800/95 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {CALLOUT_LABEL[block.variant]} ↻
        </button>
      )}
    </aside>
  )
}

function CalloutIcon({ kind }: { kind: 'info' | 'warn' | 'danger' | 'tip' }) {
  if (kind === 'info' || kind === 'tip') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="5" r="0.9" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'warn') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5L15 14H1L8 1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.9" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8.5l2 2 4-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
