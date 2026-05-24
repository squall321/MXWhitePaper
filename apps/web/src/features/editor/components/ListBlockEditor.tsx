import { useEffect, useRef, useState } from 'react'
import type { ListBlock, Slug, Ulid } from '@/types/document'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'
import { ZebraToggle } from '../blocks/ZebraToggle'

/**
 * ListBlockEditor — inline editor for the three list styles (bullet / number /
 * check). Each item gets its own row:
 *
 *   [marker]  [contentEditable text]              ← per row
 *
 * Behaviours:
 *   - Enter splits the current item at the caret and focuses the new row.
 *   - Backspace on an empty item removes it (and focuses the previous one).
 *   - Tab indents (depth+1, capped at MAX_DEPTH); Shift+Tab outdents.
 *   - For check lists, clicking the checkbox toggles a `[x]` prefix in the
 *     stored item string. (Schema's items[] is plain strings, so we encode
 *     the "checked" state as a leading `[x] ` / `[ ] ` token, matching the
 *     read-only ListBlockView convention.)
 *
 * Nesting (flat-string-with-indent-prefix): depth is encoded as
 * `"  " * depth + text` (2-space pairs). This costs zero schema changes and
 * keeps existing samples that use plain strings working — depth 0 just has
 * no leading pairs. ListBlockView mirrors the same encoding for read mode.
 *
 * Persistence: 800ms debounce + flush on blur, mirroring InlineTextBlockEditor.
 * On 412 we just clear the conflict marker (the store keeps the snapshot).
 */
interface Props {
  slug: Slug
  block: ListBlock
}

const MAX_DEPTH = 4
const INDENT_UNIT = '  ' // 2 spaces == 1 depth level

/** Count leading 2-space pairs (capped at MAX_DEPTH). */
export function countDepth(item: string): number {
  let depth = 0
  let i = 0
  while (depth < MAX_DEPTH && item.startsWith(INDENT_UNIT, i)) {
    depth++
    i += INDENT_UNIT.length
  }
  return depth
}

/** Strip ALL leading 2-space pairs (returns the visible text). */
export function stripIndent(item: string): string {
  let i = 0
  while (item.startsWith(INDENT_UNIT, i)) i += INDENT_UNIT.length
  return item.slice(i)
}

/** Add one indent level (no-op if already at MAX_DEPTH). */
export function indentItem(item: string): string {
  return countDepth(item) >= MAX_DEPTH ? item : INDENT_UNIT + item
}

