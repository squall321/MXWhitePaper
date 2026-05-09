import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { canSeeBlock, BlockRenderer } from '../BlockRenderer'
import { useAuthStore } from '@/features/auth/store'
import type { Block } from '@/types/document'

// Stub the glossary hook used by inline rendering so SSR works without QC.
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))
vi.mock('@/features/document/hooks/useDocumentExists', () => ({
  useDocumentExists: () => ({ data: true, isPending: false, isError: false }),
}))

function asAdmin() {
  useAuthStore.getState().setUser({
    id: 'u-admin',
    email: 'admin@mx.local',
    role: 'admin',
  })
}
function asEditor() {
  useAuthStore.getState().setUser({
    id: 'u-ed',
    email: 'ed@mx.local',
    role: 'editor',
  })
}
function asReader() {
  useAuthStore.getState().setUser({
    id: 'u-r',
    email: 'r@mx.local',
    role: 'reader',
  })
}

beforeEach(() => {
  useAuthStore.getState().clear()
})

describe('canSeeBlock helper', () => {
  it('admin permission → only admin', () => {
    const blk = { meta: { permission: 'admin' as const } }
    expect(canSeeBlock(blk, 'admin')).toBe(true)
    expect(canSeeBlock(blk, 'owner')).toBe(false)
    expect(canSeeBlock(blk, 'editor')).toBe(false)
    expect(canSeeBlock(blk, 'reader')).toBe(false)
    expect(canSeeBlock(blk, null)).toBe(false)
  })

  it('editor permission → editor/owner/admin', () => {
    const blk = { meta: { permission: 'editor' as const } }
    expect(canSeeBlock(blk, 'admin')).toBe(true)
    expect(canSeeBlock(blk, 'owner')).toBe(true)
    expect(canSeeBlock(blk, 'editor')).toBe(true)
    expect(canSeeBlock(blk, 'reader')).toBe(false)
    expect(canSeeBlock(blk, undefined)).toBe(false)
  })

  it('all permission → everyone', () => {
    const blk = { meta: { permission: 'all' as const } }
    expect(canSeeBlock(blk, 'reader')).toBe(true)
    expect(canSeeBlock(blk, 'editor')).toBe(true)
    expect(canSeeBlock(blk, 'admin')).toBe(true)
    expect(canSeeBlock(blk, null)).toBe(true)
  })

  it('missing meta or permission → everyone', () => {
    expect(canSeeBlock({}, 'reader')).toBe(true)
    expect(canSeeBlock({ meta: {} }, 'reader')).toBe(true)
    expect(canSeeBlock(null, 'reader')).toBe(true)
  })

  it('case-insensitive on role', () => {
    const blk = { meta: { permission: 'admin' as const } }
    expect(canSeeBlock(blk, 'ADMIN')).toBe(true)
    expect(canSeeBlock(blk, 'Editor')).toBe(false)
  })
})

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
}

describe('<BlockRenderer /> permission gating', () => {
  it('renders the placeholder when role is below required (reader vs admin)', () => {
    asReader()
    const block: Block = {
      type: 'paragraph',
      id: '01ABCDEFGHJKMNPQRSTVWXY100',
      text: 'top-secret',
      meta: { permission: 'admin' },
    }
    const html = render(<BlockRenderer block={block} />)
    expect(html).toContain('권한이 부족하여 표시되지 않습니다')
    // The original text must NOT leak through.
    expect(html).not.toContain('top-secret')
  })

  it('renders the block normally when role meets requirement (editor sees editor-block)', () => {
    asEditor()
    // Sanity check that state was set as expected.
    expect(useAuthStore.getState().user?.role).toBe('editor')
    const block: Block = {
      type: 'paragraph',
      id: '01ABCDEFGHJKMNPQRSTVWXY101',
      text: 'editor-content',
      meta: { permission: 'editor' },
    }
    const html = render(<BlockRenderer block={block} />)
    expect(html).toContain('editor-content')
    expect(html).not.toContain('권한이 부족하여')
  })

  it('admin sees admin-permission block', () => {
    asAdmin()
    const block: Block = {
      type: 'paragraph',
      id: '01ABCDEFGHJKMNPQRSTVWXY102',
      text: 'admin-only-content',
      meta: { permission: 'admin' },
    }
    const html = render(<BlockRenderer block={block} />)
    expect(html).toContain('admin-only-content')
  })

  it('blocks without meta render normally for any role', () => {
    asReader()
    const block: Block = {
      type: 'paragraph',
      id: '01ABCDEFGHJKMNPQRSTVWXY103',
      text: 'public-content',
    }
    const html = render(<BlockRenderer block={block} />)
    expect(html).toContain('public-content')
  })
})
