import { useEffect, useRef, useState } from 'react'
import type { ListBlock, Slug, Ulid } from '@/types/document'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'

/**
 * ListBlockEditor — inline editor for the three list styles (bullet / number /
 * check). Each item gets its own row:
 *
 *   [marker]  [contentEditable text]              ← per row
 *
 * Behaviours:
 *   - Enter splits the current item at the caret and focuses the new row.
 *   - Backspace on an empty item removes it (and focuses the previous one).
 *   - For check lists, clicking the checkbox toggles a `[x]` prefix in the
 *     stored item string. (Schema's items[] is plain strings, so we encode
 *     the "checked" state as a leading `[x] ` / `[ ] ` token, matching the
 *     read-only ListBlockView convention.)
 *
 * Nesting: NOT implemented. The schema's `items` is `string[]` (flat) — no
 * tree structure. Tab/Shift+Tab fall through to the browser's default focus
 * navigation. To add nesting we'd need to extend the schema (e.g. items as
 * a recursive {text, children?}[]); flagged as an out-of-scope gap.
 *
 * Persistence: 800ms debounce + flush on blur, mirroring InlineTextBlockEditor.
 * On 412 we just clear the conflict marker (the store keeps the snapshot).
 */
interface Props {
  slug: Slug
  block: ListBlock
}

export function ListBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [items, setItems] = useState<string[]>(() =>
    block.items.length === 0 ? [''] : block.items,
  )
  const dirtyRef = useRef(false)
  const debounceRef = useRef<number | null>(null)
  /** Index that needs to receive focus on next render (null = nothing pending). */
  const focusTargetRef = useRef<number | null>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])

  // Sync from snapshot when not mid-edit (e.g. reorder or other-tab change).
  useEffect(() => {
    if (dirtyRef.current) return
    setItems(block.items.length === 0 ? [''] : block.items)
  }, [block.items])

  // Move focus to a freshly-split item.
  useEffect(() => {
    if (focusTargetRef.current == null) return
    const el = itemRefs.current[focusTargetRef.current]
    if (el) {
      el.focus()
      // Place caret at the start so Enter-split lands sensibly.
      const sel = window.getSelection()
      if (sel) {
        const r = document.createRange()
        r.selectNodeContents(el)
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
      }
    }
    focusTargetRef.current = null
  }, [items])

  const persist = async (next: string[]) => {
    if (!etag) return
    try {
      const patch = {
        type: 'list' as const,
        id: block.id as Ulid,
        style: block.style,
        items: next,
      } as never
      const result = await patchBlock(slug, block.id, patch, etag, '목록 수정')
      apply(result.document, result.etag)
      dirtyRef.current = false
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  const scheduleSave = (next: string[]) => {
    dirtyRef.current = true
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const onItemInput = (idx: number, ev: React.FormEvent<HTMLDivElement>) => {
    const text = (ev.currentTarget.innerText ?? '').replace(/\n+$/, '')
    setItems((prev) => {
      const next = prev.slice()
      next[idx] = text
      scheduleSave(next)
      return next
    })
  }

  const onItemKeyDown = (idx: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Split at caret: keep [0..caret] in current item, push [caret..end] as
      // a fresh row below. For an empty item this is just "insert empty row".
      const el = e.currentTarget
      const sel = window.getSelection()
      let head = el.innerText
      let tail = ''
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0).cloneRange()
        const before = document.createRange()
        before.selectNodeContents(el)
        before.setEnd(range.startContainer, range.startOffset)
        head = before.toString()
        const after = document.createRange()
        after.selectNodeContents(el)
        after.setStart(range.endContainer, range.endOffset)
        tail = after.toString()
      }
      setItems((prev) => {
        const next = prev.slice()
        next[idx] = head
        next.splice(idx + 1, 0, tail)
        focusTargetRef.current = idx + 1
        scheduleSave(next)
        return next
      })
      return
    }
    if (e.key === 'Backspace') {
      const el = e.currentTarget
      // Only consume the keystroke when the item is empty AND there's
      // somewhere to merge into. This preserves intra-item Backspace.
      if ((el.innerText ?? '').length === 0 && items.length > 1) {
        e.preventDefault()
        setItems((prev) => {
          const next = prev.slice()
          next.splice(idx, 1)
          focusTargetRef.current = Math.max(0, idx - 1)
          scheduleSave(next)
          return next
        })
      }
    }
  }

  // Check-list toggle: prepend / strip a `[x]` token. Done via a regex so
  // the user's actual prose (after the marker) is untouched.
  const isChecked = (s: string) => /^\s*\[[xX]\]\s*/.test(s)
  const toggleCheck = (idx: number) => {
    setItems((prev) => {
      const next = prev.slice()
      const cur = next[idx] ?? ''
      next[idx] = isChecked(cur)
        ? cur.replace(/^\s*\[[xX]\]\s*/, '')
        : `[x] ${cur.replace(/^\s*\[\s*\]\s*/, '')}`
      scheduleSave(next)
      return next
    })
  }
  const stripCheckPrefix = (s: string) => s.replace(/^\s*\[[xX\s]\]\s*/, '')

  const onBlur = () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (dirtyRef.current) void persist(items)
  }

  const containerCls =
    block.style === 'number'
      ? 'space-y-1 ml-6 list-decimal'
      : 'space-y-1 ml-6'

  return (
    <ul
      data-list-block-editor
      data-block-id={block.id}
      data-list-style={block.style}
      className={containerCls}
      onBlur={onBlur}
    >
      {items.map((raw, idx) => {
        const checked = block.style === 'check' && isChecked(raw)
        const display = block.style === 'check' ? stripCheckPrefix(raw) : raw
        return (
          <li key={idx} className="flex items-start gap-2 text-[15px] leading-7">
            {block.style === 'check' ? (
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleCheck(idx)}
                className="mt-1.5 h-4 w-4 rounded border-gray-300 text-smsg-700"
                aria-label={`체크 ${idx + 1}`}
              />
            ) : block.style === 'number' ? (
              <span className="mt-0 inline-block min-w-[1.5rem] text-right text-gray-500">
                {idx + 1}.
              </span>
            ) : (
              <span aria-hidden className="mt-0 inline-block min-w-[0.75rem] text-gray-500">
                •
              </span>
            )}
            <div
              ref={(el) => {
                itemRefs.current[idx] = el
              }}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label={`목록 항목 ${idx + 1}`}
              onInput={(ev) => onItemInput(idx, ev)}
              onKeyDown={onItemKeyDown(idx)}
              className="flex-1 min-h-[1.5rem] rounded outline-none focus:ring-2 focus:ring-smsg-300"
            >
              {display}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
