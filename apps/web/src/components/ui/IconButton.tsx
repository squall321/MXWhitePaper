import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export type IconButtonSize = 'sm' | 'md' | 'lg'
export type IconButtonVariant = 'ghost' | 'solid' | 'outline'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: visually hidden label for screen readers. */
  'aria-label': string
  size?: IconButtonSize
  variant?: IconButtonVariant
  children: ReactNode
}

const SIZE_CLS: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8 text-sm rounded-md',
  md: 'h-9 w-9 text-base rounded-md',
  lg: 'h-10 w-10 text-lg rounded-lg',
}

const VARIANT_CLS: Record<IconButtonVariant, string> = {
  ghost: 'bg-transparent text-current hover:bg-smsg-100',
  solid: 'bg-smsg-700 text-white hover:bg-smsg-900',
  outline: 'border border-gray-300 bg-white text-gray-800 hover:border-smsg-500',
}

/**
 * Square icon-only button. Always requires an `aria-label`. Children should be
 * decorative SVG/icons (the parent is what gets the accessible name).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'ghost', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-grid place-items-center transition-all duration-base ease-out-soft',
        'hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus',
        'disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none',
        SIZE_CLS[size],
        VARIANT_CLS[variant],
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="grid place-items-center">{children}</span>
    </button>
  )
})
