import type { ReactNode } from 'react'
import { Button } from './Button'
import { cn } from './cn'

export interface ErrorStateProps {
  title?: ReactNode
  description?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/**
 * Standardised error block. If `onRetry` is provided, renders a primary
 * "다시 시도" button.
 */
export function ErrorState({ title = '문제가 발생했습니다', description, onRetry, retryLabel = '다시 시도', className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center',
        className,
      )}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="20" r="18" stroke="#DC2626" strokeWidth="2" />
        <path d="M20 12v10" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="20" cy="27" r="1.6" fill="#DC2626" />
      </svg>
      <h3 className="mt-3 text-base font-semibold text-red-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-red-800">{description}</p>}
      {onRetry && (
        <div className="mt-4">
          <Button variant="danger" size="sm" onClick={onRetry}>{retryLabel}</Button>
        </div>
      )}
    </div>
  )
}
