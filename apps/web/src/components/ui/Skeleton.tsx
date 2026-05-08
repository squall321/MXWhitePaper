import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * Plain shimmering rectangle used as a loading placeholder. Width/height come
 * from utility classes; `circle` for avatars.
 */
export function Skeleton({ className, circle, ...rest }: HTMLAttributes<HTMLDivElement> & { circle?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-gray-100',
        circle ? 'rounded-full' : 'rounded-md',
        className,
      )}
      {...rest}
    />
  )
}
