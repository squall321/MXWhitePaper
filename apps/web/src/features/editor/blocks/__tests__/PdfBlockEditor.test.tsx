import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PdfBlockEditor, clampHeight } from '../PdfBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { PdfBlock } from '@/types/document'

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

const SLUG = 'demo-doc'
const FILE_ID = '01TESTFILE0000000000000PE1'

const baseBlock: PdfBlock = {
  type: 'pdf',
  id: '01EDITORBLOCK0000000000PE1',
  file_id: FILE_ID,
  title: 'MX SOP',
  page: 4,
  height_px: 720,
}

describe('clampHeight', () => {
  it('clamps below 200 to 200', () => {
    expect(clampHeight(50)).toBe(200)
    expect(clampHeight(-1)).toBe(200)
  })

  it('clamps above 4000 to 4000', () => {
    expect(clampHeight(9999)).toBe(4000)
  })

  it('rounds floats inside the range', () => {
    expect(clampHeight(600.7)).toBe(601)
    expect(clampHeight(200.0)).toBe(200)
  })
})

describe('<PdfBlockEditor /> smoke', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    // Editor short-circuits the network when etag is empty, so populate it so
    // future patch attempts (none in SSR here) at least have a target.
    useEditorStore.setState({ slug: SLUG, etag: 'etag-test' })
  })

  it('renders title input + page + height controls + iframe preview', () => {
    const html = renderToStaticMarkup(
      harness(<PdfBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html.length).toBeGreaterThan(0)
    // Title input pre-populated.
    expect(html).toContain('MX SOP')
    // Page + height labels surfaced.
    expect(html).toContain('시작 페이지')
    expect(html).toContain('높이 (px)')
    // Live iframe targets the download endpoint with the page fragment.
    expect(html).toContain(`/api/v1/files/${FILE_ID}/download#page=4`)
    // Hidden file input restricted to PDFs (so the OS picker filters).
    expect(html).toContain('accept="application/pdf"')
    // Replace button surfaces because file_id is set.
    expect(html).toContain('교체')
  })

  it('shows the empty-state hint when no file_id is set', () => {
    const empty: PdfBlock = { ...baseBlock, file_id: '' }
    const html = renderToStaticMarkup(
      harness(<PdfBlockEditor slug={SLUG} block={empty} />),
    )
    expect(html).toContain('PDF를 업로드하면 미리보기가 나타납니다.')
    // Upload (not Replace) when no file_id.
    expect(html).toContain('PDF 업로드')
  })
})
