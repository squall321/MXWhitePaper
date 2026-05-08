import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { RecentRail, formatRelative } from '../components/RecentRail'

/**
 * SSR markup checks for the rail. The component takes an `items` prop so we
 * don't have to seed the Zustand store from the test runner (which lacks a
 * DOM by default).
 */
describe('<RecentRail />', () => {
  it('shows the empty state when items is an empty array', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RecentRail items={[]} />
      </MemoryRouter>,
    )
    expect(html).toContain('아직 본 문서가 없어요')
    expect(html).toContain('메인에서 카드를 클릭해 보세요.')
    // The "전체 보기" link is hidden when there's nothing to look at.
    expect(html).not.toContain('전체 보기')
  })

  it('renders titles and links to /docs/<slug> when populated', () => {
    const items = [
      { slug: 'foo-bar', title: 'Foo 백서', viewedAt: Date.now() },
      { slug: 'baz', title: 'Baz 결산', viewedAt: Date.now() - 60_000 },
    ]
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RecentRail items={items} />
      </MemoryRouter>,
    )
    expect(html).toContain('Foo 백서')
    expect(html).toContain('Baz 결산')
    expect(html).toContain('href="/docs/foo-bar"')
    expect(html).toContain('href="/docs/baz"')
    expect(html).toContain('전체 보기')
  })

  it('caps the visible list to `max`', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      slug: `s-${i}`,
      title: `Doc ${i}`,
      viewedAt: Date.now() - i,
    }))
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RecentRail items={items} max={3} />
      </MemoryRouter>,
    )
    expect(html).toContain('Doc 0')
    expect(html).toContain('Doc 1')
    expect(html).toContain('Doc 2')
    expect(html).not.toContain('Doc 3')
  })

  it('hides the "전체 보기" link when showSeeAll=false', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RecentRail
          showSeeAll={false}
          items={[{ slug: 'a', title: 'A', viewedAt: Date.now() }]}
        />
      </MemoryRouter>,
    )
    expect(html).not.toContain('전체 보기')
  })
})

describe('formatRelative()', () => {
  const NOW = new Date('2026-05-08T12:00:00Z').getTime()

  it('returns 방금 전 within the first minute', () => {
    expect(formatRelative(NOW - 30 * 1000, NOW)).toBe('방금 전')
  })

  it('returns minutes ago for sub-hour deltas', () => {
    expect(formatRelative(NOW - 5 * 60 * 1000, NOW)).toBe('5분 전')
  })

  it('returns hours ago for sub-day deltas', () => {
    expect(formatRelative(NOW - 3 * 60 * 60 * 1000, NOW)).toBe('3시간 전')
  })

  it('returns 어제 between 24h and 48h', () => {
    expect(formatRelative(NOW - 30 * 60 * 60 * 1000, NOW)).toBe('어제')
  })

  it('returns N일 전 for the rest of the week', () => {
    expect(formatRelative(NOW - 4 * 24 * 60 * 60 * 1000, NOW)).toBe('4일 전')
  })
})
