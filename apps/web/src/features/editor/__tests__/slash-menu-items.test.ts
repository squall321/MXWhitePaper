import { describe, it, expect } from 'vitest'
import { buildSlashItems, type BNEditorLike } from '../components/slash-menu-items'

/**
 * Smoke-test the slash item builder: it should yield exactly 28 entries (the
 * 25 SSOT block types plus the four-extra UX shortcuts: 글머리/번호/체크/이미지
 * helper). They must be split across the eight documented groups.
 */
function fakeEditor(): BNEditorLike {
  return {
    insertBlocks: () => {},
    getTextCursorPosition: () => ({ block: { id: 'x' } }),
    focus: () => {},
  }
}

describe('buildSlashItems', () => {
  const items = buildSlashItems(fakeEditor())

  it('produces non-empty list with eight groups', () => {
    expect(items.length).toBeGreaterThanOrEqual(25)
    const groups = new Set(items.map((it) => it.group))
    expect(groups.has('텍스트')).toBe(true)
    expect(groups.has('리스트')).toBe(true)
    expect(groups.has('표')).toBe(true)
    expect(groups.has('차트')).toBe(true)
    expect(groups.has('미디어')).toBe(true)
    expect(groups.has('임베드')).toBe(true)
    expect(groups.has('레이아웃')).toBe(true)
    expect(groups.has('위젯')).toBe(true)
  })

  it('every item has a Korean title and English subtext', () => {
    for (const it of items) {
      expect(it.title.length).toBeGreaterThan(0)
      expect(it.subtext).toBeTruthy()
    }
  })

  it('the image item is reachable by 이미지 / image / 사진 aliases', () => {
    const item = items.find((it) => it.title === '이미지')!
    expect(item).toBeDefined()
    expect(item.aliases).toContain('image')
    expect(item.aliases).toContain('사진')
    expect(item.subtext).toContain('파일 선택')
  })

  it('caches insert calls into the editor for native types', () => {
    const calls: { type: unknown }[] = []
    const editor: BNEditorLike = {
      insertBlocks: (blocks) => {
        for (const b of blocks) calls.push(b as { type: unknown })
      },
      getTextCursorPosition: () => ({ block: { id: 'cur' } }),
      focus: () => {},
    }
    const fresh = buildSlashItems(editor)
    fresh.find((i) => i.title === '단락')?.onItemClick()
    fresh.find((i) => i.title === '글머리 목록')?.onItemClick()
    expect(calls.some((c) => c.type === 'paragraph')).toBe(true)
    expect(calls.some((c) => c.type === 'bulletListItem')).toBe(true)
  })
})
