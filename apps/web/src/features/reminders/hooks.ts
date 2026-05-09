/**
 * React Query hooks for reminders (Cycle 0028).
 *
 * Query keys:
 *   ['reminders', 'me', includeFired]
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  createReminder,
  deleteReminder,
  listMyReminders,
  patchReminder,
  type CreateReminderBody,
  type PatchReminderBody,
  type Reminder,
} from './api'

export const myRemindersKey = (includeFired: boolean) =>
  ['reminders', 'me', includeFired] as const

export function useMyReminders(
  includeFired = false,
): UseQueryResult<Reminder[]> {
  return useQuery<Reminder[]>({
    queryKey: myRemindersKey(includeFired),
    queryFn: () => listMyReminders(includeFired),
    staleTime: 30_000,
  })
}

export function useCreateReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: CreateReminderBody }) =>
      createReminder(slug, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders'] })
    },
  })
}

export function useDeleteReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteReminder(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders'] })
    },
  })
}

export function usePatchReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PatchReminderBody }) =>
      patchReminder(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders'] })
    },
  })
}
