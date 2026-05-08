import { describe, it, expect, beforeEach } from 'vitest'
import { useBulkSelectionStore } from '../bulkSelectionStore'

/**
 * The store is purely in-memory (no localStorage), so we just reset state
 * between tests to keep them independent.
 */

describe('bulkSelectionStore', () => {
  beforeEach(() => {
    useBulkSelectionStore.setState({ selected: new Set<string>() })
  })

  it('starts empty', () => {
    expect(useBulkSelectionStore.getState().size()).toBe(0)
    expect(useBulkSelectionStore.getState().isSelected('any')).toBe(false)
  })

  it('toggle() flips membership', () => {
    const s = useBulkSelectionStore.getState()
    s.toggle('a')
    expect(useBulkSelectionStore.getState().isSelected('a')).toBe(true)
    expect(useBulkSelectionStore.getState().size()).toBe(1)
    s.toggle('a')
    expect(useBulkSelectionStore.getState().isSelected('a')).toBe(false)
    expect(useBulkSelectionStore.getState().size()).toBe(0)
  })

  it('toggle() ignores empty strings', () => {
    useBulkSelectionStore.getState().toggle('')
    expect(useBulkSelectionStore.getState().size()).toBe(0)
  })

  it('setMany() replaces the selection in one shot', () => {
    const s = useBulkSelectionStore.getState()
    s.toggle('a')
    s.setMany(['b', 'c'])
    expect(useBulkSelectionStore.getState().isSelected('a')).toBe(false)
    expect(useBulkSelectionStore.getState().isSelected('b')).toBe(true)
    expect(useBulkSelectionStore.getState().isSelected('c')).toBe(true)
    expect(useBulkSelectionStore.getState().size()).toBe(2)
  })

  it('setMany() filters empty / non-string entries', () => {
    useBulkSelectionStore
      .getState()
      .setMany(['ok', '', null as unknown as string, undefined as unknown as string])
    expect(useBulkSelectionStore.getState().size()).toBe(1)
    expect(useBulkSelectionStore.getState().isSelected('ok')).toBe(true)
  })

  it('clear() empties the selection', () => {
    const s = useBulkSelectionStore.getState()
    s.setMany(['x', 'y', 'z'])
    s.clear()
    expect(useBulkSelectionStore.getState().size()).toBe(0)
  })

  it('clear() is a no-op when already empty', () => {
    const before = useBulkSelectionStore.getState().selected
    useBulkSelectionStore.getState().clear()
    const after = useBulkSelectionStore.getState().selected
    // No new Set instance created — state unchanged.
    expect(after).toBe(before)
  })

  it('isSelected() reflects current state without side effects', () => {
    useBulkSelectionStore.getState().toggle('m')
    expect(useBulkSelectionStore.getState().isSelected('m')).toBe(true)
    expect(useBulkSelectionStore.getState().isSelected('z')).toBe(false)
  })

  it('size() reflects the number of distinct selected ids', () => {
    const s = useBulkSelectionStore.getState()
    s.setMany(['a', 'b', 'a'])
    expect(useBulkSelectionStore.getState().size()).toBe(2)
  })

  it('toggling an existing id leaves other entries intact', () => {
    const s = useBulkSelectionStore.getState()
    s.setMany(['a', 'b', 'c'])
    s.toggle('b')
    expect(useBulkSelectionStore.getState().isSelected('a')).toBe(true)
    expect(useBulkSelectionStore.getState().isSelected('b')).toBe(false)
    expect(useBulkSelectionStore.getState().isSelected('c')).toBe(true)
    expect(useBulkSelectionStore.getState().size()).toBe(2)
  })
})
