import { create } from 'zustand'

/**
 * Editor-side connection store. Distinct from `@/features/auth/connectionStore`
 * (which derives status from axios interceptor signals across the whole app).
 *
 * This one tracks the *editor's* offline-queue state explicitly:
 *   - `online`           browser navigator state (toggled by online/offline events
 *                        and by the heartbeat below)
 *   - `lastPing`         epoch ms of the most recent successful heartbeat
 *   - `pendingMutations` count of local-only edits waiting to be flushed to the
 *                        BE on reconnect. Bumped by useAutoSave on each offline
 *                        edit and decremented when the queue drains.
 *
 * The store also wires a 30-second heartbeat against `GET /api/v1/healthz`
 * once `startHeartbeat()` is called (idempotent — repeat calls are no-ops).
 */
export interface ConnectionStore {
  online: boolean
  lastPing: number | null
  pendingMutations: number
  setOnline(online: boolean): void
  bumpPending(delta: number): void
  reset(): void
}

const initial = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastPing: null as number | null,
  pendingMutations: 0,
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  ...initial,
  setOnline: (online: boolean) =>
    set((s) => ({
      online,
      // Bump the ping marker on a positive transition so consumers can show
      // "마지막 동기화: HH:mm:ss" without waiting for the next heartbeat.
      lastPing: online ? Date.now() : s.lastPing,
    })),
  bumpPending: (delta: number) =>
    set((s) => ({
      pendingMutations: Math.max(0, s.pendingMutations + delta),
    })),
  reset: () => set({ ...initial, online: true, pendingMutations: 0, lastPing: null }),
}))

// ---------------------------------------------------------------------------
// Side-effects: window event listeners + heartbeat. Wired once per page load.
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 30_000
const STALE_PING_MS = 60_000

let listenersAttached = false
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/**
 * Attach `online` / `offline` window listeners and the heartbeat poll.
 * Idempotent — safe to call multiple times. Returns a teardown function for
 * tests that need to detach.
 */
export function startConnectionTracking(): () => void {
  if (typeof window === 'undefined') return () => undefined
  if (listenersAttached) return () => undefined
  listenersAttached = true

  const onOnline = () => useConnectionStore.getState().setOnline(true)
  const onOffline = () => useConnectionStore.getState().setOnline(false)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  const tick = async () => {
    const s = useConnectionStore.getState()
    // Skip when fresh — last successful ping under STALE_PING_MS old.
    if (s.lastPing && Date.now() - s.lastPing < STALE_PING_MS) return
    try {
      // We use plain fetch (not the apiClient) so a 401 here doesn't trigger
      // the auth refresh loop. healthz is unauthenticated.
      // Use the app base so the heartbeat reaches /mx-white-paper/api/v1/healthz behind the portal
      // (a bare '/api/v1/healthz' 404s there → the editor would wrongly think it's offline).
      // BASE_URL is "/" standalone, "/mx-white-paper/" behind the portal.
      const res = await fetch(`${import.meta.env.BASE_URL}api/v1/healthz`, { method: 'GET' })
      if (res.ok) {
        useConnectionStore.setState({ lastPing: Date.now(), online: true })
      } else {
        useConnectionStore.getState().setOnline(false)
      }
    } catch {
      useConnectionStore.getState().setOnline(false)
    }
  }

  heartbeatTimer = setInterval(() => {
    void tick()
  }, HEARTBEAT_MS)

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    listenersAttached = false
  }
}

/** Exposed so tests + telemetry can inspect heartbeat policy. */
export const CONNECTION_THRESHOLDS = {
  HEARTBEAT_MS,
  STALE_PING_MS,
} as const
