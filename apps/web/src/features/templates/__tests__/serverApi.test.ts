import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createServerTemplate,
  deleteServerTemplate,
  getServerTemplate,
  listServerTemplates,
  patchServerTemplate,
  useServerTemplate,
} from '../serverApi'
import type { SectionLevel1 } from '@/types/document'

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

const SAMPLE_SECTIONS: SectionLevel1[] = [
  {
    id: '01ABCDEFGH0123456789ABCDEF',
    level: 1,
    number: '1',
    title: '개요',
    blocks: [],
    subsections: [],
  },
]

describe('templates/serverApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listServerTemplates passes filters through and unwraps items', async () => {
    mockGet.mockResolvedValueOnce(
      envelope({
        items: [
          {
            id: 'a',
            slug: 'sample',
            title: 'A',
            description: null,
            category: 'report',
            thumb_image_id: null,
            section_count: 2,
            scope: 'org',
            use_count: 5,
            created_by: null,
            author_name: null,
            created_at: null,
            updated_at: null,
          },
        ],
      }),
    )
    const items = await listServerTemplates({
      scope: 'org',
      category: 'report',
      q: 'foo',
      limit: 25,
    })
    expect(items[0]?.slug).toBe('sample')
    expect(mockGet).toHaveBeenCalledWith('/doc-templates', {
      params: { scope: 'org', category: 'report', q: 'foo', limit: 25 },
    })
  })

  it('listServerTemplates omits empty options', async () => {
    mockGet.mockResolvedValueOnce(envelope({ items: [] }))
    await listServerTemplates()
    expect(mockGet).toHaveBeenCalledWith('/doc-templates', { params: {} })
  })

  it('getServerTemplate encodes slug', async () => {
    mockGet.mockResolvedValueOnce(
      envelope({
        id: 'a',
        slug: 'monthly-report',
        title: 'M',
        description: null,
        category: 'report',
        thumb_image_id: null,
        sections: SAMPLE_SECTIONS,
        scope: 'org',
        use_count: 1,
        created_by: null,
        author_name: null,
        created_at: null,
        updated_at: null,
      }),
    )
    const got = await getServerTemplate('monthly-report')
    expect(got.use_count).toBe(1)
    expect(mockGet).toHaveBeenCalledWith('/doc-templates/monthly-report')
  })

  it('createServerTemplate returns template_id and slug', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({ template_id: 'tid', slug: 'auto-slug' }),
    )
    const r = await createServerTemplate({
      title: 'X',
      category: 'custom',
      sections: SAMPLE_SECTIONS,
      scope: 'private',
    })
    expect(r.slug).toBe('auto-slug')
    expect(mockPost).toHaveBeenCalledWith('/doc-templates', {
      title: 'X',
      category: 'custom',
      sections: SAMPLE_SECTIONS,
      scope: 'private',
    })
  })

  it('patchServerTemplate sends body and returns full template', async () => {
    mockPatch.mockResolvedValueOnce(
      envelope({
        id: 'a',
        slug: 'x',
        title: 'after',
        description: null,
        category: 'report',
        thumb_image_id: null,
        sections: SAMPLE_SECTIONS,
        scope: 'org',
        use_count: 0,
        created_by: null,
        author_name: null,
        created_at: null,
        updated_at: null,
      }),
    )
    const r = await patchServerTemplate('x', { title: 'after', scope: 'org' })
    expect(r.title).toBe('after')
    expect(mockPatch).toHaveBeenCalledWith('/doc-templates/x', {
      title: 'after',
      scope: 'org',
    })
  })

  it('deleteServerTemplate calls DELETE on the right URL', async () => {
    mockDelete.mockResolvedValueOnce({ data: null })
    await deleteServerTemplate('foo')
    expect(mockDelete).toHaveBeenCalledWith('/doc-templates/foo')
  })

  it('useServerTemplate posts target slug + title', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({ slug: 'new-doc', id: 'doc-id' }),
    )
    const r = await useServerTemplate('tpl', {
      target_slug: 'new-doc',
      title: 'From template',
    })
    expect(r.slug).toBe('new-doc')
    expect(mockPost).toHaveBeenCalledWith('/doc-templates/tpl/use', {
      target_slug: 'new-doc',
      title: 'From template',
    })
  })

  it('encodes special chars in slug for getServerTemplate', async () => {
    mockGet.mockResolvedValueOnce(
      envelope({
        id: 'a',
        slug: '월결산',
        title: 'M',
        description: null,
        category: 'report',
        thumb_image_id: null,
        sections: SAMPLE_SECTIONS,
        scope: 'org',
        use_count: 0,
        created_by: null,
        author_name: null,
        created_at: null,
        updated_at: null,
      }),
    )
    await getServerTemplate('월결산')
    expect(mockGet).toHaveBeenCalledWith(
      `/doc-templates/${encodeURIComponent('월결산')}`,
    )
  })
})
