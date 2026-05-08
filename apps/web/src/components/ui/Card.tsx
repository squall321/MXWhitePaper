import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean
  padded?: boolean | 'sm' | 'md' | 'lg'
  as?: 'div' | 'article' | 'section' | 'li'
  children: ReactNode
}

const PAD_CLS = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const

/**
 * Padded white panel. `hover` adds a subtle lift on hover.
 *
 * Note: when used as `<a>`-wrapped, prefer `hover` for the affordance.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { hover, padded = 'md', as = 'div', className, children, ...rest },
  ref,
) {
  const Tag = as as 'div'
  const padKey = padded === true ? 'md' : padded || undefined
  return (
    <Tag
      ref={ref}
      className={cn(
        'rounded-lg border border-gray-200 bg-white shadow-sm',
        'transition-all duration-base ease-out-soft',
        hover && 'hover:-translate-y-0.5 hover:border-smsg-300 hover:shadow-md',
        padKey && PAD_CLS[padKey],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
})
