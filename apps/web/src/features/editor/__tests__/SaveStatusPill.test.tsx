import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SaveStatusPill } from '../components/SaveStatusPill'

/**
 * The pill morphs by reading two store values: `dirty` + `autoSaveStatus`.
 * For SSR-friendly testing the component accepts optional `status` + `dirty`
 * props that bypass `useSyncExternalStore`. The label transitions match the
 * design table:
 *   idle + clean    → 동기화됨
 *   idle + dirty    → 입력 중…
 *   saving          → 저장 중…
 *   saved           → 저장됨 ✓
 *   error           → 저장 실패 ✗
 *   conflict        → 충돌 발생 ⚠
 */
describe('<SaveStatusPill /> state morph', () => {
  it('renders 동기화됨 when idle and clean', () => {
    const html = renderToStaticMarkup(<SaveStatusPill status="idle" dirty={false} />)
    expect(html).toContain('동기화됨')
    expect(html).toContain('data-status="idle"')
  })

  it('renders 입력 중… when idle and dirty', () => {
    const html = renderToStaticMarkup(<SaveStatusPill status="idle" dirty />)
    expect(html).toContain('입력 중')
    expect(html).toContain('data-status="typing"')
  })

  it('renders 저장 중… when saving', () => {
    const html = renderToStaticMarkup(<SaveStatusPill status="saving" dirty />)
    expect(html).toContain('저장 중')
    expect(html).toContain('data-status="saving"')
  })

  it('renders 저장됨 ✓ when saved (initial render is the success flash)', () => {
    const html = renderToStaticMarkup(<SaveStatusPill status="saved" dirty={false} />)
    expect(html).toContain('저장됨')
    expect(html).toContain('data-status="saved"')
  })

  it('renders 저장 실패 ✗ on error', () => {
    const html = renderToStaticMarkup(<SaveStatusPill status="error" dirty />)
    expect(html).toContain('저장 실패')
    expect(html).toContain('data-status="error"')
  })

  it('renders 충돌 발생 ⚠ on conflict', () => {
    const html = renderToStaticMarkup(<SaveStatusPill status="conflict" dirty />)
    expect(html).toContain('충돌 발생')
    expect(html).toContain('data-status="conflict"')
  })

  it('renders 수동 저장됨 when manualLabel is given', () => {
    const html = renderToStaticMarkup(
      <SaveStatusPill status="saved" dirty={false} manualLabel="수동 저장됨" />,
    )
    expect(html).toContain('수동 저장됨')
    expect(html).toContain('data-status="manual"')
  })
})
