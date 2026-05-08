import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { WikiLink } from '../WikiLink'

vi.mock('@/features/document/hooks/useDocumentExists', () => ({
  useDocumentExists: () => ({ data: true, isPending: false, isError: false }),
}))

function render(props: Parameters<typeof WikiLink>[0]): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <WikiLink {...props} />
    </MemoryRouter>,
  )
}

describe('<WikiLink />', () => {
  it('builds a `/docs/<slug>` href for a bare wiki link', () => {
    const html = render({ slug: 'foo' })
    expect(html).toContain('href="/docs/foo"')
    expect(html).toContain('text-link')
    expect(html).not.toContain('text-link-missing')
  })

  it('builds `#section-<anchor>` for a same-doc anchor link', () => {
    const html = render({ slug: '', anchor: 'section-1.1' })
    expect(html).toContain('href="#section-1.1"')
  })

  it('accepts the legacy bare numeric anchor form', () => {
    const html = render({ slug: 'foo', anchor: '1.1' })
    expect(html).toContain('href="/docs/foo#section-1.1"')
  })

  it('accepts the explicit `section-` cross-doc anchor form', () => {
    const html = render({ slug: 'foo', anchor: 'section-2' })
    expect(html).toContain('href="/docs/foo#section-2"')
  })

  it('renders the display label when provided', () => {
    const html = render({ slug: 'foo', display: '예쁜 라벨' })
    expect(html).toContain('예쁜 라벨')
    expect(html).toContain('href="/docs/foo"')
  })

  it('renders the missing variant when the existence hook returns false', async () => {
    vi.resetModules()
    vi.doMock('@/features/document/hooks/useDocumentExists', () => ({
      useDocumentExists: () => ({
        data: false,
        isPending: false,
        isError: false,
      }),
    }))
    const { WikiLink: WL } = await import('../WikiLink')
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <WL slug="missing" />
      </MemoryRouter>,
    )
    expect(html).toContain('text-link-missing')
    expect(html).toContain('/docs/new?slug=missing')
  })
})
