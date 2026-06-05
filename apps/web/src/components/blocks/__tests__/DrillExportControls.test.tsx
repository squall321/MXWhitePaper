/**
 * N — DrillExportControls SSR test.
 *
 * 4 drill modal 이 공유하는 3-button strip (CSV / TSV / Copy).
 * SSR 에서는 button 의 존재 + testid + title 만 검증 (download/clipboard
 * 는 jsdom 환경에서만 verify 가능 — tsvAndClipboard.test.ts 가 담당).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrillExportControls } from '../DrillExportControls'

describe('<DrillExportControls />', () => {
  it('renders 3 buttons with the configured testIdPrefix', () => {
    const html = renderToStaticMarkup(
      <DrillExportControls
        buildCsv={() => 'a,b'}
        buildTsv={() => 'a\tb'}
        filename="x"
        testIdPrefix="myprefix"
      />,
    )
    expect(html).toContain('data-testid="myprefix-csv"')
    expect(html).toContain('data-testid="myprefix-tsv"')
    expect(html).toContain('data-testid="myprefix-copy"')
  })

  it('button labels show emoji affordances', () => {
    const html = renderToStaticMarkup(
      <DrillExportControls
        buildCsv={() => ''}
        buildTsv={() => ''}
        filename="x"
        testIdPrefix="p"
      />,
    )
    expect(html).toContain('📥 CSV')
    expect(html).toContain('📥 TSV')
    expect(html).toContain('📋 Copy')
  })

  it('title attributes explain Excel compatibility intent', () => {
    const html = renderToStaticMarkup(
      <DrillExportControls
        buildCsv={() => ''}
        buildTsv={() => ''}
        filename="x"
        testIdPrefix="p"
      />,
    )
    expect(html).toMatch(/title="UTF-8 BOM[^"]*CSV/)
    expect(html).toMatch(/title="UTF-8 BOM[^"]*TSV/)
    expect(html).toMatch(/title="TSV[^"]*클립보드/)
  })
})
