import { useId, useState, type ReactElement, type ReactNode, cloneElement } from 'react'
import { cn } from './cn'

export interface TooltipProps {
  /** Tooltip content. Strings recommended. */
  label: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** The trigger; must accept ref + standard DOM event props. */
  children: ReactElement
}

const SIDE_CLS = {
  top:    'bottom-full left-1/2 -translate-x-1/2 -translate-y-1 mb-1',
  bottom: 'top-full left-1/2 -translate-x-1/2 translate-y-1 mt-1',
  left:   'right-full top-1/2 -translate-y-1/2 -translate-x-1 mr-1',
  right:  'left-full top-1/2 -translate-y-1/2 translate-x-1 ml-1',
} as const

/**
 * Minimal hover/focus tooltip. Hand-rolled rather than pulling in radix —
 * good enough for static labels. Keyboard-accessible via focus-within.
 */
export function Tooltip({ label, side = 'top', children }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      {cloneElement(children, {
        'aria-describedby': open ? id : undefined,
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
      })}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute z-popover whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white shadow-md',
            'animate-slide-up',
            SIDE_CLS[side],
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}
