import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../state'
import { putDocument, isPreconditionFailed, type EditorMutationResult } from '../api'
import { getDocument } from '@/features/document/api'
import { pushNotification } from '@/features/notifications/store'
import { useConnectionStore } from '../connectionStore'
import type { DocumentJSONV10, Section } from '@/types/document'

/** Auto-save policy parameters. */
const IDLE_MS = 5_000
const CHAR_THRESHOLD = 200
/**
 * Adaptive idle: documents larger than this block count use a longer idle
 * window so big-doc PUTs (1-2 MB JSON serialise → network → server) don't
 * fire every 5 seconds and pile up. Small docs keep the snappy 5 s timing.
 */
const SMALL_DOC_BLOCKS = 100
const BIG_DOC_IDLE_MS = 15_000
/**
 * "저장 중" pill is suppressed until a save has been in-flight for this long.
 * Fast PUTs (small doc, healthy network) finish before this fires → the pill
 * stays at "저장됨" instead of flickering saving→saved every few seconds.
 */
const SAVING_STATUS_DEBOUNCE_MS = 200

/** Walk the section tree and count every block. Cheap — no allocations. */
function countBlocks(doc: DocumentJSONV10): number {
  let n = 0
  const visit = (sections: Section[]) => {
    for (const s of sections) {
      n += s.blocks.length
      if (s.subsections && s.subsections.length > 0) visit(s.subsections)
    }
  }
  visit(doc.sections)
  return n
}

/** Pick the idle window for the current draft size. */
function pickIdleMs(doc: DocumentJSONV10 | null): number {
  if (!doc) return IDLE_MS
  return countBlocks(doc) > SMALL_DOC_BLOCKS ? BIG_DOC_IDLE_MS : IDLE_MS
}

interface AutoSaveOptions {
  /** Override the change-log header. Default: "auto-save". */
  changeLog?: string
  /** Disabled by the parent — used when not in any edit mode. */
  enabled?: boolean
}

/**
 * Debounces dirty edits and PUTs the full document to the BE.
 *
 * Triggers the save when EITHER:
 *   - the user has been idle for IDLE_MS, OR
 *   - the cumulative character delta since the last save reaches CHAR_THRESHOLD.
 *
 * Surfaces auto-save status via the editor store.
 *
 * On 412 (stale ETag) it stores the remote version into the store so the
 * `<ConflictMergeModal />` can render — it does NOT auto-resolve.
 *
 * **Offline mode**: when `useConnectionStore.online === false` the save is
 * suppressed and `pendingMutations` is bumped instead. On the next online
 * transition the hook drains the backlog by issuing a single full-doc PUT
 * with the *current* draft snapshot (this side-steps stale-etag threading
 * for individual queued edits — the local doc IS the merged result).
 *
 * NOTE: this hook intentionally uses PUT (full doc replace). Sprint 5 may
 * switch to PATCH-by-section for finer granularity once the BE writes are
 * stable.
 */
