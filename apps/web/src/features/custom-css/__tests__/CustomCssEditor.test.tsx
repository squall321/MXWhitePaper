import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/editor/api', () => ({
  patchCustomCss: vi.fn(),
  isPreconditionFailed: vi.fn(() => false),
}))

import { CustomCssEditor } from '../CustomCssEditor'

describe('<CustomCssEditor />', () => {
  it('renders the textarea, save button, and preview iframe', () => {
    const html = renderToStaticMarkup(
      <CustomCssEditor
        slug={'sample' as never}
        initialCss=".doc-title { color: #1428a0; }"
        etag={'W/"id-1"'}
      />,
    )
    expect(html).toContain('data-testid="custom-css-editor"')
    expect(html).toContain('data-testid="custom-css-textarea"')
    expect(html).toContain('data-testid="custom-css-save"')
    expect(html).toContain('data-testid="custom-css-preview"')
  })

  it('shows the admin-only blast-radius warning notice', () => {
    const html = renderToStaticMarkup(
      <CustomCssEditor
        slug={'sample' as never}
        initialCss=""
        etag={'W/"id-1"'}
      />,
    )
    // Korean copy from the editor — confirms the "applies to whole page"
    // warning surfaces by default.
    expect(html).toContain('전체 렌더링 페이지')
  })

  it('seeds the textarea with the initial CSS', () => {
    const html = renderToStaticMarkup(
      <CustomCssEditor
        slug={'sample' as never}
        initialCss=".x { color: red; }"
        etag={'W/"id-1"'}
      />,
    )
    expect(html).toContain('.x { color: red; }')
  })
})
