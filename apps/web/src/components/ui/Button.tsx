import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
  fullWidth?: boolean
}

const VARIANT_CLS: Record<ButtonVariant, string> = {
  primary:
    'bg-smsg-700 text-white hover:bg-smsg-900 active:bg-smsg-900 disabled:bg-smsg-700/60',
  secondary:
    'bg-smsg-100 text-smsg-900 hover:bg-smsg-50 disabled:bg-smsg-100/60 dark:bg-smsg-700 dark:text-white',
  ghost:
    'bg-transparent text-smsg-900 hover:bg-smsg-100 disabled:text-gray-400',
  danger:
    'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/60',
  outline:
    'border border-gray-300 bg-white text-gray-800 hover:border-smsg-500 hover:text-smsg-900 disabled:opacity-50',
}

const SIZE_CLS: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
  lg: 'h-11 px-5 text-base gap-2 rounded-lg',
}

const BASE =
  'inline-flex items-center justify-center font-medium select-none whitespace-nowrap ' +
  'transition-all duration-base ease-out-soft ' +
  'hover:-translate-y-px hover:shadow-md active:translate-y-0 active:shadow-sm ' +
  'disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none ' +
  'focus-visible:outline-none focus-visible:shadow-focus'

/**
 * Reusable button. Variants follow the polish brief: primary | secondary |
 * ghost | danger | outline; sizes sm | md | lg. `loading` shows a spinner and
 * disables interaction. Icons can be passed for left/right adornments.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, iconLeft, iconRight, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANT_CLS[variant],
        SIZE_CLS[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="mr-1" />}
      {!loading && iconLeft && <span aria-hidden="true" className="-ml-0.5">{iconLeft}</span>}
      {children}
      {!loading && iconRight && <span aria-hidden="true" className="-mr-0.5">{iconRight}</span>}
    </button>
  )
})

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('h-3.5 w-3.5 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
