import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  createSchedule,
  deleteSchedule,
  downloadRunUrl,
  listRuns,
  listSchedules,
  patchSchedule,
  runNow,
} from '../api'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPatch = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

function envelope<T>(data: T) {
  return { data: { data, meta: {}, error: null } }
}

describe('backups/api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listSchedules unwraps array', async () => {
    mockGet.mockResolvedValueOnce(
      envelope([
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
    )
    const rows = await listSchedules()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.scope).toBe('full')
    expect(mockGet).toHaveBeenCalledWith('/backups/schedules')
  })

  it('createSchedule POSTs body', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({
        id: 's1',
        scope: 'full',
        cadence: 'daily',
        hour_utc: 3,
        format: 'json',
        target_user_id: null,
        target_doc_slug: null,
        enabled: true,
        last_run_at: null,
        next_run_at: null,
        created_by: 'u',
        created_at: null,
      }),
    )
    const r = await createSchedule({
      scope: 'full',
      cadence: 'daily',
      format: 'json',
    })
    expect(r.id).toBe('s1')
    expect(mockPost).toHaveBeenCalledWith('/backups/schedules', {
      scope: 'full',
      cadence: 'daily',
      format: 'json',
    })
  })

  it('patchSchedule PATCHes with id encoded', async () => {
    mockPatch.mockResolvedValueOnce(
      envelope({
        id: 's/x',
        scope: 'full',
        cadence: 'weekly',
        hour_utc: 3,
        format: 'json',
        target_user_id: null,
        target_doc_slug: null,
        enabled: false,
        last_run_at: null,
        next_run_at: null,
        created_by: 'u',
        created_at: null,
      }),
    )
    await patchSchedule('s/x', { enabled: false, cadence: 'weekly' })
    expect(mockPatch).toHaveBeenCalledWith('/backups/schedules/s%2Fx', {
      enabled: false,
      cadence: 'weekly',
    })
  })

  it('deleteSchedule DELETEs', async () => {
    mockDelete.mockResolvedValueOnce({ data: { data: null, meta: {}, error: null } })
    await deleteSchedule('s1')
    expect(mockDelete).toHaveBeenCalledWith('/backups/schedules/s1')
  })

  it('listRuns passes limit param', async () => {
    mockGet.mockResolvedValueOnce(envelope([]))
    await listRuns(50)
    expect(mockGet).toHaveBeenCalledWith('/backups/runs', {
      params: { limit: 50 },
    })
  })

  it('runNow POSTs to /backups/run-now', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({ run_id: 'r1', size_bytes: 999, doc_count: 3 }),
    )
    const r = await runNow({ scope: 'full', format: 'json' })
    expect(r.run_id).toBe('r1')
    expect(mockPost).toHaveBeenCalledWith('/backups/run-now', {
      scope: 'full',
      format: 'json',
    })
  })

  it('downloadRunUrl builds an absolute URL with the configured base', () => {
    const url = downloadRunUrl('abc')
    expect(url).toContain('/backups/runs/abc/download')
  })
})
