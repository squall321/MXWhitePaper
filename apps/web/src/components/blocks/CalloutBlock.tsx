import type { CalloutBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'

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
  return (
    <aside
      className={`flex gap-3 rounded-md border-l-4 ${v.border} ${v.bg} p-4 text-[15px] leading-7`}
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
