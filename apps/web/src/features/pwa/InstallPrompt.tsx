import { useEffect, useState } from 'react'

/**
 * Chrome's BeforeInstallPromptEvent — not yet in lib.dom.d.ts.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

/**
 * Pure helper for the click handler. Exported so tests can drive it
 * without a DOM. Calls `event.prompt()` and waits on `event.userChoice`,
 * then invokes `onSettled` so the host component can drop its stashed
 * event reference.
 */
export async function triggerInstallPrompt(
  event: BeforeInstallPromptEvent,
  onSettled: () => void,
): Promise<'accepted' | 'dismissed' | 'errored'> {
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice.outcome
  } catch {
    return 'errored'
  } finally {
    onSettled()
  }
}

/**
 * Decide whether the pill should be visible based on the standalone media
 * query result and whether we have a stashed prompt event. Pulled out so
 * we can test it without rendering.
 */
export function shouldShowInstallPill(
  isStandalone: boolean,
  hasEvent: boolean,
): boolean {
  if (isStandalone) return false
  return hasEvent
}

/**
 * Bottom-right "📱 앱으로 설치" pill. Listens for `beforeinstallprompt`,
 * stashes the event so we can call it on user click, and self-hides once
 * the app is running standalone (i.e. already installed).
 *
 * SSR-safe: returns null until the first effect runs, so React DOM
 * server doesn't see browser-only state.
 */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Already installed — we're running in the standalone PWA window. Hide
    // the pill outright; nothing to install.
    try {
      const isStandalone =
        window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches
      if (isStandalone) {
        setHidden(true)
        return
      }
    } catch {
      // matchMedia may throw on legacy WebViews — fall through to the
      // event-driven path.
    }

    const onPrompt = (e: Event) => {
      // Suppress Chrome's mini-infobar — we'll show our own pill.
      e.preventDefault()
      setEvt(e as BeforeInstallPromptEvent)
      setHidden(false)
    }
    const onInstalled = () => {
      setEvt(null)
      setHidden(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt as EventListener)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (hidden || !evt) return null

  return (
    <button
      type="button"
      data-testid="pwa-install-pill"
      onClick={() => {
        // Fire and forget — the promise resolves once the user picks.
        void triggerInstallPrompt(evt, () => {
          setEvt(null)
          setHidden(true)
        })
      }}
      className="fixed bottom-4 right-4 z-50 rounded-full bg-smsg-700 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-smsg-800"
    >
      📱 앱으로 설치
    </button>
  )
}
