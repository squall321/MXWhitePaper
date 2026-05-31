/**
 * D6 polish — per-category unread tally helper that drives the drawer
 * filter chips. The component itself reads its data from the zustand
 * store, which doesn't survive renderToStaticMarkup (getServerSnapshot
 * ignores setState mutations), so we test the pure helper directly.
 */
import { describe, it, expect } from 'vitest'
import { tallyUnreadByFilter } from '../components/NotificationDrawer'
import type { NotificationItem } from '../store'

const item = (
  id: string,
  category: NotificationItem['category'],
  read: boolean,
): NotificationItem => ({
  id,
  message: id,
  category,
  createdAt: Number(id.slice(1)) || 0,
  read,
})

describe('tallyUnreadByFilter', () => {
  it('returns zeros across the board for an empty list', () => {
    expect(tallyUnreadByFilter([])).toEqual({ all: 0, system: 0, activity: 0, comment: 0 })
  })

  it('counts unread items per category and totals into `all`', () => {
    const items = [
      item('n1', 'system', false),
      item('n2', 'system', false),
      item('n3', 'activity', false),
      item('n4', 'comment', false),
      item('n5', 'comment', true), // read — must NOT count
    ]
    expect(tallyUnreadByFilter(items)).toEqual({
      all: 4,
      system: 2,
      activity: 1,
      comment: 1,
    })
  })

  it('ignores nulls / falsy entries defensively', () => {
    // Defensive coverage — hand-edited localStorage payloads can leak
    // null rows through readFromStorage's filter on Array.isArray.
    const items = [
      item('n1', 'comment', false),
      null as unknown as NotificationItem,
      item('n2', 'comment', false),
    ]
    expect(tallyUnreadByFilter(items)).toEqual({
      all: 2,
      system: 0,
      activity: 0,
      comment: 2,
    })
  })

  it('scales to large unread queues — caller decides how to display 100+', () => {
    const items = Array.from({ length: 120 }, (_, i) =>
      item(`n${i + 1}`, 'comment', false),
    )
    const tally = tallyUnreadByFilter(items)
    expect(tally.all).toBe(120)
    expect(tally.comment).toBe(120)
  })
})
