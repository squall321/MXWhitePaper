import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SnippetPicker } from '../SnippetPicker'

vi.mock('../api', () => ({
  listSnippets: vi.fn(async () => [
    {
      id: 's-1',
      owner_user_id: 'u',
      scope: 'private',
      name: 'My snippet',
      description: '결산 서두',
      block_count: 2,
      preview: '안녕하세요.',
      tags: [],
      use_count: 4,
      created_at: null,
      updated_at: null,
    },
  ]),
  getSnippet: vi.fn(async () => ({
    id: 's-1',
    owner_user_id: 'u',
    scope: 'private',
    name: 'My snippet',
    description: null,
    blocks: [{ type: 'paragraph', id: 'b1', text: '안녕' }],
    tags: [],
    use_count: 5,
    created_at: null,
    updated_at: null,
  })),
}))

describe('<SnippetPicker />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the modal chrome and search input', () => {
    const html = renderToStaticMarkup(
      <SnippetPicker onClose={() => {}} onInsert={() => {}} />,
    )
    expect(html).toContain('data-testid="snippet-picker"')
    expect(html).toContain('data-testid="snippet-picker-search"')
    expect(html).toContain('내 스니펫')
    expect(html).toContain('팀')
    expect(html).toContain('조직 전체')
  })

  it('exposes scope tab testids', () => {
    const html = renderToStaticMarkup(
      <SnippetPicker onClose={() => {}} onInsert={() => {}} />,
    )
    expect(html).toContain('data-testid="snippet-picker-tab-mine"')
    expect(html).toContain('data-testid="snippet-picker-tab-team"')
    expect(html).toContain('data-testid="snippet-picker-tab-org"')
  })

  it('renders a close button', () => {
    const html = renderToStaticMarkup(
      <SnippetPicker onClose={() => {}} onInsert={() => {}} />,
    )
    expect(html).toContain('data-testid="snippet-picker-close"')
  })
})
