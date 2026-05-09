/**
 * BE round-trip helpers for `users.notification_prefs`. Decoupled from the
 * Zustand store so the Settings page can hydrate / persist without forcing
 * the store itself to take a runtime dependency on axios.
 */
import { apiClient } from '@/lib/api/client'
import {
  mergeNotificationPrefs,
  type NotificationPrefs,
} from './store'

interface PrefsEnvelope {
  data: { prefs: NotificationPrefs }
}

/**
 * Fetch the current user's notification prefs. Returns null on any failure
 * (logged-out, network, 5xx). Callers fall back to the local store defaults.
 */
export async function fetchNotificationPrefs(): Promise<NotificationPrefs | null> {
  try {
    const res = await apiClient.get<PrefsEnvelope>('/me/notification-prefs')
    return mergeNotificationPrefs(res.data?.data?.prefs)
  } catch {
    return null
  }
}

/**
 * Persist the full prefs blob. Best-effort — failure is logged via console
 * and the local store keeps the user's intent so they can retry implicitly
 * the next time anything triggers a sync.
 */
export async function putNotificationPrefs(
  prefs: NotificationPrefs,
): Promise<NotificationPrefs | null> {
  try {
    const res = await apiClient.put<PrefsEnvelope>(
      '/me/notification-prefs',
      prefs,
    )
    return mergeNotificationPrefs(res.data?.data?.prefs)
  } catch {
    return null
  }
}
