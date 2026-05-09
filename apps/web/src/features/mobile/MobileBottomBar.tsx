import { useEffect, useRef, useState } from 'react'

/**
 * MobileBottomBar — fixed action strip that lives at the bottom of the
 * viewport on mobile (<768px). Auto-hides on downward scroll and reappears on
 * upward scroll, freeing screen real-estate while reading.
 *
 * Hide/show decision is delegated to the pure helper `nextVisibility` so it's
 * unit-testable without jsdom.
 */

export interface MobileBottomBarAction {
  key: 'search' | 'comments' | 'share' | 'menu'
  label: string
  onClick: () => void
}

export interface MobileBottomBarProps {
  actions?: MobileBottomBarAction[]
  /** Optional className override for the host (e.g. AppShell adds safe-area paddings). */
  className?: string
}

/** Px the user must scroll in one direction to flip the bar's visibility. */
export const SCROLL_DELTA_THRESHOLD = 12
/** Always show the bar near the page top (avoid flickering at scroll=0). */
export const TOP_PIN_PX = 24

export interface ScrollVisibilityInput {
  /** Current `window.scrollY` (or whatever scroll source the host uses). */
  current: number
  /** Last sampled scroll position. */
  previous: number
  /** Currently-rendered visibility. */
  visible: boolean
}

/**
 * Pure visibility decision for the bottom bar. Ignores tiny jitter (< delta
 * threshold) to avoid flicker during finger-tracking momentum scrolls.
 */
export function nextVisibility(input: ScrollVisibilityInput): boolean {
  const { current, previous, visible } = input
  if (current <= TOP_PIN_PX) return true
  const delta = current - previous
  if (Math.abs(delta) < SCROLL_DELTA_THRESHOLD) return visible
  // Scrolling down → hide. Scrolling up → show.
  return delta < 0
}

const DEFAULT_ACTIONS: MobileBottomBarAction[] = [
  { key: 'search', label: '검색', onClick: () => {} },
  { key: 'comments', label: '댓글', onClick: () => {} },
  { key: 'share', label: '공유', onClick: () => {} },
  { key: 'menu', label: '메뉴', onClick: () => {} },
]

export function MobileBottomBar({ actions, className }: MobileBottomBarProps) {
  const list = actions ?? DEFAULT_ACTIONS
  const [visible, setVisible] = useState(true)
  const lastScrollRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    lastScrollRef.current = window.scrollY
    const onScroll = () => {
      const cur = window.scrollY
      setVisible((prev) =>
        nextVisibility({ current: cur, previous: lastScrollRef.current, visible: prev }),
      )
      lastScrollRef.current = cur
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      data-testid="mobile-bottom-bar"
      data-visible={visible}
      aria-label="모바일 빠른 작업"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      className={[
        'fixed inset-x-0 bottom-0 z-drawer flex border-t border-gray-200 bg-white shadow-lg transition-transform duration-base ease-out-soft md:hidden dark:border-gray-800 dark:bg-gray-900',
        visible ? 'translate-y-0' : 'translate-y-full',
        className ?? '',
      ].join(' ')}
    >
      {list.map((a) => (
        <button
          key={a.key}
          type="button"
          data-action={a.key}
          onClick={a.onClick}
          className="flex-1 px-2 py-3 text-center text-xs font-medium text-smsg-900 transition-colors hover:bg-smsg-50 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          {a.label}
        </button>
      ))}
    </nav>
  )
}
