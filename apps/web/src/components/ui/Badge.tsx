import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export type BadgeTone =
  | 'neutral' | 'brand' | 'success' | 'warn' | 'error' | 'info' | 'muted'

const TONE_CLS: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  brand:   'bg-smsg-100 text-smsg-700',
  success: 'bg-emerald-50 text-emerald-700',
  warn:    'bg-amber-50 text-amber-800',
  error:   'bg-red-50 text-red-700',
  info:    'bg-sky-50 text-sky-700',
  muted:   'bg-white text-gray-500 border border-gray-200',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  size?: 'sm' | 'md'
  dot?: boolean
  children: ReactNode
}

/**
 * Inline status/label pill. Visually compact; semantic colour via `tone`.
 */
export function Badge({ tone = 'neutral', size = 'sm', dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium leading-none',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        TONE_CLS[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  )
}
