import { useEffect, type ReactNode } from 'react'
import { useSettingsStore } from '@/features/settings/store'

/**
 * Resolves `themeMode` (light | dark | system) → an actual boolean and
 * applies it to `<html>`:
 *   - sets `data-theme="dark"` (or removes it for light)
 *   - toggles the Tailwind `.dark` class so `dark:` utilities work.
 *
 * Honors `prefers-color-scheme` whenever the user picks "system".
 *
 * Falls back to the legacy `darkMode` boolean if `themeMode` is missing
 * (older persisted state from before this provider landed).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Subscribe to both so we re-render on either change.
  const themeMode = useSettingsStore((s) => s.themeMode)
  const legacyDark = useSettingsStore((s) => s.darkMode)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const mq =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null

    function apply() {
      const mode: 'light' | 'dark' | 'system' = themeMode ?? (legacyDark ? 'dark' : 'system')
      const isDark =
        mode === 'dark' ? true : mode === 'light' ? false : !!mq && mq.matches
      const html = document.documentElement
      if (isDark) {
        html.setAttribute('data-theme', 'dark')
        html.classList.add('dark')
      } else {
        html.removeAttribute('data-theme')
        html.classList.remove('dark')
      }
    }

    apply()

    // Watch system changes only when the user is on "system".
    if (!mq) return
    const onChange = () => apply()
    // `addEventListener` is preferred but Safari < 14 fell back to addListener;
    // this codebase already targets modern evergreen so the simple form is fine.
    mq.addEventListener?.('change', onChange)
    return () => {
      mq.removeEventListener?.('change', onChange)
    }
  }, [themeMode, legacyDark])

  return <>{children}</>
}

/**
 * Pure helper used by tests + the provider — returns the resolved boolean
 * given the current settings + a system-prefers-dark flag.
 */
export function resolveDark(
  themeMode: 'light' | 'dark' | 'system' | undefined,
  legacyDark: boolean,
  systemDark: boolean,
): boolean {
  const mode = themeMode ?? (legacyDark ? 'dark' : 'system')
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemDark
}