/** Remove one indent level (no-op if already at depth 0). */
export function outdentItem(item: string): string {
  return item.startsWith(INDENT_UNIT) ? item.slice(INDENT_UNIT.length) : item
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
        ...(block.options ? { options: block.options } : {}),
      } as never
      const result = await patchBlock(slug, block.id, patch, etag, '목록 수정')
      apply(result.document, result.etag)
      dirtyRef.current = false
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  const persistOptions = async (nextOptions: NonNullable<ListBlock['options']>) => {
    if (!etag) return
    try {
      const patch = {
        type: 'list' as const,
        id: block.id as Ulid,
        style: block.style,
        items: block.items,
        options: nextOptions,
      } as never
      const result = await patchBlock(slug, block.id, patch, etag, '목록 옵션 변경')
      apply(result.document, result.etag)
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
    // The contentEditable shows the *display* text only (no leading indent
    // pairs), so we re-prepend the stored item's depth on save.
    const visible = (ev.currentTarget.innerText ?? '').replace(/\n+$/, '')
    setItems((prev) => {
      const next = prev.slice()
      const prevDepth = countDepth(prev[idx] ?? '')
      next[idx] = INDENT_UNIT.repeat(prevDepth) + visible
      scheduleSave(next)
      return next
    })
  }

  const onItemKeyDown = (idx: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Tab / Shift+Tab — indent / outdent. preventDefault keeps focus put.
    if (e.key === 'Tab') {
      e.preventDefault()
      setItems((prev) => {
        const next = prev.slice()
        const cur = next[idx] ?? ''
        next[idx] = e.shiftKey ? outdentItem(cur) : indentItem(cur)
        scheduleSave(next)
        return next
      })
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Split at caret. The contentEditable shows visible (de-indented) text,
      // so we read head/tail in visible space and re-attach the current
      // item's depth to both halves so a nested item stays nested on Enter.
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
        const depth = countDepth(prev[idx] ?? '')
        const pad = INDENT_UNIT.repeat(depth)
        next[idx] = pad + head
        next.splice(idx + 1, 0, pad + tail)
        focusTargetRef.current = idx + 1
        scheduleSave(next)
        return next
      })
      return
    }
    if (e.key === 'Backspace') {
      const el = e.currentTarget
      // Only consume the keystroke when the visible item is empty AND there's
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
  // the user's actual prose (after the marker) is untouched. Operates on
  // the post-indent visible portion so depth is preserved.
  const isChecked = (visible: string) => /^\s*\[[xX]\]\s*/.test(visible)
  const toggleCheck = (idx: number) => {
    setItems((prev) => {
      const next = prev.slice()
      const cur = next[idx] ?? ''
      const depth = countDepth(cur)
      const pad = INDENT_UNIT.repeat(depth)
      const visible = stripIndent(cur)
      const flipped = isChecked(visible)
        ? visible.replace(/^\s*\[[xX]\]\s*/, '')
        : `[x] ${visible.replace(/^\s*\[\s*\]\s*/, '')}`
      next[idx] = pad + flipped
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

  // Bullet glyph by depth level (• → ◦ → ▪ for deeper nesting).
  const bulletGlyph = (depth: number): string => {
    if (depth <= 0) return '•'
    if (depth === 1) return '◦'
    return '▪'
  }

  // Numbered marker by depth: 1. → a. → i. → 1. (cycles after depth 3).
  // We re-count the index *within* each depth segment so 1, 2 → a, b, etc.
  const numberedMarker = (depth: number, indexAtDepth: number): string => {
    const mod = depth % 3
    if (mod === 0) return `${indexAtDepth + 1}.`
    if (mod === 1) return `${String.fromCharCode(97 + (indexAtDepth % 26))}.`
    return `${toRoman(indexAtDepth + 1)}.`
  }

  // Per-depth running index. Resets on depth change so each nested level
  // restarts at 1 (matches what people expect from <ol> nesting).
  const depthCounters: number[] = []
  let lastDepth = -1

  return (
    <div data-list-block-editor-root data-block-id={block.id}>
      <div className="mb-1 flex items-center justify-end">
        <ZebraToggle
          blockType="list"
          options={block.options}
          onChange={({ stripe }) => void persistOptions({ ...block.options, stripe })}
        />
      </div>
      <ul
        data-list-block-editor
        data-block-id={block.id}
        data-list-style={block.style}
        className="space-y-1"
        onBlur={onBlur}
      >
      {items.map((raw, idx) => {
        const depth = countDepth(raw)
        // Number-list counter bookkeeping: reset deeper levels when depth
        // shrinks; bump the current level.
        if (depth !== lastDepth) {
          if (depth > lastDepth) {
            depthCounters[depth] = 0
          } else {
            // Outdent: clear all deeper counters so they restart next time.
            for (let d = depth + 1; d < depthCounters.length; d++) {
              depthCounters[d] = 0
            }
          }
        }
        const indexAtDepth = depthCounters[depth] ?? 0
        depthCounters[depth] = indexAtDepth + 1
        lastDepth = depth

        const visible = stripIndent(raw)
        const checked = block.style === 'check' && isChecked(visible)
        const display = block.style === 'check' ? stripCheckPrefix(visible) : visible
        return (
          <li
            key={idx}
            className="flex items-start gap-2 text-[15px] leading-7"
            style={{ paddingLeft: `${depth * 1.5}rem` }}
            data-depth={depth}
          >
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
                {numberedMarker(depth, indexAtDepth)}
              </span>
            ) : (
              <span aria-hidden className="mt-0 inline-block min-w-[0.75rem] text-gray-500">
                {bulletGlyph(depth)}
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
      <li className="pointer-events-none mt-1 list-none text-[11px] text-gray-400">
        Tab으로 들여쓰기 / Shift+Tab으로 내어쓰기
      </li>
      </ul>
    </div>
  )
}

/** Tiny roman-numeral helper for the depth-2 numbered marker (i, ii, iii…). */
function toRoman(n: number): string {
  if (n <= 0) return ''
  const map: [number, string][] = [
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let out = ''
  let rem = n
  for (const [val, sym] of map) {
    while (rem >= val) {
      out += sym
      rem -= val
    }
  }
  return out
}
