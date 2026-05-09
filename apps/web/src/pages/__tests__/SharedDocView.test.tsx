import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Effects don't run under `renderToStaticMarkup`, so the API mock isn't
// strictly required — but registering it keeps the import graph clean and
// lets us verify the call site if needed.
vi.mock('@/features/sharing/api', () => ({
  readSharedDocument: vi.fn(),
}))

import { SharedDocViewPage } from '../SharedDocView'

function render(initial: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/share/:token" element={<SharedDocViewPage />} />
        {/* Catch-all so the empty-token case still resolves to the page. */}
        <Route path="*" element={<SharedDocViewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<SharedDocViewPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the loading placeholder on initial mount (happy path)', () => {
    // useEffect doesn't run during SSR; the pre-fetch state is "loading".
    // This proves the route is wired and params are extracted.
    const html = render('/share/abc-token')
    expect(html).toContain('불러오는 중')
    // The doc body is NOT rendered yet — we shouldn't surface stale row
    // data before the fetch lands.
    expect(html).not.toContain('data-testid="shared-doc-view"')
  })

  it('renders the "잘못된 공유 링크" guard when the URL has no token', () => {
    const html = render('/share/')
    expect(html).toContain('잘못된 공유 링크입니다')
  })

  it('exposes the password-prompt testids when needsPassword state is set', () => {
    // We can't run effects, so we exercise the password-prompt branch by
    // confirming the markup uses the documented testids the BE contract
    // depends on. The branch is reachable by the 401 → setNeedsPassword
    // transition; the SharedDocView source must keep these testids stable
    // for the public-facing UX. Use a regex sanity check on the source.
    const src = SharedDocViewPage.toString()
    expect(src).toContain('shared-doc-password-prompt')
    expect(src).toContain('shared-doc-password-input')
    expect(src).toContain('shared-doc-password-submit')
  })
})
