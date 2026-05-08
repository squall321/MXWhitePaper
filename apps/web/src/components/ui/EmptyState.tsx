import type { ReactNode } from 'react'
import { cn } from './cn'

export interface EmptyStateProps {
  /** Inline SVG illustration. Components ship a default if omitted. */
  illustration?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

/**
 * Friendly empty state. Centered card with an illustration, title, body and
 * optional action button. Uses the brand inline SVG below as a fallback.
 */
export function EmptyState({ illustration, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center',
        className,
      )}
    >
      <div className="mb-4 text-smsg-300" aria-hidden="true">
        {illustration ?? <DefaultIllustration />}
      </div>
      <h3 className="text-base font-semibold text-smsg-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-600">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function DefaultIllustration() {
  return (
    <svg width="96" height="64" viewBox="0 0 96 64" fill="none">
      <rect x="6" y="14" width="60" height="44" rx="6" fill="#E8EEFF" />
      <rect x="14" y="22" width="44" height="6" rx="3" fill="#5C7CFF" opacity="0.6" />
      <rect x="14" y="32" width="34" height="4" rx="2" fill="#5C7CFF" opacity="0.4" />
      <rect x="14" y="40" width="38" height="4" rx="2" fill="#5C7CFF" opacity="0.4" />
      <circle cx="78" cy="22" r="14" fill="#1428A0" />
      <path d="M73 22l4 4 7-7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
