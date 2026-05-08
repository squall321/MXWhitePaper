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
  /** Server-confirmed snapshot (after a successful save). */
  applyServerSnapshot(doc: DocumentJSONV10, etag: string): void

  setAutoSaveEnabled(on: boolean): void
  setAutoSaveStatus(status: AutoSaveStatus): void
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
  conflictRemote: null,
  conflictRemoteEtag: null,
  baseContent: null,
  baseEtag: null,
  pendingCaptionFocusBlockId: null,
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

  applyServerSnapshot: (doc, etag) =>
    set((s) => {
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
          conflictRemote: null,
          conflictRemoteEtag: null,
          baseContent: s.draft ?? s.baseContent,
          baseEtag: etag,
        }
      }
      return {
        draft: doc,
        etag,
        dirty: false,
        autoSaveStatus: 'saved' as const,
        conflictRemote: null,
        conflictRemoteEtag: null,
        // After a successful save the saved doc IS the new base for any
        // subsequent edits.
        baseContent: doc,
        baseEtag: etag,
      }
    }),

  setAutoSaveEnabled: (on) => set({ autoSaveEnabled: on }),
  setAutoSaveStatus: (status) => set({ autoSaveStatus: status }),
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
