import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { CommandPalette } from './features/search/components/CommandPalette'
import { ToastProvider } from './components/ui/Toast'

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

  const openPalette = useCallback((query?: string) => {
    setPaletteSeed(query ?? '')
    setPaletteOpen(true)
  }, [])

  const setLeftRail = useCallback((node: ReactNode | null | undefined) => {
    setLeftRailState(node)
  }, [])

  // Global ⌘K / Ctrl+K handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey
      if (isMeta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
      <ToastProvider />
    </AppShell>
  )
}
