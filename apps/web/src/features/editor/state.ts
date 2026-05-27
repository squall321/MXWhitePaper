import { create } from 'zustand'
import type { DocumentJSONV10, Ulid } from '@/types/document'

/**
 * Editor mode discriminator.
 *
 *   - reader: read-only article view (default)
 *   - quickEdit:<sectionId>: a single section is editable in-place
 *   - fullEdit: the whole document is editable, outline panel replaces OrgTree
 */
export type EditorMode =
  | { kind: 'reader' }
  | { kind: 'quickEdit'; sectionId: Ulid }
  | { kind: 'fullEdit' }

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

export interface EditorStateSnapshot {
  /** The slug of the document the editor is currently bound to. */
  slug: string | null
  mode: EditorMode
  /** Latest server-known etag for the doc. */
  etag: string | null
  /** Working copy of the document. Null while idle / before first edit. */
  draft: DocumentJSONV10 | null
  /** True when the working copy has unsaved diffs vs the server. */
  dirty: boolean
  /** Auto-save toggle (user-level UI switch). */
  autoSaveEnabled: boolean
  /** Auto-save UX status indicator. */
  autoSaveStatus: AutoSaveStatus
  /** Epoch ms of the most recent successful save — drives the "저장됨 N분 전"
   *  relative-time pill. `null` until the first save completes. */
  lastSavedAt: number | null
  /** Server document used for conflict diff display. Set on 412. */
  conflictRemote: DocumentJSONV10 | null
  /** ETag of `conflictRemote` — used as If-Match on the resolved PUT. */
  conflictRemoteEtag: string | null
  /**
   * Snapshot of the document the user *started* editing from (before any
   * local changes). Captured on `bind()` and on each successful save. Used
   * as the common ancestor for the 3-way diff when a 412 conflict surfaces.
   */
  baseContent: DocumentJSONV10 | null
  baseEtag: string | null
  /**
   * ID of the image block that was just inserted (drop / paste / picker) and
   * whose caption input should auto-focus. Cleared after one render cycle.
   */
  pendingCaptionFocusBlockId: Ulid | null
  /**
   * Patch-level undo / redo history. Each entry is a server document
   * version we can restore back to. The lists are populated automatically
   * by `applyServerSnapshot`: every successful mutation pushes the
   * previous version into `undoStack` and clears `redoStack`. Internal
   * navigations (from `undo()` / `redo()` themselves) bypass this so the
   * stacks behave like a real undo history rather than a chronological
   * log.
   */
  currentVersion: number | null
  undoStack: number[]
  redoStack: number[]
}

export interface EditorActions {
  /** Bind the store to a document (called by DocumentReader on load). */
  bind(slug: string, doc: DocumentJSONV10, etag: string): void
  /** Drop all editor state (e.g., on navigation away). */
  reset(): void

  enterQuickEdit(sectionId: Ulid): void
  enterFullEdit(): void
  exitToReader(): void

  /** Local-only patch — used by BlockNote on each keystroke. Sets dirty=true. */
  setDraft(doc: DocumentJSONV10): void
  /** Server-confirmed snapshot (after a successful save).
   *  `opts.internalNavigation` is set by `undo()`/`redo()` so they don't
   *  pollute the history stacks they're navigating. */
  applyServerSnapshot(
    doc: DocumentJSONV10,
    etag: string,
    opts?: { internalNavigation?: boolean },
  ): void
  /** Pop the undo stack, restore that version on the server, push the
   *  current version onto the redo stack. No-op when nothing to undo. */
  undo(): Promise<void>
  /** Mirror of `undo` — pop redo stack, push current onto undo stack. */
  redo(): Promise<void>

  setAutoSaveEnabled(on: boolean): void
  setAutoSaveStatus(status: AutoSaveStatus): void
  /** Mark a successful save — sets `lastSavedAt` to now. */
  markSaved(at?: number): void
  /** Stash the freshly-fetched remote + its etag for the conflict modal. */
  setConflict(remote: DocumentJSONV10 | null, remoteEtag?: string | null): void
  /** Mark a freshly-inserted image block for caption auto-focus. */
  setPendingCaptionFocus(blockId: Ulid | null): void
}

export type EditorStore = EditorStateSnapshot & EditorActions

