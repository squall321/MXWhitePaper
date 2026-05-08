import { create } from 'zustand'

/**
 * Cheap connection-health store. Updated by axios interceptors:
 *   - successful HTTP response → `markSuccess()`
 *   - 5xx / network error      → `markFailure()`
 *
 * The TopBar profile menu reads `status` and renders a Korean pill:
 *   online        — last success within ONLINE_WINDOW_MS
 *   reconnecting  — at least one recent failure, no fresh success
 *   offline       — sustained failures with no success in OFFLINE_AFTER_MS
 *
 * The pill is informational only — it never blocks user input.
 */
export type ConnectionStatus = 'online' | 'reconnecting' | 'offline'

export interface ConnectionState {
  lastSuccessAt: number | null
  lastFailureAt: number | null
  consecutiveFailures: number
  markSuccess(): void
  markFailure(): void
  reset(): void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  lastSuccessAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
  markSuccess: () =>
    set(() => ({
      lastSuccessAt: Date.now(),
      consecutiveFailures: 0,
    })),
  markFailure: () =>
    set((s) => ({
      lastFailureAt: Date.now(),
      consecutiveFailures: s.consecutiveFailures + 1,
    })),
  reset: () =>
    set({ lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0 }),
}))

const ONLINE_WINDOW_MS = 30_000
const OFFLINE_AFTER_FAILURES = 3

/** Pure derivation so it's trivial to unit-test. */
export function deriveStatus(
  s: Pick<ConnectionState, 'lastSuccessAt' | 'lastFailureAt' | 'consecutiveFailures'>,
  now: number = Date.now(),
): ConnectionStatus {
  if (s.consecutiveFailures >= OFFLINE_AFTER_FAILURES) return 'offline'
  if (s.lastFailureAt && (!s.lastSuccessAt || s.lastFailureAt > s.lastSuccessAt)) {
    return 'reconnecting'
  }
  if (s.lastSuccessAt && now - s.lastSuccessAt <= ONLINE_WINDOW_MS) return 'online'
  // No traffic yet — treat as online so the pill doesn't scream on a fresh
  // tab before the first request lands.
  return 'online'
}
