import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../state'
import { putDocument, isPreconditionFailed, type EditorMutationResult } from '../api'
import { getDocument } from '@/features/document/api'
import { pushNotification } from '@/features/notifications/store'
import { useConnectionStore } from '../connectionStore'

/** Auto-save policy parameters. */
const IDLE_MS = 5_000
const CHAR_THRESHOLD = 200

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

  const performSave = useCallback(async () => {
    const state = useEditorStore.getState()
    if (!slug || !state.draft || !state.etag || !state.dirty) return
    // Pause while a conflict modal is open — user is mid-resolve.
    if (state.conflictRemote) return
    setStatus('saving')
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

    // schedule idle save
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      void performSave()
    }, IDLE_MS)

    // pressure save
    if (charsSinceSave.current >= CHAR_THRESHOLD) {
      void performSave()
    }
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [draft, dirty, enabled, autoSaveEnabled, conflictRemote, online, performSave, bumpPending])

  // Drain the offline queue when connection is restored.
  useEffect(() => {
    const wentOnline = !prevOnline.current && online
    prevOnline.current = online
    if (!wentOnline) return
    if (!needsFullSync.current) return
    if (!enabled || !autoSaveEnabled) return
    // Reset pending counter then fire the merged-snapshot PUT. We drain
    // synchronously (one PUT) — the local draft IS the merged result of all
    // queued edits, so etag-threading per-queued-mutation is unnecessary.
    bumpPending(-useConnectionStore.getState().pendingMutations)
    needsFullSync.current = false
    void performSave()
  }, [online, enabled, autoSaveEnabled, performSave, bumpPending])

  // expose manual save (Cmd/Ctrl+S) for the shortcut hook
  return { saveNow: performSave }
}

/** Exported so tests can introspect. */
export const AUTO_SAVE_THRESHOLDS = {
  IDLE_MS,
  CHAR_THRESHOLD,
} as const

// re-export for convenience
export { isPreconditionFailed }
