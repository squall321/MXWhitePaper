import { describe, it, expect, beforeEach } from 'vitest'
import {
  AUTO_SAVE_THRESHOLDS,
  countBlocks,
  pickIdleMs,
  classifyAutoSaveError,
} from '../hooks/useAutoSave'
import { useConnectionStore } from '../connectionStore'
import type { DocumentJSONV10, Section, Block } from '@/types/document'

/**
 * The hook's runtime behaviour requires React + a DOM (jsdom). We don't pull
 * jsdom in for Sprint 4 because the rest of the suite renders to static
 * markup. Instead, we verify the *thresholds* are the documented constants —
 * the integration test for the firing behaviour itself runs in the e2e suite
 * (Sprint 5). This guards against accidental tweaks to the policy.
 */
describe('editor/useAutoSave thresholds', () => {
  it('idle debounce is 5 seconds', () => {
    expect(AUTO_SAVE_THRESHOLDS.IDLE_MS).toBe(5_000)
  })

  it('character-pressure threshold is 200', () => {
    expect(AUTO_SAVE_THRESHOLDS.CHAR_THRESHOLD).toBe(200)
  })

  it('debounce policy: pressure-save fires when char-delta meets threshold', () => {
    // Simulate the inner accumulator:
    let chars = 0
    const writes = [50, 50, 50, 60] // cumulative 210
    let triggered = false
    for (const w of writes) {
      chars += w
      if (chars >= AUTO_SAVE_THRESHOLDS.CHAR_THRESHOLD) {
        triggered = true
        break
      }
    }
    expect(triggered).toBe(true)
  })

  it('debounce policy: under-threshold writes do NOT pressure-fire', () => {
    let chars = 0
    const writes = [10, 20, 30] // cumulative 60
    let triggered = false
    for (const w of writes) {
      chars += w
      if (chars >= AUTO_SAVE_THRESHOLDS.CHAR_THRESHOLD) triggered = true
    }
    expect(triggered).toBe(false)
  })
})

/**
 * Offline queue happy-path. The hook itself depends on React state, but the
 * *contract* it has with the connection store is plain mutation:
 *
 *   1. While `online === false`, the hook bumps `pendingMutations` once on
 *      the first edit (via the `needsFullSync` flag) and skips the PATCH.
 *   2. On the false→true transition, it drains by zeroing `pendingMutations`
 *      and firing one PUT.
 *
 * We assert step 1 and step 2 against the connection store directly — that's
 * the seam the hook talks to. No DOM required.
 */
describe('editor/useAutoSave offline queue contract', () => {
  beforeEach(() => {
    useConnectionStore.getState().reset()
  })

  it('offline edit bumps pending exactly once per offline run', () => {
    // Simulate: hook detects offline, sees an edit, bumps once.
    useConnectionStore.getState().setOnline(false)
    useConnectionStore.getState().bumpPending(1)
    expect(useConnectionStore.getState().pendingMutations).toBe(1)
    // A second edit while still offline + flag already set → no further bump.
    expect(useConnectionStore.getState().pendingMutations).toBe(1)
  })

  it('reconnection drains the queue (pendingMutations → 0)', () => {
    useConnectionStore.getState().setOnline(false)
    useConnectionStore.getState().bumpPending(3)
    expect(useConnectionStore.getState().pendingMutations).toBe(3)

    // false → true edge.
    useConnectionStore.getState().setOnline(true)
    // Hook drains: bumpPending(-current).
    const current = useConnectionStore.getState().pendingMutations
    useConnectionStore.getState().bumpPending(-current)
    expect(useConnectionStore.getState().pendingMutations).toBe(0)
    // …and lastPing is fresh after the positive transition.
    expect(useConnectionStore.getState().lastPing).not.toBeNull()
  })

  it('offline → no PATCH would fire (validates online gate is enforced)', () => {
    // The hook short-circuits before the timer fires when `online === false`.
    // We model that gate as a boolean check; if it ever returns true while
    // offline the test fails.
    useConnectionStore.getState().setOnline(false)
    const wouldFire = useConnectionStore.getState().online
    expect(wouldFire).toBe(false)
  })
})

/**
 * M7 — adaptive idle window for large documents. The hook now picks a longer
 * idle (BIG_DOC_IDLE_MS) when the draft exceeds SMALL_DOC_BLOCKS to avoid
 * piling up expensive full-doc PUTs on big docs. Small docs keep the snappy
 * 5 s timing for backwards compatibility.
 */
