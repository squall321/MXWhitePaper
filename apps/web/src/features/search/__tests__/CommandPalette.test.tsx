import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandPalette } from '../components/CommandPalette'

// Stub the API layer so the palette doesn't try to fetch.
vi.mock('../api', () => ({
  searchDocuments: vi.fn(async () => []),
  listWidgets: vi.fn(async () => []),
}))

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('<CommandPalette />', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      withProviders(<CommandPalette open={false} onClose={() => {}} />),
    )
    expect(html).not.toContain('명령 팔레트')
  })

  it('renders the modal dialog when open with seed query', () => {
    const html = renderToStaticMarkup(
      withProviders(
        <CommandPalette open onClose={() => {}} initialQuery="kpi" />,
      ),
    )
    expect(html).toContain('명령 팔레트')
    // Tab labels are present.
    expect(html).toContain('문서')
    expect(html).toContain('위젯')
    // Footer hint references ⌘K shortcut help.
    expect(html).toContain('Esc')
  })
})