const initialSnapshot: EditorStateSnapshot = {
  slug: null,
  mode: { kind: 'reader' },
  etag: null,
  draft: null,
  dirty: false,
  autoSaveEnabled: true,
  autoSaveStatus: 'idle',
  lastSavedAt: null,
  conflictRemote: null,
  conflictRemoteEtag: null,
  baseContent: null,
  baseEtag: null,
  pendingCaptionFocusBlockId: null,
  currentVersion: null,
  undoStack: [],
  redoStack: [],
}

/** H1: sessionStorage key for the once-per-session undo warning dismiss. */
const UNDO_WARNING_DISMISS_KEY = 'mxwp.editor.undoWarningDismissed'

export function hasDismissedUndoWarning(): boolean {
  if (typeof window === 'undefined') return true // SSR / tests w/o DOM — never block
  try {
    return window.sessionStorage.getItem(UNDO_WARNING_DISMISS_KEY) === '1'
  } catch {
    return true
  }
}

export function dismissUndoWarning(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(UNDO_WARNING_DISMISS_KEY, '1')
  } catch {
    /* sessionStorage quota / private mode — best effort */
  }
}

/** Exposed for tests so they can reset the flag between cases. */
export function resetUndoWarningDismiss(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(UNDO_WARNING_DISMISS_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Parse the server's weak ETag (`W/"<id>-<version>"`) into the trailing
 * version integer. Returns null when the header is missing or in an
 * unexpected shape — callers fall back to keeping the previous version.
 */
function parseEtagVersion(etag: string | null | undefined): number | null {
  if (!etag) return null
  const m = etag.match(/-(\d+)"$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...initialSnapshot,

  bind: (slug, doc, etag) =>
    set({
      slug,
      etag,
      draft: doc,
      dirty: false,
      mode: { kind: 'reader' },
      autoSaveStatus: 'idle',
      conflictRemote: null,
      conflictRemoteEtag: null,
      // Snapshot the freshly-fetched document as the 3-way merge base.
      baseContent: doc,
      baseEtag: etag,
      // Reset undo/redo history when binding to a new doc.
      currentVersion: parseEtagVersion(etag),
      undoStack: [],
      redoStack: [],
    }),

  reset: () => set({ ...initialSnapshot }),

  enterQuickEdit: (sectionId) => {
    const { mode } = get()
    if (mode.kind === 'fullEdit') return // no-op while in full edit
    set({ mode: { kind: 'quickEdit', sectionId } })
  },

  enterFullEdit: () => set({ mode: { kind: 'fullEdit' } }),

  exitToReader: () => set({ mode: { kind: 'reader' } }),

  setDraft: (doc) => set({ draft: doc, dirty: true }),

  applyServerSnapshot: (doc, etag, opts) =>
    set((s) => {
      // Track undo history. Every external mutation (anything that isn't
      // an undo/redo navigation) pushes the previous version onto the
      // undo stack and invalidates the redo stack — same semantics as a
      // word processor.
      const newVersion = parseEtagVersion(etag) ?? s.currentVersion
      const isInternal = Boolean(opts?.internalNavigation)
      const versionChanged =
        s.currentVersion != null &&
        newVersion != null &&
        newVersion !== s.currentVersion
      const undoStack =
        !isInternal && versionChanged
          ? [...s.undoStack, s.currentVersion!]
          : s.undoStack
      const redoStack = !isInternal && versionChanged ? [] : s.redoStack
      // 일부 BE mutation 엔드포인트(/blocks POST, PATCH, /sections PATCH,
      // /sections/reorder 등)는 전체 DocumentJSON 이 아니라 `{slug, version,
      // ...}` 또는 `{slug, version, sections}` 같은 부분 응답만 돌려준다.
      // 그걸 그대로 draft 에 덮으면 metadata / infobox 가 통째로 사라져
      // 다음 렌더에서 division / tags 등을 읽을 때 화면 전체가 흰 화면이 된다.
      // → 응답에 sections 배열 + metadata 객체가 모두 있어야만 full doc
      //    으로 간주하고 교체한다. 그 외에는 etag 만 갱신.
      const candidate = doc as DocumentJSONV10 | undefined
      const looksFull = Boolean(
        candidate &&
          typeof candidate === 'object' &&
          Array.isArray(candidate.sections) &&
          candidate.metadata &&
          typeof candidate.metadata === 'object',
      )
      if (!looksFull) {
        return {
          etag,
          dirty: false,
          autoSaveStatus: 'saved' as const,
          lastSavedAt: Date.now(),
          conflictRemote: null,
          conflictRemoteEtag: null,
          baseContent: s.draft ?? s.baseContent,
          baseEtag: etag,
          currentVersion: newVersion,
          undoStack,
          redoStack,
        }
      }
      return {
        draft: doc,
        etag,
        dirty: false,
        autoSaveStatus: 'saved' as const,
        lastSavedAt: Date.now(),
        conflictRemote: null,
        conflictRemoteEtag: null,
        // After a successful save the saved doc IS the new base for any
        // subsequent edits.
        baseContent: doc,
        baseEtag: etag,
        currentVersion: newVersion,
        undoStack,
        redoStack,
      }
    }),

  undo: async () => {
    const { undoStack, currentVersion, slug, etag, applyServerSnapshot } = get()
    if (undoStack.length === 0 || !slug || !etag || currentVersion == null) return
    const target = undoStack[undoStack.length - 1]
    if (target == null) return
    // H1 (Phase 2 hardening): undo is full-document restore, so any local
    // edits since the snapshot we're undoing TO will be discarded. Warn the
    // user once per session — sessionStorage stores the dismissal so we
    // don't nag on every undo click. The proper fix (PATCH-level reverse
    // replay) is deferred to a later cycle.
    if (!hasDismissedUndoWarning() && typeof window !== 'undefined') {
      const ok = window.confirm(
        '실행 취소는 문서 전체를 이전 버전으로 되돌립니다.\n' +
          '되돌리는 시점 이후의 모든 변경 사항(다른 섹션 포함)이 손실됩니다.\n\n' +
          '계속하시겠습니까?\n\n' +
          '(이 안내는 브라우저 세션 내에서 다시 표시되지 않습니다.)',
      )
      dismissUndoWarning()
      if (!ok) return
    }
    // Optimistically split the stacks; we'll roll back if the BE call
    // fails. The new redoStack entry is the version we're about to leave.
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, currentVersion],
    }))
    const { restoreVersion } = await import('./api')
    try {
      const result = await restoreVersion(slug, target, etag, '실행 취소')
      applyServerSnapshot(result.document, result.etag, { internalNavigation: true })
    } catch {
      // Roll back the optimistic split on failure (412 / network).
      set((s) => ({
        undoStack: [...s.undoStack, target],
        redoStack: s.redoStack.slice(0, -1),
      }))
    }
  },

  redo: async () => {
    const { redoStack, currentVersion, slug, etag, applyServerSnapshot } = get()
    if (redoStack.length === 0 || !slug || !etag || currentVersion == null) return
    const target = redoStack[redoStack.length - 1]
    if (target == null) return
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, currentVersion],
    }))
    const { restoreVersion } = await import('./api')
    try {
      const result = await restoreVersion(slug, target, etag, '다시 실행')
      applyServerSnapshot(result.document, result.etag, { internalNavigation: true })
    } catch {
      set((s) => ({
        redoStack: [...s.redoStack, target],
        undoStack: s.undoStack.slice(0, -1),
      }))
    }
  },

  setAutoSaveEnabled: (on) => set({ autoSaveEnabled: on }),
  setAutoSaveStatus: (status) => set({ autoSaveStatus: status }),
  markSaved: (at?: number) => set({ lastSavedAt: at ?? Date.now() }),
  setConflict: (remote, remoteEtag = null) =>
    set({
      conflictRemote: remote,
      conflictRemoteEtag: remote ? remoteEtag : null,
      autoSaveStatus: remote ? 'conflict' : 'idle',
    }),
  setPendingCaptionFocus: (blockId) =>
    set({ pendingCaptionFocusBlockId: blockId }),
}))

/** Convenience selectors. */
export const editorSelectors = {
  isReader: (s: EditorStateSnapshot) => s.mode.kind === 'reader',
  isQuickEditing: (sectionId: Ulid) => (s: EditorStateSnapshot) =>
    s.mode.kind === 'quickEdit' && s.mode.sectionId === sectionId,
  isFullEditing: (s: EditorStateSnapshot) => s.mode.kind === 'fullEdit',
  isEditing: (s: EditorStateSnapshot) => s.mode.kind !== 'reader',
}
