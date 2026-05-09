/**
 * Reminders API client (Cycle 0028).
 *
 * 미러: `apps/api/app/routers/reminders.py`. Envelope `{data, meta}` 를 풀어
 * 도메인 형으로 노출한다.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface Reminder {
  id: string
  user_id: string
  document_id: string
  slug: string | null
  title: string | null
  message: string | null
  remind_at: string
  fired_at: string | null
  created_at: string | null
}

export interface CreateReminderBody {
  remind_at: string
  message?: string | null
}

export interface PatchReminderBody {
  remind_at?: string
  message?: string | null
}

export async function createReminder(
  slug: string,
  body: CreateReminderBody,
): Promise<Reminder> {
  const res = await apiClient.post<ApiEnvelope<Reminder>>(
    `/documents/${encodeURIComponent(slug)}/reminders`,
    body,
  )
  return unwrap(res)
}

export async function listMyReminders(
  includeFired = false,
): Promise<Reminder[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: Reminder[] }>>(
    `/me/reminders?include_fired=${includeFired ? 'true' : 'false'}`,
  )
  return unwrap(res).items
}

export async function deleteReminder(id: string): Promise<void> {
  await apiClient.delete(`/reminders/${encodeURIComponent(id)}`)
}

export async function patchReminder(
  id: string,
  body: PatchReminderBody,
): Promise<Reminder> {
  const res = await apiClient.patch<ApiEnvelope<Reminder>>(
    `/reminders/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}
