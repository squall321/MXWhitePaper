import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShareModal } from '../ShareModal'

vi.mock('../api', () => ({
  listShareLinks: vi.fn(async () => []),
  createShareLink: vi.fn(),
  revokeShareLink: vi.fn(),
}))

describe('<ShareModal />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <ShareModal open={false} slug="some-doc" onClose={() => undefined} />,
    )
    expect(html).toBe('')
  })

  it('renders the modal chrome with both tabs when open', () => {
    const html = renderToStaticMarkup(
      <ShareModal open={true} slug="some-doc" onClose={() => undefined} />,
    )
    expect(html).toContain('data-testid="share-modal"')
    expect(html).toContain('data-testid="share-tab-public"')
    expect(html).toContain('data-testid="share-tab-internal"')
  })

  it('public tab shows a "create link" CTA and the warning copy', () => {
    const html = renderToStaticMarkup(
      <ShareModal open={true} slug="some-doc" onClose={() => undefined} />,
    )
    expect(html).toContain('data-testid="share-create-button"')
    expect(html).toContain('새 공유 링크 생성')
    // 상단 안내 문구
    expect(html).toContain('읽기 전용')
  })

  it('public tab shows the public-link panel testid', () => {
    const html = renderToStaticMarkup(
      <ShareModal open={true} slug="some-doc" onClose={() => undefined} />,
    )
    expect(html).toContain('data-testid="share-tab-public-panel"')
    // The internal-access copy should NOT be in the initial markup —
    // only after switching tabs (which doesn't fire in SSR).
    expect(html).not.toContain('data-testid="share-tab-internal-panel"')
  })
})
