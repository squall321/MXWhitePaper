/**
 * Sprint 6 (G2) — slicerStore unit tests.
 *
 * Pure store actions — no React rendering needed. We exercise the
 * single-select / multi-select / clear / setActive semantics directly,
 * resetting the store between cases.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useSlicerStore } from '../store'

beforeEach(() => {
  useSlicerStore.setState({ active: {} })
})

describe('slicerStore', () => {
  const id = 'SLICER1'

  it('initial: empty active map; getActive returns []', () => {
    expect(useSlicerStore.getState().getActive(id)).toEqual([])
  })

  it('setSingle: replaces the set with [value]; null clears the entry', () => {
    const s = useSlicerStore.getState()
    s.setSingle(id, 'A')
    expect(useSlicerStore.getState().active[id]).toEqual(['A'])
    s.setSingle(id, 'B')
    expect(useSlicerStore.getState().active[id]).toEqual(['B'])
    s.setSingle(id, null)
    expect(useSlicerStore.getState().active[id]).toBeUndefined()
  })

  it('toggle: adds when missing, removes when present, deletes entry when last value goes', () => {
    const s = useSlicerStore.getState()
    s.toggle(id, 'A')
    expect(useSlicerStore.getState().active[id]).toEqual(['A'])
    s.toggle(id, 'B')
    expect(useSlicerStore.getState().active[id]).toEqual(['A', 'B'])
    s.toggle(id, 'A')
    expect(useSlicerStore.getState().active[id]).toEqual(['B'])
    s.toggle(id, 'B')
    expect(useSlicerStore.getState().active[id]).toBeUndefined()
  })

  it('clear: no-op when slicer absent, removes entry when present', () => {
    const before = useSlicerStore.getState().active
    useSlicerStore.getState().clear(id)
    expect(useSlicerStore.getState().active).toEqual(before)
    useSlicerStore.getState().setSingle(id, 'A')
    useSlicerStore.getState().clear(id)
    expect(useSlicerStore.getState().active[id]).toBeUndefined()
  })

  it('setActive: empty array deletes the entry, non-empty replaces it (cloned)', () => {
    const s = useSlicerStore.getState()
    s.setActive(id, ['A', 'B'])
    expect(useSlicerStore.getState().active[id]).toEqual(['A', 'B'])
    s.setActive(id, [])
    expect(useSlicerStore.getState().active[id]).toBeUndefined()
    // Mutating the input after setActive should not affect the store
    const input = ['X', 'Y']
    s.setActive(id, input)
    input.push('Z')
    expect(useSlicerStore.getState().active[id]).toEqual(['X', 'Y'])
  })

  it('two slicer ids do not interfere', () => {
    const s = useSlicerStore.getState()
    s.setSingle('A', '1')
    s.setSingle('B', '2')
    expect(useSlicerStore.getState().active).toEqual({ A: ['1'], B: ['2'] })
    s.clear('A')
    expect(useSlicerStore.getState().active).toEqual({ B: ['2'] })
  })
})
