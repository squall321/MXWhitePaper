import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../state'
import { putDocument, isPreconditionFailed, type EditorMutationResult } from '../api'
import { getDocument } from '@/features/document/api'
import { pushNotification } from '@/features/notifications/store'

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

  const charsSinceSave = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDraftSize = useRef<number | null>(null)

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
  }, [draft, dirty, enabled, autoSaveEnabled, conflictRemote, performSave])

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
