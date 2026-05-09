/**
 * PresenceAvatars — happy path: a few users => a few avatar buttons; when
 * more than 5 → "+N" overflow badge; empty list → renders nothing.
 *
 * `usePresence` is mocked so we can directly seed the `others` array.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const usePresence = vi.fn()

vi.mock('../usePresence', () => ({
  usePresence: (...args: unknown[]) => usePresence(...args),
}))

import { PresenceAvatars } from '../PresenceAvatars'

beforeEach(() => {
  usePresence.mockReset()
})

describe('<PresenceAvatars />', () => {
  it('renders nothing when nobody else is here', () => {
    usePresence.mockReturnValue({ others: [], iAmHere: false })
    const html = renderToStaticMarkup(<PresenceAvatars slug="doc-1" />)
    expect(html).toBe('')
  })

  it('renders one avatar per other user', () => {
    usePresence.mockReturnValue({
      others: [
        {
          user_id: 'u1',
          name: 'Alice',
          anchor_block_id: '01A',
          last_seen: 0,
        },
        {
          user_id: 'u2',
          name: '한별',
          anchor_block_id: null,
          last_seen: 0,
        },
      ],
      iAmHere: true,
    })
    const html = renderToStaticMarkup(<PresenceAvatars slug="doc-1" />)
    expect(html).toContain('data-testid="presence-avatars"')
    expect(html).toContain('data-testid="presence-avatar-u1"')
    expect(html).toContain('data-testid="presence-avatar-u2"')
    expect(html).toContain('Alice님이 보고 있습니다')
    expect(html).toContain('한별님이 보고 있습니다')
    expect(html).not.toContain('presence-overflow')
  })

  it('caps at 5 visible avatars and shows a +N overflow badge', () => {
    const others = Array.from({ length: 8 }).map((_, i) => ({
      user_id: `u${i}`,
      name: `User${i}`,
      anchor_block_id: null,
      last_seen: 0,
    }))
    usePresence.mockReturnValue({ others, iAmHere: true })
    const html = renderToStaticMarkup(<PresenceAvatars slug="doc-1" />)
    // Only the first 5 user_ids should appear as avatar testids.
    expect(html).toContain('data-testid="presence-avatar-u0"')
    expect(html).toContain('data-testid="presence-avatar-u4"')
    expect(html).not.toContain('data-testid="presence-avatar-u5"')
    expect(html).toContain('data-testid="presence-overflow"')
    expect(html).toContain('+3')
  })

  it('falls back to a question mark when name is empty', () => {
    usePresence.mockReturnValue({
      others: [
        { user_id: 'ghost', name: '', anchor_block_id: null, last_seen: 0 },
      ],
      iAmHere: true,
    })
    const html = renderToStaticMarkup(<PresenceAvatars slug="doc-1" />)
    expect(html).toContain('data-testid="presence-avatar-ghost"')
    expect(html).toMatch(/>\?</)
  })

  it('renders nothing when slug is undefined and others is empty', () => {
    usePresence.mockReturnValue({ others: [], iAmHere: false })
    const html = renderToStaticMarkup(<PresenceAvatars slug={undefined} />)
    expect(html).toBe('')
  })
})
