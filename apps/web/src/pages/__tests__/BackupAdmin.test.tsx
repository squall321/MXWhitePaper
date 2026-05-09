import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/backups/api', () => ({
  listSchedules: () =>
    Promise.resolve([
      {
        id: 's1',
        scope: 'full',
        cadence: 'daily',
        hour_utc: 3,
        format: 'json',
        target_user_id: null,
        target_doc_slug: null,
        enabled: true,
        last_run_at: null,
        next_run_at: '2026-05-10T03:00:00Z',
        created_by: 'u1',
        created_at: null,
      },
    ]),
  listRuns: () =>
    Promise.resolve([
      {
        id: 'r1',
        schedule_id: 's1',
        scope: 'full',
        format: 'json',
        storage_key: 'full/2026/05/x.zip',
        size_bytes: 1234,
        doc_count: 5,
        status: 'ok',
        error_message: null,
        started_at: '2026-05-09T03:00:00Z',
        finished_at: '2026-05-09T03:01:00Z',
      },
    ]),
  createSchedule: () => Promise.resolve({}),
  patchSchedule: () => Promise.resolve({}),
  deleteSchedule: () => Promise.resolve(),
  runNow: () => Promise.resolve({ run_id: 'r2', size_bytes: 1, doc_count: 1 }),
  downloadRunUrl: (id: string) => `/api/v1/backups/runs/${id}/download`,
}))

const authState = {
  current: { user: { id: 'u1', email: 'admin@mx.local', role: 'admin' } as
    | null
    | { id: string; email: string; role: string } },
}

vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: typeof authState.current.user }) => unknown) =>
      selector({ user: authState.current.user }),
    {
      getState: () => ({ user: authState.current.user }),
      setState: () => {},
    },
  ),
}))

import { BackupAdminPage } from '../BackupAdmin'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<BackupAdminPage />', () => {
  beforeEach(() => {
    authState.current = { user: { id: 'u1', email: 'admin@mx.local', role: 'admin' } }
  })

  it('renders the three sections + heading', () => {
    const html = render(<BackupAdminPage />)
    expect(html).toContain('백업 관리')
    expect(html).toContain('일정')
    expect(html).toContain('지금 실행')
    expect(html).toContain('최근 실행')
  })

  it('redirects non-admin users away', () => {
    authState.current = { user: { id: 'u2', email: 'r@mx.local', role: 'reader' } }
    const html = render(<BackupAdminPage />)
    expect(html).not.toContain('백업 관리')
  })

  it('returns null while no user is loaded', () => {
    authState.current = { user: null }
    const html = render(<BackupAdminPage />)
    expect(html).not.toContain('백업 관리')
  })
})
