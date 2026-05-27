import { create } from 'zustand'
import { useEffect, type ReactNode } from 'react'
import { cn } from './cn'

export type ToastTone = 'info' | 'success' | 'warn' | 'error'

interface ToastItem {
  id: string
  message: ReactNode
  tone: ToastTone
  duration: number
}

interface ToastStore {
  items: ToastItem[]
  push: (m: ReactNode, tone?: ToastTone, duration?: number) => string
  dismiss: (id: string) => void
}

const store = create<ToastStore>((set, get) => ({
  items: [],
  push: (message, tone = 'info', duration = 3500) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((s) => ({ items: [...s.items, { id, message, tone, duration }] }))
    if (duration > 0) {
      window.setTimeout(() => get().dismiss(id), duration)
    }
    return id
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}))

/**
 * Imperative API. Use anywhere in the app:
 *   toast.success('저장됨')
 *   toast.error('네트워크 오류')
 */
export const toast = {
  info:    (m: ReactNode, d?: number) => store.getState().push(m, 'info', d),
  success: (m: ReactNode, d?: number) => store.getState().push(m, 'success', d),
  warn:    (m: ReactNode, d?: number) => store.getState().push(m, 'warn', d),
  error:   (m: ReactNode, d?: number) => store.getState().push(m, 'error', d),
}

const TONE_CLS: Record<ToastTone, string> = {
  info:    'border-smsg-100 bg-smsg-50 text-smsg-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warn:    'border-amber-200 bg-amber-50 text-amber-900',
  error:   'border-red-200 bg-red-50 text-red-900',
}

const TONE_DOT: Record<ToastTone, string> = {
  info:    'bg-smsg-500',
  success: 'bg-emerald-500',
  warn:    'bg-amber-500',
  error:   'bg-red-500',
}

/**
 * Mount once near the top of the app. Renders all live toasts in a fixed
 * bottom-right stack (top-right on mobile too — adjusts via responsive
 * inset utilities).
 */
export function ToastProvider() {
  const items = store((s) => s.items)
  const dismiss = store((s) => s.dismiss)
  // No-op effect for prefers-reduced-motion is handled globally in tokens.css.
  useEffect(() => undefined, [])

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      // safe-area: lift toasts above the iPhone home indicator (≈34px) and
      // keep them clear of the right-edge inset in landscape.
      style={{
        bottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
        right: 'max(1rem, env(safe-area-inset-right, 0px))',
      }}
      className="pointer-events-none fixed z-toast flex w-full max-w-xs flex-col gap-2 sm:max-w-sm"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md backdrop-blur-sm anim-slideUp',
            TONE_CLS[t.tone],
          )}
        >
          <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONE_DOT[t.tone])} />
          <div className="flex-1">{t.message}</div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="알림 닫기"
            className="-mr-1 rounded p-0.5 opacity-60 hover:bg-black/5 hover:opacity-100"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}

/** React-hook variant for accessing the same store. */
export function useToast() {
  return toast
}