export function useAutoSave(slug: string | undefined, opts: AutoSaveOptions = {}) {
  const { changeLog = 'auto-save', enabled = true } = opts

  const dirty = useEditorStore((s) => s.dirty)
  const draft = useEditorStore((s) => s.draft)
  const etag = useEditorStore((s) => s.etag)
  const autoSaveEnabled = useEditorStore((s) => s.autoSaveEnabled)
  const conflictRemote = useEditorStore((s) => s.conflictRemote)
  const setStatus = useEditorStore((s) => s.setAutoSaveStatus)
  const setConflict = useEditorStore((s) => s.setConflict)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)

  const online = useConnectionStore((s) => s.online)
  const bumpPending = useConnectionStore((s) => s.bumpPending)

  const charsSinceSave = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDraftSize = useRef<number | null>(null)
  /** Set to true while offline if any edit happens. Drained on reconnect. */
  const needsFullSync = useRef(false)
  /** Track previous online value so we detect the false→true edge. */
  const prevOnline = useRef(online)
  /** True while a PUT is on the wire. Prevents overlapping requests. */
  const saveInFlight = useRef(false)
  /** Edit landed while a PUT was in flight → fire one more save after it. */
  const queuedSave = useRef(false)
  /** Pending "saving" status flip — cancelled if the PUT finishes first. */
  const savingStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const performSave = useCallback(async () => {
    const state = useEditorStore.getState()
    if (!slug || !state.draft || !state.etag || !state.dirty) return
    // Pause while a conflict modal is open — user is mid-resolve.
    if (state.conflictRemote) return
    // Queue if a save is already on the wire — drain after it completes.
    if (saveInFlight.current) {
      queuedSave.current = true
      return
    }
    saveInFlight.current = true
    // Debounce the "saving" pill: only show after the PUT has been in flight
    // for SAVING_STATUS_DEBOUNCE_MS. Fast saves never flash the spinner.
    if (savingStatusTimer.current) clearTimeout(savingStatusTimer.current)
    savingStatusTimer.current = setTimeout(() => {
      setStatus('saving')
      savingStatusTimer.current = null
    }, SAVING_STATUS_DEBOUNCE_MS)
    try {
      const result: EditorMutationResult = await putDocument(
        slug,
        state.draft,
        state.etag,
        changeLog,
      )
      applySnapshot(result.document, result.etag)
      charsSinceSave.current = 0
      pushNotification({
        category: 'activity',
        message: '문서가 저장되었습니다',
        detail: slug,
        slug,
      })
    } catch (err) {
      if (isPreconditionFailed(err)) {
        // Re-fetch remote so the modal can show both sides.
        try {
          const remote = await getDocument(slug)
          setConflict(remote.document, remote.meta.etag ?? null)
          pushNotification({
            category: 'system',
            message: '충돌이 감지되었습니다',
            detail: slug,
            slug,
          })
        } catch {
          setStatus('error')
        }
        return
      }
      setStatus('error')
    } finally {
      // Cancel pending status flip if PUT finished before the debounce fired.
      if (savingStatusTimer.current) {
        clearTimeout(savingStatusTimer.current)
        savingStatusTimer.current = null
      }
      saveInFlight.current = false
      // Drain a queued edit that landed while we were on the wire.
      if (queuedSave.current) {
        queuedSave.current = false
        // Re-check the store: the snapshot we just applied may have cleared
        // dirty, in which case there's nothing to save.
        const next = useEditorStore.getState()
        if (next.dirty && !next.conflictRemote) {
          void performSave()
        }
      }
    }
  }, [slug, changeLog, setStatus, setConflict, applySnapshot])

  // Track keystroke pressure: any change to draft size counts as activity.
  useEffect(() => {
    if (!enabled || !autoSaveEnabled) return
    if (!dirty || !draft) return
    // While the conflict modal is open we hold the auto-save loop.
    if (conflictRemote) return
    const size = JSON.stringify(draft).length
    if (lastDraftSize.current !== null) {
      charsSinceSave.current += Math.abs(size - lastDraftSize.current)
    }
    lastDraftSize.current = size

    // Offline: queue instead of sending. Each *new* dirty pulse increments
    // the pending counter so the offline pill can show "N개 변경 대기 중".
    if (!online) {
      if (!needsFullSync.current) {
        needsFullSync.current = true
        bumpPending(1)
      }
      return
    }

    // schedule idle save — bigger documents get a longer idle window so
    // expensive full-doc PUTs don't pile up every 5 s.
    if (idleTimer.current) clearTimeout(idleTimer.current)
    const idleMs = pickIdleMs(draft)
    idleTimer.current = setTimeout(() => {
      void performSave()
    }, idleMs)

    // pressure save
    if (charsSinceSave.current >= CHAR_THRESHOLD) {
      void performSave()
    }
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [draft, dirty, enabled, autoSaveEnabled, conflictRemote, online, performSave, bumpPending])

  // Drain the offline queue when connection is restored.
  //
  // H4 (Phase 2 hardening): before naively firing the queued PUT we GET the
  // current server document to check whether another client edited it while
  // we were offline. If the server ETag differs from our local base ETag,
  // a lost-update would otherwise silently overwrite their changes — we
  // surface the conflict modal instead and let the user choose.
  useEffect(() => {
    const wentOnline = !prevOnline.current && online
    prevOnline.current = online
    if (!wentOnline) return
    if (!needsFullSync.current) return
    if (!enabled || !autoSaveEnabled) return
    bumpPending(-useConnectionStore.getState().pendingMutations)
    needsFullSync.current = false
    if (!slug) {
      void performSave()
      return
    }
    void (async () => {
      try {
        const fresh = await getDocument(slug)
        const serverEtag = fresh.meta.etag ?? null
        const localBaseEtag = useEditorStore.getState().baseEtag
        // Server moved while we were offline → don't blindly PUT; let the
        // user resolve via the conflict modal (which falls back to H2
        // recovery actions if 3-way diff can't run).
        if (serverEtag && localBaseEtag && serverEtag !== localBaseEtag) {
          setConflict(fresh.document, serverEtag)
          pushNotification({
            category: 'system',
            message: '오프라인 동안 다른 사용자가 문서를 수정했습니다',
            detail: slug,
            slug,
          })
          return
        }
      } catch {
        // GET failed (network race, 404). Fall through to the regular
        // save path — if it 412s the existing conflict path takes over.
      }
      void performSave()
    })()
  }, [slug, online, enabled, autoSaveEnabled, performSave, bumpPending, setConflict])

  // expose manual save (Cmd/Ctrl+S) for the shortcut hook
  return { saveNow: performSave }
}

/** Exported so tests can introspect. */
export const AUTO_SAVE_THRESHOLDS = {
  IDLE_MS,
  CHAR_THRESHOLD,
  SMALL_DOC_BLOCKS,
  BIG_DOC_IDLE_MS,
  SAVING_STATUS_DEBOUNCE_MS,
} as const

/** Exported for testing adaptive idle policy. */
export { countBlocks, pickIdleMs }

// re-export for convenience
export { isPreconditionFailed }
