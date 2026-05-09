import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PdfBlockView } from '../PdfBlock'
import type { PdfBlock } from '@/types/document'

const FILE_ID = '01TESTFILE0000000000000PD1'

function render(block: PdfBlock): string {
  return renderToStaticMarkup(<PdfBlockView block={block} />)
}

describe('<PdfBlockView />', () => {
  it('renders an iframe pointed at the file download endpoint', () => {
    const html = render({
      type: 'pdf',
      id: '01TESTBLOCK0000000000000P1',
      file_id: FILE_ID,
    })
    // Browser-native PDF viewer — iframe with the canonical download URL.
    expect(html).toContain('<iframe')
    expect(html).toContain(`/api/v1/files/${FILE_ID}/download`)
    // Default height applied when height_px is omitted.
    expect(html).toContain('height="600"')
  })

  it('appends `#page=N` when a starting page > 1 is set', () => {
    const html = render({
      type: 'pdf',
      id: '01TESTBLOCK0000000000000P2',
      file_id: FILE_ID,
      page: 7,
    })
    expect(html).toContain(`/api/v1/files/${FILE_ID}/download#page=7`)
  })

  it('omits the fragment when page is 1 (default)', () => {
    const html = render({
      type: 'pdf',
      id: '01TESTBLOCK0000000000000P3',
      file_id: FILE_ID,
      page: 1,
    })
    expect(html).not.toContain('#page=')
  })

  it('honours custom height_px on the iframe', () => {
    const html = render({
      type: 'pdf',
      id: '01TESTBLOCK0000000000000P4',
      file_id: FILE_ID,
      height_px: 1200,
    })
    expect(html).toContain('height="1200"')
  })

  it('shows the title above and a 다운로드 link', () => {
    const html = render({
      type: 'pdf',
      id: '01TESTBLOCK0000000000000P5',
      file_id: FILE_ID,
      title: '사내 SOP v3.2',
    })
    expect(html).toContain('사내 SOP v3.2')
    expect(html).toContain('다운로드')
    // Download anchor points at the bare endpoint (no fragment) and uses
    // `download` so the browser saves rather than opens.
    expect(html).toContain(`href="/api/v1/files/${FILE_ID}/download"`)
    expect(html).toMatch(/download(="")?/)
  })

  it('falls back to a generic title when none is provided', () => {
    const html = render({
      type: 'pdf',
      id: '01TESTBLOCK0000000000000P6',
      file_id: FILE_ID,
    })
    expect(html).toContain('PDF 문서')
  })

  it('encodes file_id when building URLs', () => {
    const html = render({
      type: 'pdf',
      id: '01TESTBLOCK0000000000000P7',
      // Hypothetical edge case: an id with a / which must be percent-encoded.
      file_id: 'has/slash',
    })
    expect(html).toContain('/api/v1/files/has%2Fslash/download')
  })
})
