/**
 * Cross-window slide-index sync for Presentation mode.
 *
 * The audience window (the original Presentation page) and the presenter
 * window (the popup opened via Shift+P) share state through one of:
 *
 *   1. `BroadcastChannel('mx-presenter')`  — preferred, instant.
 *   2. `localStorage` events on a known key — fallback for environments
 *      where BroadcastChannel is unavailable (rare, Safari Private mode-ish).
 *
 * The protocol is tiny: a single message shape `{ index, total, ts }`.
 * Either side can post it; both sides subscribe via `subscribe(...)`.
 *
 * Pure module — no React. Tests mock the BroadcastChannel global.
 */

const CHANNEL_NAME = 'mx-presenter'
const STORAGE_KEY = 'mx-presenter:state'

export interface PresenterMessage {
  index: number
  total: number
  ts: number
}

export interface PresenterChannel {
  post(msg: PresenterMessage): void
  subscribe(handler: (msg: PresenterMessage) => void): () => void
  close(): void
}

/**
 * Open a channel. Uses BroadcastChannel if available, otherwise falls back to
 * `storage` events. The returned object is symmetric: every window calls
 * `openPresenterChannel()` and gets the same surface.
 */
export function openPresenterChannel(): PresenterChannel {
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel(CHANNEL_NAME)
    return {
      post(msg) {
        bc.postMessage(msg)
      },
      subscribe(handler) {
        const onMsg = (ev: MessageEvent<PresenterMessage>) => {
          if (isPresenterMessage(ev.data)) handler(ev.data)
        }
        bc.addEventListener('message', onMsg)
        return () => bc.removeEventListener('message', onMsg)
      },
      close() {
        bc.close()
      },
    }
  }
  // localStorage fallback. Writes serialize a counter so the same index
  // posted twice still fires a `storage` event.
  let counter = 0
  return {
    post(msg) {
      try {
        counter += 1
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...msg, _c: counter }),
        )
      } catch {
        // Storage may be disabled — fail silently; sync simply won't work.
      }
    },
    subscribe(handler) {
      const onStorage = (ev: StorageEvent) => {
        if (ev.key !== STORAGE_KEY || !ev.newValue) return
        try {
          const parsed = JSON.parse(ev.newValue) as unknown
          if (isPresenterMessage(parsed)) handler(parsed)
        } catch {
          /* ignore */
        }
      }
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    },
    close() {
      // No persistent resource to free.
    },
  }
}

function isPresenterMessage(v: unknown): v is PresenterMessage {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.index === 'number' &&
    typeof o.total === 'number' &&
    typeof o.ts === 'number'
  )
}
