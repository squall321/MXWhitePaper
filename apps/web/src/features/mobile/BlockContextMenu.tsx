import { useEffect, useRef } from 'react'

export interface BlockContextMenuAction {
  /** Button label, displayed as-is. */
  label: string
  /** Action key consumed by the host to dispatch the matching bulk-action. */
  key:
    | 'duplicate'
    | 'delete'
    | 'move-up'
    | 'move-down'
    | 'move-section'
    | 'info'
  /** Optional disabled flag (e.g. block is already at top → move-up off). */
  disabled?: boolean
}

export const DEFAULT_ACTIONS: BlockContextMenuAction[] = [
  { label: '복제', key: 'duplicate' },
  { label: '삭제', key: 'delete' },
  { label: '위로', key: 'move-up' },
  { label: '아래로', key: 'move-down' },
  { label: '다른 섹션으로 이동', key: 'move-section' },
  { label: '블록 정보', key: 'info' },
]

export interface BlockContextMenuProps {
  /** Whether the menu is visible. Parent owns this state. */
  open: boolean
  /** Pixel coordinates of the original long-press, in viewport units. */
  point: { x: number; y: number }
  /** Block ID the menu was opened for — passed back to `onAction`. */
  blockId: string
  /** Optional custom action list — defaults to DEFAULT_ACTIONS. */
  actions?: BlockContextMenuAction[]
  onClose: () => void
  onAction: (key: BlockContextMenuAction['key'], blockId: string) => void
}

const MENU_WIDTH = 200
const MENU_HEIGHT_GUESS = 280

/**
 * Compute the popover anchor so the menu stays inside the viewport. Pure for
 * testability — host pages just render whatever this returns into `style`.
 */
export function clampMenuPosition(
  point: { x: number; y: number },
  viewport: { w: number; h: number },
  size: { w: number; h: number } = { w: MENU_WIDTH, h: MENU_HEIGHT_GUESS },
): { left: number; top: number } {
  const left = Math.max(8, Math.min(point.x, viewport.w - size.w - 8))
  const top = Math.max(8, Math.min(point.y, viewport.h - size.h - 8))
  return { left, top }
}

/**
 * Mobile-only block context menu. Rendered as a fixed-position popover at the
 * touch coordinates after a long-press.
 *
 * Accessibility: closes on Escape and on outside-click; the first button
 * receives focus when opened so keyboard / switch-control users can drive it
 * too.
 */
export function BlockContextMenu({
  open,
  point,
  blockId,
  actions = DEFAULT_ACTIONS,
  onClose,
  onAction,
}: BlockContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined') return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDocPointer = (e: PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      if (e.target instanceof Node && root.contains(e.target)) return
      onClose()
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDocPointer, true)
    // Move focus into the menu so it's announced + dismissable via keyboard.
    rootRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDocPointer, true)
    }
  }, [open, onClose])

  if (!open) return null

  // SSR-safe viewport — fall back to fixed values when window is undefined.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 360
  const vh = typeof window !== 'undefined' ? window.innerHeight : 640
  const { left, top } = clampMenuPosition(point, { w: vw, h: vh })

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="블록 작업"
      data-testid="block-context-menu"
      data-block-id={blockId}
      className="fixed z-50 w-[200px] overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
      style={{ left, top }}
    >
      <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
        {actions.map((a) => (
          <li key={a.key}>
            <button
              type="button"
              role="menuitem"
              data-action={a.key}
              disabled={a.disabled}
              onClick={() => {
                onAction(a.key, blockId)
                onClose()
              }}
              className="block w-full px-4 py-3 text-left text-smsg-900 transition-colors hover:bg-smsg-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              {a.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
