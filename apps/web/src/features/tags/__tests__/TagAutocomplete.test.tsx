import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TagAutocomplete } from '../TagAutocomplete'

vi.mock('../api', () => ({
  listTags: vi.fn(async () => [
    { name: 'kpi', count: 5 },
    { name: 'release', count: 3 },
  ]),
}))

describe('<TagAutocomplete />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders existing chips', () => {
    const html = renderToStaticMarkup(
      <TagAutocomplete value={['kpi', 'release']} onChange={() => {}} />,
    )
    expect(html).toContain('#kpi')
    expect(html).toContain('#release')
    // Two chip buttons + the input.
    expect(html).toContain('data-testid="tag-chip"')
  })

  it('renders the input with the provided placeholder when empty', () => {
    const html = renderToStaticMarkup(
      <TagAutocomplete value={[]} onChange={() => {}} placeholder="add a tag" />,
    )
    expect(html).toContain('placeholder="add a tag"')
  })

  it('passes a stable testid for the suggestion list region', () => {
    const html = renderToStaticMarkup(
      <TagAutocomplete value={[]} onChange={() => {}} data-testid="my-tags" />,
    )
    expect(html).toContain('data-testid="my-tags"')
  })
})
