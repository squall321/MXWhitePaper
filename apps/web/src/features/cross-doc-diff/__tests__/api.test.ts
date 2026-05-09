import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DocumentJSONV10 } from '@/types/document'

const makeRow = (slug: string, title: string, content: DocumentJSONV10) => ({
  data: {
    data: { id: `id-${slug}`, slug, title, content },
    meta: { etag: `W/"${slug}"`, version: 1 },
  },
})

const SEC = '01TESTSECCDXXXXXXXXXXXXXXX1' as const
const BLK = '01TESTBLKCDXXXXXXXXXXXXXXX1' as const

function doc(slug: string, title: string, text: string): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: `01ROOTROOTROOTROOTROOT-${slug}`,
    slug,
    title,
    metadata: {
      division: 'MX',
      owners: ['a'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: SEC,
        level: 1,
        title: 'Section',
        blocks: [{ type: 'paragraph', id: BLK, text }],
        subsections: [],
      },
    ],
  } as unknown as DocumentJSONV10
}

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import { compareDocs } from '../api'

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('cross-doc-diff/api · compareDocs()', () => {
  it('fetches both docs and returns a populated DocDiff', async () => {
    const left = doc('left', 'Left', 'hello world')
    const right = doc('right', 'Right', 'hello brave world')
    get.mockResolvedValueOnce(makeRow('left', 'Left', left))
    get.mockResolvedValueOnce(makeRow('right', 'Right', right))

    const r = await compareDocs('left', 'right')

    expect(r.leftDoc).toEqual(left)
    expect(r.rightDoc).toEqual(right)
    // Title scalar diff fires: "Left" vs "Right".
    expect(r.diff.scalars.some((s) => s.key === 'title')).toBe(true)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('surfaces an empty diff when both docs are identical', async () => {
    const same = doc('same', 'T', 'hello')
    get.mockResolvedValueOnce(makeRow('same', 'T', same))
    get.mockResolvedValueOnce(makeRow('same', 'T', same))

    const r = await compareDocs('same', 'same')
    expect(r.diff.sections).toHaveLength(0)
    expect(r.diff.scalars).toHaveLength(0)
  })

  it('propagates an error when either fetch fails', async () => {
    get.mockResolvedValueOnce(makeRow('a', 'A', doc('a', 'A', 'x')))
    get.mockRejectedValueOnce(new Error('boom'))
    await expect(compareDocs('a', 'b')).rejects.toThrow('boom')
  })
})
