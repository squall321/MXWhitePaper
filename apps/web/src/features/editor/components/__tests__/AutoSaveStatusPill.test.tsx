import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AutoSaveStatusPill, formatRelative } from '../AutoSaveStatusPill'

/**
 * The pill has 4 visual states; we drive each via the `override` prop so the
 * tests don't depend on `useSyncExternalStore` / Zustand subscriptions
 * during static rendering.
 */
describe('<AutoSaveStatusPill /> visual states', () => {
  const NOW = 1_700_000_000_000

  it('idle — renders ✓ + relative timestamp + emerald palette', () => {
    const html = renderToStaticMarkup(
      <AutoSaveStatusPill
        override={{ kind: 'idle', lastSavedAt: NOW - 2 * 60_000 }}
        nowOverride={NOW}
      />,
    )
    expect(html).toContain('data-status="idle"')
    expect(html).toContain('저장됨 2분 전')
    expect(html).toContain('✓')
    expect(html).toContain('emerald')
  })

  it('idle — renders "방금 전" when saved within the last 5s', () => {
    const html = renderToStaticMarkup(
      <AutoSaveStatusPill
        override={{ kind: 'idle', lastSavedAt: NOW - 1_000 }}
        nowOverride={NOW}
      />,
    )
    expect(html).toContain('방금 전')
  })

  it('idle — renders "아직 저장 안됨" when lastSavedAt is null', () => {
    const html = renderToStaticMarkup(
      <AutoSaveStatusPill
        override={{ kind: 'idle', lastSavedAt: null }}
        nowOverride={NOW}
      />,
    )
    expect(html).toContain('아직 저장 안됨')
  })

  it('saving — renders 💾 + spinner + smsg palette', () => {
    const html = renderToStaticMarkup(
      <AutoSaveStatusPill override={{ kind: 'saving' }} nowOverride={NOW} />,
    )
    expect(html).toContain('data-status="saving"')
    expect(html).toContain('저장 중')
    expect(html).toContain('💾')
    expect(html).toContain('animate-spin')
    expect(html).toContain('smsg')
  })

  it('offline — renders 📡 + pending count + amber palette', () => {
    const html = renderToStaticMarkup(
      <AutoSaveStatusPill
        override={{ kind: 'offline', pendingMutations: 3 }}
        nowOverride={NOW}
      />,
    )
    expect(html).toContain('data-status="offline"')
    expect(html).toContain('오프라인 — 3개 변경 대기 중')
    expect(html).toContain('📡')
    expect(html).toContain('amber')
  })

  it('conflict — renders ⚠ + click handler + red palette', () => {
    const html = renderToStaticMarkup(
      <AutoSaveStatusPill
        override={{ kind: 'conflict' }}
        onConflictClick={() => undefined}
        nowOverride={NOW}
      />,
    )
    expect(html).toContain('data-status="conflict"')
    expect(html).toContain('충돌 — 새로고침 필요')
    expect(html).toContain('⚠')
    expect(html).toContain('red')
    // Interactive: rendered as a <button>
    expect(html).toMatch(/<button[^>]+data-status="conflict"/)
  })

  it('idle — tooltip carries absolute timestamp + version', () => {
    const html = renderToStaticMarkup(
      <AutoSaveStatusPill
        override={{ kind: 'idle', lastSavedAt: NOW - 60_000, version: 12 }}
        nowOverride={NOW}
      />,
    )
    expect(html).toContain('v12')
    // tooltip is rendered via title="…"
    expect(html).toMatch(/title="[^"]*v12"/)
  })
})

describe('formatRelative()', () => {
  const NOW = 1_700_000_000_000
  it('clamps negative deltas to "방금 전"', () => {
    expect(formatRelative(NOW + 5_000, NOW)).toBe('방금 전')
  })
  it('seconds bucket', () => {
    expect(formatRelative(NOW - 30_000, NOW)).toBe('30초 전')
  })
  it('minutes bucket', () => {
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe('5분 전')
  })
  it('hours bucket', () => {
    expect(formatRelative(NOW - 2 * 3_600_000, NOW)).toBe('2시간 전')
  })
  it('days bucket', () => {
    expect(formatRelative(NOW - 3 * 86_400_000, NOW)).toBe('3일 전')
  })
  it('null savedAt → "아직 저장 안됨"', () => {
    expect(formatRelative(null, NOW)).toBe('아직 저장 안됨')
  })
})
