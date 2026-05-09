import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/version-tags/api', async () => {
  const mod = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...mod,
    createVersionTag: vi.fn(async () => ({
      id: 'vt-1',
      document_id: 'doc-1',
      version: 3,
      tag_name: 'v1.0 release',
      description: null,
      tagged_by: 'u-1',
      tagged_by_name: 'admin',
      tagged_at: null,
      is_locked: false,
    })),
    listVersionTags: vi.fn(async () => []),
    deleteVersionTag: vi.fn(),
    branchFromTag: vi.fn(),
  }
})

import { TagVersionButton } from '../TagVersionButton'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

describe('<TagVersionButton />', () => {
  it('renders the toggle with the version number on tooltip', () => {
    const html = render(<TagVersionButton slug="my-doc" version={3} />)
    expect(html).toContain('data-testid="tag-version-button"')
    expect(html).toContain('data-version="3"')
    expect(html).toContain('data-testid="tag-version-toggle"')
    expect(html).toContain('태그 추가')
    expect(html).toContain('title="v3 에 태그 추가"')
  })

  it('toggle exposes aria-haspopup="dialog" and starts closed', () => {
    const html = render(<TagVersionButton slug="my-doc" version={1} />)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    // Dialog content is hidden until open.
    expect(html).not.toContain('data-testid="tag-version-dialog"')
  })

  it('passes a custom className through to the wrapper', () => {
    const html = render(
      <TagVersionButton slug="my-doc" version={2} className="ml-4" />,
    )
    expect(html).toContain('ml-4')
  })

  it('renders distinct buttons for two different versions on the same doc', () => {
    const html = render(
      <div>
        <TagVersionButton slug="my-doc" version={1} />
        <TagVersionButton slug="my-doc" version={2} />
      </div>,
    )
    expect(html).toContain('data-version="1"')
    expect(html).toContain('data-version="2"')
  })
})
