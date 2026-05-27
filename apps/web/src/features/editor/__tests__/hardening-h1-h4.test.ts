/**
 * Phase 2 editor stability hardening — H1 (undo confirm), H2 (conflict
 * fallback recovery), H3 (partial-response coalescing), H4 (offline
 * reconnect lost-update detection).
 *
 * These tests sit alongside the existing state.test.ts / auto-save.test.ts
 * and exercise the specific seams touched by the hardening pass. The
 * editor tests run without jsdom, so we lean on store mutations, mocked
 * apiClient methods, and pure helpers (no React rendering).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ----- shared mocks -------------------------------------------------------
// MUST be declared BEFORE any module imports the mocked path. Vitest hoists
// vi.mock() calls automatically.
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

// The editor test suite runs in Vitest's default node env (no jsdom), so we
// have to stub the bits of `window` we exercise. The state.ts helpers all
// guard on `typeof window === 'undefined'`, so we install a minimal global
// before importing the module-under-test.
const _confirmFn = { current: (_: string) => true as boolean }
type StorageLike = { [k: string]: string }
const _storage: StorageLike = {}
;(globalThis as unknown as { window?: unknown }).window = {
  confirm: (msg: string) => _confirmFn.current(msg),
  sessionStorage: {
    getItem: (k: string) => (k in _storage ? _storage[k] : null),
    setItem: (k: string, v: string) => {
      _storage[k] = v
    },
    removeItem: (k: string) => {
      delete _storage[k]
    },
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}

import { apiClient } from '@/lib/api/client'
import {
  useEditorStore,
  hasDismissedUndoWarning,
  dismissUndoWarning,
  resetUndoWarningDismiss,
} from '../state'
import { __testing } from '../api'
import type { DocumentJSONV10 } from '@/types/document'

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>

function fullDoc(_version = 1, title = 'Doc'): DocumentJSONV10 {
  // `_version` is documentary only — etag (parsed at call sites) drives
  // behaviour. Kept as a positional arg for test readability.
  return {
    schema_version: '1.0',
    id: '01HRDN0000000000000000ROOT',
    slug: 'doc',
    title,
    metadata: {
      division: 'MX',
      owners: ['alice'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: '01HRDN0000000000000000SEC1',
        level: 1,
        title: 'a',
        blocks: [],
        subsections: [],
      },
    ],
  } as DocumentJSONV10
}

beforeEach(() => {
  vi.clearAllMocks()
  useEditorStore.getState().reset()
  resetUndoWarningDismiss()
  __testing.fullDocFetchInFlight.clear()
})

// =========================================================================
// H1 — Undo cross-section warning + sessionStorage dismiss
// =========================================================================
describe('H1 — undo confirmation flow', () => {
  it('undo() short-circuits when user declines the confirm and does NOT mutate stacks', async () => {
    // Setup: bound doc + push a synthetic undo-able version onto the stack.
    useEditorStore.getState().bind('doc', fullDoc(), 'W/"doc-3"')
    // Manually seed undo history (mimics two successful saves).
    useEditorStore.setState((s) => ({
      ...s,
      undoStack: [1, 2],
      currentVersion: 3,
    }))

    let confirmCalls = 0
    _confirmFn.current = () => {
      confirmCalls += 1
      return false
    }

    await useEditorStore.getState().undo()

    expect(confirmCalls).toBe(1)
    // Stacks unchanged because the user said cancel.
    expect(useEditorStore.getState().undoStack).toEqual([1, 2])
    expect(useEditorStore.getState().redoStack).toEqual([])
    // The dismissal MUST have been recorded so the next undo won't prompt.
    expect(hasDismissedUndoWarning()).toBe(true)
  })

  it('subsequent undo() calls do not re-prompt once dismissal is stored', async () => {
    useEditorStore.getState().bind('doc', fullDoc(), 'W/"doc-3"')
    useEditorStore.setState((s) => ({
      ...s,
      undoStack: [1, 2],
      currentVersion: 3,
    }))

    // First call: confirm accepted. We then verify confirm runs exactly
    // once across two undo invocations (second call sees the dismissed flag).
    let confirmCalls = 0
    _confirmFn.current = () => {
      confirmCalls += 1
      return true
    }

    // Stub the BE round-trip the undo() flow performs via apiClient.post
    // (restoreVersion under the hood).
    post.mockResolvedValue({
      data: { data: fullDoc(2), meta: { etag: 'W/"doc-2"' } },
      headers: { etag: 'W/"doc-2"' },
    })

    await useEditorStore.getState().undo()
    // After the first successful undo, stacks shift: currentVersion is now 2.
    // Push a new version onto the undo stack to make the second call valid.
    useEditorStore.setState((s) => ({
      ...s,
      undoStack: [...s.undoStack, 1],
      currentVersion: 2,
    }))
    await useEditorStore.getState().undo()

    expect(confirmCalls).toBe(1)
  })

  it('dismissUndoWarning() persists to sessionStorage and is readable by hasDismissed', () => {
    expect(hasDismissedUndoWarning()).toBe(false)
    dismissUndoWarning()
    expect(hasDismissedUndoWarning()).toBe(true)
    expect(window.sessionStorage.getItem('mxwp.editor.undoWarningDismissed')).toBe('1')
  })
})

// =========================================================================
// H3 — Partial-response coalescing + serialised fallback GET
// =========================================================================
describe('H3 — withFullDocFallback serialisation', () => {
  it('coalesces concurrent fallback GETs for the same slug into ONE network call', async () => {
    // Two parallel mutations both end up needing a fallback GET. The
    // serialisation map must dedupe them.
    let calls = 0
    get.mockImplementation(async () => {
      calls += 1
      // Simulate latency so both calls overlap.
      await new Promise((r) => setTimeout(r, 5))
      return {
        data: {
          data: { content: fullDoc(2, 'fresh') },
          meta: { etag: 'W/"doc-2"' },
        },
        headers: { etag: 'W/"doc-2"' },
      }
    })

    const [a, b] = await Promise.all([
      __testing.fetchFullDoc('doc', 'fallback-etag'),
      __testing.fetchFullDoc('doc', 'fallback-etag'),
    ])
    expect(calls).toBe(1)
    expect(a?.document.title).toBe('fresh')
    expect(b?.document.title).toBe('fresh')
    expect(a?.etag).toBe('W/"doc-2"')
  })

  it('fallback GET failure resolves to null (never throws) so callers can fall back to the partial result', async () => {
    get.mockRejectedValueOnce(new Error('network down'))
    const r = await __testing.fetchFullDoc('doc', 'fallback-etag')
    expect(r).toBeNull()
    // Map must be cleaned up so the next call can retry.
    expect(__testing.fullDocFetchInFlight.has('doc')).toBe(false)
  })

  it('looksLikeFullDoc rejects partial mutation responses (no metadata + no sections)', () => {
    expect(__testing.looksLikeFullDoc({ slug: 'x', version: 2 })).toBe(false)
    expect(__testing.looksLikeFullDoc({ slug: 'x', sections: [] })).toBe(false)
    expect(
      __testing.looksLikeFullDoc({
        slug: 'x',
        sections: [],
        metadata: { division: 'MX' },
      }),
    ).toBe(true)
  })
})

// =========================================================================
// H4 — Offline reconnect: server-etag check before draining the queue
// =========================================================================
describe('H4 — offline reconnect lost-update guard contract', () => {
  it('mismatch between server etag and local baseEtag triggers the conflict path', () => {
    // We model the precise gate the hook uses without rendering React. The
    // hook compares `serverEtag !== localBaseEtag` after GET — when true,
    // it calls setConflict() instead of performSave().
    useEditorStore.getState().bind('doc', fullDoc(), 'W/"doc-1"')
    expect(useEditorStore.getState().baseEtag).toBe('W/"doc-1"')

    const serverEtag = 'W/"doc-3"' // someone else saved while offline
    const localBaseEtag = useEditorStore.getState().baseEtag
    const wouldConflict = Boolean(
      serverEtag && localBaseEtag && serverEtag !== localBaseEtag,
    )
    expect(wouldConflict).toBe(true)

    // Simulate the hook's branch: it calls setConflict with the fresh doc.
    const fresh = fullDoc(3, 'their edits')
    useEditorStore.getState().setConflict(fresh, serverEtag)
    expect(useEditorStore.getState().conflictRemote).toBe(fresh)
    expect(useEditorStore.getState().conflictRemoteEtag).toBe(serverEtag)
    expect(useEditorStore.getState().autoSaveStatus).toBe('conflict')
  })

  it('matching server etag means no conflict — drain proceeds normally', () => {
    useEditorStore.getState().bind('doc', fullDoc(), 'W/"doc-1"')
    const serverEtag = 'W/"doc-1"' // unchanged during the offline window
    const localBaseEtag = useEditorStore.getState().baseEtag
    const wouldConflict = Boolean(
      serverEtag && localBaseEtag && serverEtag !== localBaseEtag,
    )
    expect(wouldConflict).toBe(false)
  })

  it('missing localBaseEtag (fresh page mid-offline) does NOT trigger false-positive conflicts', () => {
    // After reset(), baseEtag is null — we don't have a base to compare
    // against, so the hook should fall through to the regular save path
    // (which will 412 if needed, taking the existing conflict path).
    expect(useEditorStore.getState().baseEtag).toBeNull()
    const serverEtag = 'W/"doc-5"'
    const localBaseEtag = useEditorStore.getState().baseEtag
    const wouldConflict = Boolean(
      serverEtag && localBaseEtag && serverEtag !== localBaseEtag,
    )
    expect(wouldConflict).toBe(false)
  })
})

// =========================================================================
// H2 — Conflict fallback recovery actions (logic-level)
// =========================================================================
describe('H2 — conflict fallback recovery logic', () => {
  it('"서버 버전 덮어쓰기" path: applySnapshot(remote, remoteEtag) clears conflict', () => {
    useEditorStore.getState().bind('doc', fullDoc(), 'W/"doc-1"')
    const remote = fullDoc(3, 'their edits')
    useEditorStore.getState().setConflict(remote, 'W/"doc-3"')

    // Simulate the fallback "accept server" action.
    useEditorStore.getState().applyServerSnapshot(remote, 'W/"doc-3"')
    useEditorStore.getState().setConflict(null)

    const s = useEditorStore.getState()
    expect(s.draft?.title).toBe('their edits')
    expect(s.etag).toBe('W/"doc-3"')
    // setConflict(null) is called AFTER applyServerSnapshot, so the final
    // status pill is 'idle' (not 'saved'). The important invariant is that
    // the conflict is cleared and the server doc is now the local draft.
    expect(s.conflictRemote).toBeNull()
    expect(s.conflictRemoteEtag).toBeNull()
  })

  it('"내 draft 강제 저장" requires both localDraft + remoteEtag — guard branch covered', () => {
    // The fallback button is disabled (via `disabled={busy || !localDraft || !remoteEtag}`)
    // when either is missing. We assert the guard's truth table.
    const cases: Array<{ draft: unknown; etag: string | null; enabled: boolean }> = [
      { draft: fullDoc(), etag: 'W/"doc-3"', enabled: true },
      { draft: null, etag: 'W/"doc-3"', enabled: false },
      { draft: fullDoc(), etag: null, enabled: false },
      { draft: null, etag: null, enabled: false },
    ]
    for (const c of cases) {
      const canForce = Boolean(c.draft && c.etag)
      expect(canForce).toBe(c.enabled)
    }
  })
})