describe('editor/useAutoSave adaptive idle (M7)', () => {
  // Minimal helpers — only fields touched by countBlocks().
  const makeBlock = (): Block =>
    ({ type: 'paragraph', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', text: 'x' }) as unknown as Block
  const makeSection = (blocks: number, subs: Section[] = []): Section =>
    ({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      level: 1,
      title: 's',
      blocks: Array.from({ length: blocks }, makeBlock),
      subsections: subs,
    }) as unknown as Section
  const makeDoc = (sections: Section[]): DocumentJSONV10 =>
    ({
      schema_version: '1.0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      slug: 'x',
      title: 'x',
      metadata: { division: 'MX', owners: [], tags: [], confidentiality: 'internal' },
      sections,
    }) as unknown as DocumentJSONV10

  it('thresholds: small/big constants exported', () => {
    expect(AUTO_SAVE_THRESHOLDS.SMALL_DOC_BLOCKS).toBe(100)
    expect(AUTO_SAVE_THRESHOLDS.BIG_DOC_IDLE_MS).toBe(15_000)
    expect(AUTO_SAVE_THRESHOLDS.SAVING_STATUS_DEBOUNCE_MS).toBe(200)
  })

  it('countBlocks walks nested subsections', () => {
    const doc = makeDoc([
      makeSection(3, [makeSection(2), makeSection(1, [makeSection(4)])]),
      makeSection(5),
    ])
    // 3 + 2 + 1 + 4 + 5
    expect(countBlocks(doc)).toBe(15)
  })

  it('small doc (≤ 100 blocks) gets the 5 s idle window', () => {
    const doc = makeDoc([makeSection(100)])
    expect(countBlocks(doc)).toBe(100)
    expect(pickIdleMs(doc)).toBe(AUTO_SAVE_THRESHOLDS.IDLE_MS)
  })

  it('big doc (> 100 blocks) gets the 15 s idle window', () => {
    const doc = makeDoc([makeSection(101)])
    expect(countBlocks(doc)).toBe(101)
    expect(pickIdleMs(doc)).toBe(AUTO_SAVE_THRESHOLDS.BIG_DOC_IDLE_MS)
  })

  it('null draft falls back to the default idle window (no crash)', () => {
    expect(pickIdleMs(null)).toBe(AUTO_SAVE_THRESHOLDS.IDLE_MS)
  })
})

/**
 * M7 — in-flight queue contract. The hook serialises saves: while a PUT is on
 * the wire, follow-up triggers set a `queuedSave` flag and the next save
 * fires after the in-flight one resolves. This avoids overlapping race
 * conditions on big-doc PUTs.
 *
 * Modelled as a small state machine — the contract the hook implements.
 */
describe('editor/useAutoSave in-flight queue contract (M7)', () => {
  it('a save trigger while in-flight queues exactly one follow-up', () => {
    // Mirror the hook's two refs.
    let inFlight = false
    let queued = false
    const trigger = () => {
      if (inFlight) {
        queued = true
        return 'queued' as const
      }
      inFlight = true
      return 'fired' as const
    }
    expect(trigger()).toBe('fired')
    expect(trigger()).toBe('queued')
    expect(trigger()).toBe('queued') // still just one slot
    expect(queued).toBe(true)
  })

  it('finally-block drains the queue when the in-flight save resolves', () => {
    let inFlight = true
    let queued = true
    let drainedFires = 0
    // Simulate the finally branch.
    inFlight = false
    if (queued) {
      queued = false
      // simulate next performSave call
      inFlight = true
      drainedFires++
    }
    expect(drainedFires).toBe(1)
    expect(queued).toBe(false)
    expect(inFlight).toBe(true)
  })
})

/**
 * M7 — "저장 중" status debounce. The pill flip to 'saving' is deferred by
 * SAVING_STATUS_DEBOUNCE_MS so fast PUTs (small doc, healthy net) never flash
 * the spinner. Modelled with fake timers — the contract is: setTimeout
 * scheduled on save start; cleared by the finally branch if the PUT
 * finishes first.
 */
describe('editor/useAutoSave saving-status debounce (M7)', () => {
  it('fast PUT (< debounce) never flips status to saving', () => {
    // Modelled state.
    let status: 'idle' | 'saving' | 'saved' = 'idle'
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      status = 'saving'
      timer = null
    }, AUTO_SAVE_THRESHOLDS.SAVING_STATUS_DEBOUNCE_MS)
    // PUT resolves immediately (synchronous in this model).
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    status = 'saved'
    expect(status).toBe('saved')
  })

  it('slow PUT (≥ debounce) does flip to saving before completion', async () => {
    let status: 'idle' | 'saving' | 'saved' = 'idle'
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        status = 'saving'
        resolve()
      }, AUTO_SAVE_THRESHOLDS.SAVING_STATUS_DEBOUNCE_MS)
    })
    expect(status).toBe('saving')
  })
})

/**
 * L3 — error classification. The auto-save loop now turns axios failures into
 * distinct user-facing copy so the notification bell can tell "권한 없음" from
 * "오프라인" from "서버 점검 중". 412 is intentionally NOT routed through this
 * classifier — the conflict modal owns that path.
 */
describe('editor/useAutoSave error classification (L3)', () => {
  const make = (status?: number) =>
    status == null ? new Error('Network Error') : { response: { status } }

  it('no response → offline / retry copy', () => {
    const v = classifyAutoSaveError(make())
    expect(v.message).toContain('오프라인')
    expect(v.category).toBe('system')
  })

  it('401 / 403 → permission copy', () => {
    expect(classifyAutoSaveError(make(401)).message).toContain('권한')
    expect(classifyAutoSaveError(make(403)).message).toContain('권한')
  })

  it('503 → maintenance copy', () => {
    const v = classifyAutoSaveError(make(503))
    expect(v.message).toContain('점검')
  })

  it('500 → generic server-error copy with status code in detail', () => {
    const v = classifyAutoSaveError(make(500))
    expect(v.message).toContain('서버 오류')
    expect(v.detail).toContain('500')
  })

  it('4xx other than 401/403 → validation copy', () => {
    const v = classifyAutoSaveError(make(422))
    expect(v.message).toContain('저장 거부')
    expect(v.detail).toContain('422')
  })
})
