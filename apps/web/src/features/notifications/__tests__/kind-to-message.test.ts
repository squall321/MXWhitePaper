import { describe, it, expect } from 'vitest'
import {
  buildMessage,
  categoryForKind,
  serverItemToStoreItem,
} from '../kindToMessage'
import type { NotificationServerItem } from '../api'

describe('notifications/kindToMessage · categoryForKind', () => {
  it('maps comment kinds to "comment"', () => {
    expect(categoryForKind('comment_mention')).toBe('comment')
    expect(categoryForKind('comment_reply')).toBe('comment')
  })
  it('maps review/reaction/reminder kinds to "activity"', () => {
    expect(categoryForKind('review_request')).toBe('activity')
    expect(categoryForKind('review_decision')).toBe('activity')
    expect(categoryForKind('reaction_added')).toBe('activity')
    expect(categoryForKind('read_ack_reminder')).toBe('activity')
    expect(categoryForKind('reminder')).toBe('activity')
  })
  it('maps retention/automation/unknown kinds to "system"', () => {
    expect(categoryForKind('retention_warning')).toBe('system')
    expect(categoryForKind('automation_blast')).toBe('system')
    expect(categoryForKind('made_up_kind_zzz')).toBe('system')
  })
})

describe('notifications/kindToMessage · buildMessage', () => {
  it('builds a comment_mention message with actor + doc title', () => {
    const { message } = buildMessage('comment_mention', {
      actor_name: '홍길동',
      doc_title: '배터리 안전 백서',
    })
    expect(message).toContain('홍길동')
    expect(message).toContain('언급')
    expect(message).toContain('배터리 안전 백서')
  })

  it('builds a review_request message', () => {
    const { message } = buildMessage('review_request', {
      actor_name: '김검토',
      title: 'Phase 2 보고서',
    })
    expect(message).toContain('김검토')
    expect(message).toContain('리뷰를 요청')
    expect(message).toContain('Phase 2 보고서')
  })

  it('builds a review_decision message with localised status', () => {
    const { message } = buildMessage('review_decision', {
      actor_name: '박결정',
      title: '검토 대상',
      status: 'approved',
    })
    expect(message).toContain('박결정')
    expect(message).toContain('승인')
  })

  it('builds a reaction_added message with emoji glyph', () => {
    const { message } = buildMessage('reaction_added', {
      actor_name: '이반응',
      emoji: 'thumbs-up',
      slug: 'doc-alpha',
    })
    expect(message).toContain('이반응')
    expect(message).toContain('👍')
  })

  it('builds a read_ack_reminder message', () => {
    const { message } = buildMessage('read_ack_reminder', {
      actor_name: '관리자',
      title: '보안 공지',
    })
    expect(message).toContain('관리자')
    expect(message).toContain('읽음 확인')
    expect(message).toContain('보안 공지')
  })

  it('falls back to "다른 사용자" + generic title when payload is sparse', () => {
    const { message } = buildMessage('comment_mention', {})
    expect(message).toContain('다른 사용자')
    expect(message).toContain('언급')
  })

  it('produces a generic message for unknown kinds rather than throwing', () => {
    const { message } = buildMessage('unknown_kind_xxx', { slug: 'x' })
    expect(message).toBeTruthy()
  })
})

describe('notifications/kindToMessage · serverItemToStoreItem', () => {
  function row(over: Partial<NotificationServerItem> = {}): NotificationServerItem {
    return {
      id: '11111111-1111-1111-1111-111111111111',
      user_id: '22222222-2222-2222-2222-222222222222',
      kind: 'comment_mention',
      payload: { slug: 'alpha', actor_name: '홍' },
      read_at: null,
      created_at: '2026-05-25T10:00:00Z',
      ...over,
    }
  }

  it('converts a server row preserving id + slug + read flag', () => {
    const out = serverItemToStoreItem(row())
    expect(out.id).toBe('11111111-1111-1111-1111-111111111111')
    expect(out.slug).toBe('alpha')
    expect(out.category).toBe('comment')
    expect(out.read).toBe(false)
    expect(out.createdAt).toBe(Date.parse('2026-05-25T10:00:00Z'))
  })

  it('marks read=true when read_at is set', () => {
    const out = serverItemToStoreItem(row({ read_at: '2026-05-25T11:00:00Z' }))
    expect(out.read).toBe(true)
  })

  it('falls back to Date.now() when created_at is null', () => {
    const before = Date.now()
    const out = serverItemToStoreItem(row({ created_at: null }))
    const after = Date.now()
    expect(out.createdAt).toBeGreaterThanOrEqual(before)
    expect(out.createdAt).toBeLessThanOrEqual(after)
  })
})
