import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Reminder } from '@/features/reminders/api'

vi.mock('@/features/reminders/api', () => ({
  listMyReminders: vi.fn(async () => [] as Reminder[]),
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  patchReminder: vi.fn(),
}))

import { MyRemindersPage } from '../MyReminders'

function render(seed: Reminder[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['reminders', 'me', true], seed)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/reminders']}>
        <MyRemindersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<MyRemindersPage />', () => {
  it('renders the empty state when there are no rows', () => {
    const html = render([])
    expect(html).toContain('내 리마인더')
    expect(html).toContain('data-testid="my-reminders-empty"')
  })

  it('splits active and fired reminders into separate sections', () => {
    const html = render([
      {
        id: 'rem-1',
        user_id: 'u-1',
        document_id: 'doc-1',
        slug: 'alpha',
        title: 'Alpha doc',
        message: 'Follow up on this',
        remind_at: '2026-06-01T00:00:00Z',
        fired_at: null,
        created_at: '2026-05-01T00:00:00Z',
      },
      {
        id: 'rem-2',
        user_id: 'u-1',
        document_id: 'doc-2',
        slug: 'beta',
        title: 'Beta doc',
        message: null,
        remind_at: '2026-04-01T00:00:00Z',
        fired_at: '2026-04-01T00:00:00Z',
        created_at: null,
      },
    ])
    expect(html).toContain('Alpha doc')
    expect(html).toContain('Beta doc')
    expect(html).toContain('data-testid="my-reminders-active"')
    expect(html).toContain('data-testid="my-reminders-fired"')
    expect(html).toContain('data-testid="my-reminder-row"')
    expect(html).toContain('data-testid="my-reminder-delete"')
    // Active row has the edit button; fired row does not.
    expect(html).toContain('data-testid="my-reminder-edit"')
    expect(html).toContain('Follow up on this')
  })
})
