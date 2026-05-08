import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from './cn'

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** Accessible label. */
  title?: ReactNode
  /** Hide the visual title (use `title` only for the accessible name). */
  titleHidden?: boolean
  /** Mute the close-on-backdrop click. */
  staticBackdrop?: boolean
  /** sm | md | lg | xl | full. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  className?: string
  children: ReactNode
  footer?: ReactNode
}

const SIZE_CLS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[min(1400px,96vw)]',
} as const

/**
 * Generic modal. Backdrop click closes, Esc closes, focus is moved to the
 * first focusable child on mount and restored on close. Hand-rolled minimal
 * focus trap — no extra dependency.
 */
export function Modal({ open, onClose, title, titleHidden, staticBackdrop, size = 'md', className, children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    lastFocusRef.current = document.activeElement
    const r = requestAnimationFrame(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ;(firstFocusable ?? dialogRef.current)?.focus()
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab' && dialogRef.current) {
        trapTab(e, dialogRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(r)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      const last = lastFocusRef.current
      if (last instanceof HTMLElement) last.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 px-4 py-6 anim-fade"
      onMouseDown={(e) => {
        if (!staticBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-lg outline-none',
          'animate-slide-up',
          SIZE_CLS[size],
          className,
        )}
      >
        {title && !titleHidden && (
          <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
            <h2 className="text-base font-semibold text-smsg-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:shadow-focus"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>
        )}
        <div className="flex-1 overflow-auto">{children}</div>
        {footer && (
          <footer className="border-t border-gray-200 bg-gray-50/80 px-5 py-3">{footer}</footer>
        )}
      </div>
    </div>
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function trapTab(e: KeyboardEvent, container: HTMLElement) {
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled'),
  )
  if (focusables.length === 0) {
    e.preventDefault()
    container.focus()
    return
  }
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}
