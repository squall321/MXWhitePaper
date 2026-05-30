import { useState } from 'react'
import type { CalloutBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { nextCalloutVariant } from '@/features/editor/calloutVariant'
import { useT } from '@/lib/i18n'

interface VariantSpec {
  border: string
  bg: string
  iconBg: string
  iconColor: string
  labelKey: 'editor.callout.info' | 'editor.callout.warn' | 'editor.callout.danger' | 'editor.callout.tip'
  labelText: string
  icon: 'info' | 'warn' | 'danger' | 'tip'
}

const VARIANT_STYLES: Record<CalloutBlock['variant'], VariantSpec> = {
  info: {
    border: 'border-smsg-500 dark:border-smsg-400',
    bg: 'bg-smsg-50 dark:bg-smsg-950/30',
    iconBg: 'bg-smsg-100 dark:bg-smsg-900/50',
    iconColor: 'text-smsg-700 dark:text-smsg-200',
    labelKey: 'editor.callout.info',
    labelText: 'text-smsg-700 dark:text-smsg-200',
    icon: 'info',
  },
  warn: {
    border: 'border-amber-400 dark:border-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    iconBg: 'bg-amber-100 dark:bg-amber-900/50',
    iconColor: 'text-amber-700 dark:text-amber-200',
    labelKey: 'editor.callout.warn',
    labelText: 'text-amber-700 dark:text-amber-200',
    icon: 'warn',
  },
  danger: {
    border: 'border-red-400 dark:border-red-500',
    bg: 'bg-red-50 dark:bg-red-950/30',
    iconBg: 'bg-red-100 dark:bg-red-900/50',
    iconColor: 'text-red-700 dark:text-red-200',
    labelKey: 'editor.callout.danger',
    labelText: 'text-red-700 dark:text-red-200',
    icon: 'danger',
  },
  tip: {
    border: 'border-emerald-400 dark:border-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/50',
    iconColor: 'text-emerald-700 dark:text-emerald-200',
    labelKey: 'editor.callout.tip',
    labelText: 'text-emerald-700 dark:text-emerald-200',
    icon: 'tip',
  },
}

export function CalloutBlockView({ block }: { block: CalloutBlock }) {
  const t = useT()
  const v = VARIANT_STYLES[block.variant]
  const variantLabel = t(v.labelKey)
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
        t('editor.callout.changeLog'),
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
          {block.title ?? variantLabel}
        </p>
        <p className="mt-1 text-smsg-900 dark:text-gray-100">
          <Inline text={block.text} />
        </p>
      </div>
      {isFullEditing && slug && (
        <button
          type="button"
          aria-label={t('editor.callout.cycleAria', { label: t(VARIANT_STYLES[block.variant].labelKey) })}
          data-callout-variant-chip
          data-variant={block.variant}
          onClick={() => void onCycle()}
          disabled={busy}
          className="absolute right-2 top-2 rounded-full border border-gray-300 bg-white/95 px-2 py-0.5 text-[11px] font-medium text-gray-700 opacity-0 shadow-sm transition-opacity hover:bg-gray-50 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800/95 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {variantLabel} ↻
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
