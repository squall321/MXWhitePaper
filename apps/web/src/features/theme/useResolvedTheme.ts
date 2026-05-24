import { useEffect, useState } from 'react'

export type ResolvedTheme = 'light' | 'dark'

/**
 * Read the current resolved theme from the document root. Mirrors what
 * ThemeProvider writes:
 *   - Tailwind `.dark` class on <html>, OR
 *   - `data-theme="dark"` attribute on <html>
 *
 * SSR-safe — returns 'light' when document is unavailable.
 * Exported separately from the hook so it can be unit-tested without
 * any React render context (project test infra avoids jsdom).
 */
export function readResolvedTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light'
  const html = document.documentElement
  if (html.classList.contains('dark')) return 'dark'
  if (html.getAttribute('data-theme') === 'dark') return 'dark'
  return 'light'
}

/**
 * React hook that returns the resolved theme ('light' | 'dark') and
 * re-renders whenever ThemeProvider toggles it. Used by chart widgets
 * (ECharts, recharts) that need to inject theme-aware colours at render
 * time since CSS variables don't reach into their internal raster.
 *
 * Watches `class` and `data-theme` attribute mutations on
 * `documentElement` via a single MutationObserver — cheap.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() => readResolvedTheme())

  useEffect(() => {
    if (typeof document === 'undefined') return
    setTheme(readResolvedTheme())
    const obs = new MutationObserver(() => setTheme(readResolvedTheme()))
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    return () => obs.disconnect()
  }, [])

  return theme
}
