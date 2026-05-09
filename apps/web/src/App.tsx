import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { CommandPalette } from './features/search/components/CommandPalette'
import { QuickSwitcher } from './features/quick-switcher/QuickSwitcher'
import { ToastProvider } from './components/ui/Toast'
import { useNotificationsStore } from './features/notifications/store'
import { InstallPrompt } from './features/pwa/InstallPrompt'

/**
 * Outlet context shape. Pages can call `setRightRail(node)` / `setLeftRail(node)`
 * to push their own sidebar content. `setLeftRail` accepts:
 *   - a `ReactNode`  → render it on desktop instead of the default org tree
 *   - `null`         → hide the left column entirely (e.g. DocumentReader,
 *                      where org tree is reachable via the hamburger drawer)
 *   - `undefined`    → fall back to the default org tree
 *
 * Sprint 6 additions:
 *   - `openPalette(query?)` lets pages / TopBar trigger ⌘K explicitly.
 */
export interface AppOutletContext {
  setRightRail: (node: ReactNode) => void
  setLeftRail: (node: ReactNode | null | undefined) => void
  openPalette: (query?: string) => void
}

/**
 * App is the routed layout shell. Each `<Route>` renders inside the
 * `<Outlet />` slot below and may use `useOutletContext<AppOutletContext>()`
 * to inject sidebar content. Globally hosts the ⌘K command palette.
 */
export function App() {
  const [rightRail, setRightRail] = useState<ReactNode>(null)
  const [leftRail, setLeftRailState] = useState<ReactNode | null | undefined>(undefined)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteSeed, setPaletteSeed] = useState('')
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)

  const openPalette = useCallback((query?: string) => {
    setPaletteSeed(query ?? '')
    setPaletteOpen(true)
  }, [])

  const setLeftRail = useCallback((node: ReactNode | null | undefined) => {
    setLeftRailState(node)
  }, [])

  // Global ⌘K / Ctrl+K handler + ⌘P / Ctrl+P quick switcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey
      if (isMeta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      // Ctrl+P / ⌘P → Quick Switcher. Capture-phase listener (see below)
      // beats the browser's print dialog.
      if (isMeta && (e.key === 'p' || e.key === 'P') && !e.shiftKey) {
        e.preventDefault()
        setQuickSwitcherOpen((v) => !v)
      }
    }
    // Capture phase so we win the race against the browser's native print.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Boot greeting — only fires once per browser, never re-introduces if the
  // user已 cleared the notifications.
  useEffect(() => {
    const KEY = 'mxwp.notifications.welcomed'
    if (typeof window === 'undefined') return
    try {
      if (window.localStorage.getItem(KEY)) return
      window.localStorage.setItem(KEY, '1')
    } catch {
      return
    }
    useNotificationsStore.getState().push({
      category: 'system',
      message: 'MX White Paper 에 오신 것을 환영합니다',
      detail: '⌘K로 어디든 이동할 수 있어요.',
    })
  }, [])

  return (
    <AppShell left={leftRail} right={rightRail} onOpenPalette={openPalette}>
      <Outlet
        context={{ setRightRail, setLeftRail, openPalette } satisfies AppOutletContext}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        initialQuery={paletteSeed}
      />
      <QuickSwitcher
        open={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        onOpenCommandPalette={() => setPaletteOpen(true)}
      />
      <ToastProvider />
      <InstallPrompt />
    </AppShell>
  )
}
