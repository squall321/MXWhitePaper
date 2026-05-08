import { useEffect, type ReactNode } from 'react'
import { cn } from './cn'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right' | 'bottom'
  width?: string
  className?: string
  ariaLabel: string
  children: ReactNode
}

/**
 * Slide-in side panel. Used as the mobile equivalent of the AppShell's
 * left tree and right TOC rails.
 *
 * - Click backdrop or press Esc to close.
 * - Sets `body.overflow=hidden` while open.
 * - `prefers-reduced-motion` is respected via global tokens.css rule.
 */
export function Drawer({ open, onClose, side = 'left', width = '85vw', className, ariaLabel, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const panelPos =
    side === 'left' ? 'left-0 top-0 h-full anim-slideL' :
    side === 'right' ? 'right-0 top-0 h-full anim-slideR' :
    'bottom-0 left-0 right-0 anim-slideUp max-h-[85vh]'

  const panelSize = side === 'bottom' ? { width: '100%' } : { width, maxWidth: '420px' }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-drawer bg-black/40 anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          'absolute bg-white shadow-lg overflow-y-auto outline-none',
          panelPos,
          className,
        )}
        style={panelSize}
      >
        {children}
      </div>
    </div>
  )
}
