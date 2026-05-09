import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandPalette } from '../components/CommandPalette'

// Stub the API layer so the palette doesn't try to fetch.
vi.mock('../api', () => ({
  searchDocuments: vi.fn(async () => []),
  listWidgets: vi.fn(async () => []),
  searchSuggest: vi.fn(async () => ({
    tags: [],
    authors: [],
    parts: [],
    documents: [],
  })),
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

  it('renders all three tabs (문서 / 위젯 / 명령)', () => {
    const html = renderToStaticMarkup(
      withProviders(<CommandPalette open onClose={() => {}} />),
    )
    expect(html).toContain('문서')
    expect(html).toContain('위젯')
    expect(html).toContain('명령')
  })

  it('exposes the combobox + listbox ARIA wiring', () => {
    const html = renderToStaticMarkup(
      withProviders(<CommandPalette open onClose={() => {}} />),
    )
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-expanded')
    expect(html).toContain('aria-controls')
    expect(html).toContain('aria-autocomplete="list"')
  })

  it('renders the keyboard hint footer with ⌘ Enter / Tab', () => {
    const html = renderToStaticMarkup(
      withProviders(<CommandPalette open onClose={() => {}} />),
    )
    expect(html).toContain('Tab')
    expect(html).toContain('⌘ Enter')
  })

  it('renders the recent-search empty state when no query', () => {
    const html = renderToStaticMarkup(
      withProviders(<CommandPalette open onClose={() => {}} />),
    )
    // No recent items initially → placeholder copy.
    expect(html).toContain('검색어를 입력하세요')
  })

  it('renders the new 태그 / 사람 tabs (cycle 5 J3)', () => {
    const html = renderToStaticMarkup(
      withProviders(<CommandPalette open onClose={() => {}} />),
    )
    expect(html).toContain('태그')
    expect(html).toContain('사람')
  })

  it('preserves existing 문서 / 위젯 / 명령 tabs', () => {
    const html = renderToStaticMarkup(
      withProviders(<CommandPalette open onClose={() => {}} />),
    )
    expect(html).toContain('문서')
    expect(html).toContain('위젯')
    expect(html).toContain('명령')
  })
})
