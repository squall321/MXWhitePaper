import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/reminders/api', () => ({
  createReminder: vi.fn(async () => ({
    id: 'rem-1',
    user_id: 'u-1',
    document_id: 'doc-1',
    slug: 'alpha',
    title: 'Alpha doc',
    message: null,
    remind_at: '2026-06-01T00:00:00Z',
    fired_at: null,
    created_at: null,
  })),
  listMyReminders: vi.fn(async () => []),
  deleteReminder: vi.fn(async () => undefined),
  patchReminder: vi.fn(async () => ({})),
}))

import { ReminderButton } from '../ReminderButton'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

describe('<ReminderButton />', () => {
  it('renders a closed toggle with the right test id', () => {
    const html = render(<ReminderButton slug="alpha" />)
    expect(html).toContain('data-testid="reminder-button"')
    expect(html).toContain('data-slug="alpha"')
    expect(html).toContain('data-testid="reminder-toggle"')
    expect(html).toContain('리마인더')
    // Closed by default — dropdown not rendered.
    expect(html).not.toContain('data-testid="reminder-dropdown"')
  })

  it('exposes the toggle as a button with aria-haspopup="menu"', () => {
    const html = render(<ReminderButton slug="alpha" />)
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
  })
})
