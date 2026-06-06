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

  it('button labels show emoji affordances (with aria-hidden wrappers)', () => {
    const html = renderToStaticMarkup(
      <DrillExportControls
        buildCsv={() => ''}
        buildTsv={() => ''}
        filename="x"
        testIdPrefix="p"
      />,
    )
    // emoji 는 <span aria-hidden> 으로 분리되었지만 화면엔 보임 — text + emoji 각각 확인
    expect(html).toContain('📥')
    expect(html).toContain('CSV')
    expect(html).toContain('TSV')
    expect(html).toContain('📋')
    expect(html).toContain('Copy')
    // a11y: emoji wrapper 가 aria-hidden
    expect(html).toMatch(/<span aria-hidden="true">📥/)
  })

  it('exposes aria-label on each button (Fix C — emoji button accessibility)', () => {
    const html = renderToStaticMarkup(
      <DrillExportControls
        buildCsv={() => ''}
        buildTsv={() => ''}
        filename="x"
        testIdPrefix="p"
      />,
    )
    expect(html).toContain('aria-label="UTF-8 BOM 포함 CSV 다운로드"')
    expect(html).toContain('aria-label="UTF-8 BOM 포함 TSV 다운로드"')
    expect(html).toContain('aria-label="TSV 를 클립보드로 복사"')
  })

  it('renders an aria-live polite status region for copy state changes', () => {
    const html = renderToStaticMarkup(
      <DrillExportControls
        buildCsv={() => ''}
        buildTsv={() => ''}
        filename="x"
        testIdPrefix="p"
      />,
    )
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="status"')
    expect(html).toContain('data-testid="p-status"')
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

// Fix B 의 timer cleanup 은 useRef + useEffect 표준 패턴이라 unit-test 보다
// 패턴 자체로 안전성을 확보 (vitest 에 RTL 미설치). 회귀 방지를 위해
// DrillExportControls 의 *코드 패턴* 만 검증:
//   - useRef<number | null> 필드 존재
//   - useEffect cleanup 에 clearTimeout 호출
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('<DrillExportControls /> — copy flash timer cleanup pattern (Fix B)', () => {
  const src = readFileSync(
    resolve(__dirname, '../DrillExportControls.tsx'),
    'utf-8',
  )
  it('uses useRef for the flash timer (race-free reset)', () => {
    expect(src).toMatch(/flashTimer\s*=\s*useRef<number\s*\|\s*null>/)
  })
  it('clears the timer in a useEffect cleanup (unmount-safe)', () => {
    // useEffect with return cleanup that calls clearTimeout(flashTimer.current)
    expect(src).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*return\s*\(\)\s*=>\s*\{[\s\S]*?clearTimeout\(flashTimer\.current\)/)
  })
  it('cancels the previous timer before scheduling a new one (race-free)', () => {
    // 두 호출 사이에 주석이 들어가도 매칭하도록 [\s\S]*? 로 완화.
    expect(src).toMatch(/if\s*\(flashTimer\.current\s*!==\s*null\)\s*window\.clearTimeout\(flashTimer\.current\)[\s\S]*?flashTimer\.current\s*=\s*window\.setTimeout/)
  })
})
