import { useEffect } from 'react'
import { useEditorStore } from '../state'

interface ShortcutCallbacks {
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onSlash?: () => void
}

/**
 * Wires the global editor shortcuts:
 *
 *   - E             toggle reader / fullEdit (only if NOT inside a text input)
 *   - Cmd/Ctrl+S    save (when dirty)
 *   - Cmd/Ctrl+Z    undo
 *   - Cmd/Ctrl+Shift+Z   redo
 *   - /             let-through (BlockNote intercepts inside the editor)
 *
 * Slash is intentionally not preventDefault'd — BlockNote's own slash menu
 * handler runs when focus is inside the editor; our `onSlash` callback is
 * called purely for UI bookkeeping.
 */
export function useEditorShortcuts(slug: string | undefined, cb: ShortcutCallbacks = {}) {
  const enterFullEdit = useEditorStore((s) => s.enterFullEdit)
  const exitToReader = useEditorStore((s) => s.exitToReader)

  useEffect(() => {
    if (!slug) return
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false
      if (t.isContentEditable) return true
      const tag = t.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    function onKey(ev: KeyboardEvent) {
      const mod = ev.metaKey || ev.ctrlKey
      // Save
      if (mod && (ev.key === 's' || ev.key === 'S')) {
        ev.preventDefault()
        cb.onSave?.()
        return
      }
      // Undo / Redo
      if (mod && (ev.key === 'z' || ev.key === 'Z')) {
        if (ev.shiftKey) cb.onRedo?.()
        else cb.onUndo?.()
        return
      }
      // E toggle — but only when not typing somewhere
      if (!mod && (ev.key === 'e' || ev.key === 'E') && !isTypingTarget(ev.target)) {
        ev.preventDefault()
        const { mode } = useEditorStore.getState()
        if (mode.kind === 'reader') enterFullEdit()
        else exitToReader()
        return
      }
      // Slash menu UI hint — only when typing somewhere editable
      if (ev.key === '/' && isTypingTarget(ev.target)) {
        cb.onSlash?.()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, cb.onSave, cb.onUndo, cb.onRedo, cb.onSlash, enterFullEdit, exitToReader])
}
