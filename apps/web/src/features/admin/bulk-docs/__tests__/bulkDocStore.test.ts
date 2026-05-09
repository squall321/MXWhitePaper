import { describe, it, expect, beforeEach } from 'vitest'
import { useBulkDocStore } from '../bulkDocStore'

/**
 * `bulkDocStore` is a thin slug-keyed mirror of the editor's
 * `bulkSelectionStore`. The contract: pure in-memory, no localStorage,
 * size() / isSelected() reflect the live `selected: Set<string>`.
 */

describe('bulkDocStore', () => {
  beforeEach(() => {
    useBulkDocStore.setState({ selected: new Set<string>() })
  })

  it('starts empty', () => {
    expect(useBulkDocStore.getState().size()).toBe(0)
    expect(useBulkDocStore.getState().isSelected('any')).toBe(false)
  })

  it('toggle() flips membership', () => {
    const s = useBulkDocStore.getState()
    s.toggle('doc-a')
    expect(useBulkDocStore.getState().isSelected('doc-a')).toBe(true)
    expect(useBulkDocStore.getState().size()).toBe(1)
    s.toggle('doc-a')
    expect(useBulkDocStore.getState().isSelected('doc-a')).toBe(false)
    expect(useBulkDocStore.getState().size()).toBe(0)
  })

  it('toggle() ignores empty slug', () => {
    useBulkDocStore.getState().toggle('')
    expect(useBulkDocStore.getState().size()).toBe(0)
  })

  it('setMany() replaces selection wholesale', () => {
    const s = useBulkDocStore.getState()
    s.toggle('doc-a')
    s.setMany(['doc-b', 'doc-c'])
    expect(useBulkDocStore.getState().isSelected('doc-a')).toBe(false)
    expect(useBulkDocStore.getState().isSelected('doc-b')).toBe(true)
    expect(useBulkDocStore.getState().isSelected('doc-c')).toBe(true)
    expect(useBulkDocStore.getState().size()).toBe(2)
  })

  it('setMany() filters empty / non-string entries', () => {
    useBulkDocStore
      .getState()
      .setMany(['ok', '', null as unknown as string, undefined as unknown as string])
    expect(useBulkDocStore.getState().size()).toBe(1)
    expect(useBulkDocStore.getState().isSelected('ok')).toBe(true)
  })

  it('setMany() ignores non-array input', () => {
    useBulkDocStore.getState().toggle('keep')
    useBulkDocStore.getState().setMany(undefined as unknown as string[])
    expect(useBulkDocStore.getState().isSelected('keep')).toBe(true)
  })

  it('clear() empties the selection', () => {
    const s = useBulkDocStore.getState()
    s.setMany(['x', 'y', 'z'])
    s.clear()
    expect(useBulkDocStore.getState().size()).toBe(0)
  })

  it('clear() is a no-op when already empty', () => {
    const before = useBulkDocStore.getState().selected
    useBulkDocStore.getState().clear()
    const after = useBulkDocStore.getState().selected
    expect(after).toBe(before)
  })

  it('size() dedupes within setMany input', () => {
    useBulkDocStore.getState().setMany(['a', 'b', 'a'])
    expect(useBulkDocStore.getState().size()).toBe(2)
  })

  it('toggling one slug leaves others intact', () => {
    const s = useBulkDocStore.getState()
    s.setMany(['a', 'b', 'c'])
    s.toggle('b')
    expect(useBulkDocStore.getState().isSelected('a')).toBe(true)
    expect(useBulkDocStore.getState().isSelected('b')).toBe(false)
    expect(useBulkDocStore.getState().isSelected('c')).toBe(true)
    expect(useBulkDocStore.getState().size()).toBe(2)
  })
})
