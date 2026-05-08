import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { searchDocuments } from '@/features/search/api'
import { searchUsers } from '@/features/auth/api'

/**
 * WikiLink + Mention inline autocomplete.
 *
 * Architecture:
 *   - The pure helper `detectTrigger` watches the text immediately preceding
 *     the caret and returns `{ kind, query }` when the user is mid-trigger:
 *       `[[ho`  → wiki / "ho"
 *       `@joh`  → mention / "joh"
 *       `:smi`  → emoji / "smi"
 *     Returns null otherwise.
 *
 *   - The React component `<EditorTriggerOverlay>` listens for `keydown` /
 *     `input` on a contentEditable surface (the BlockNote root), runs the
 *     detector, fetches matches from the appropriate source, and pops a small
 *     anchored menu next to the caret. ↑/↓ navigates, Enter selects, Esc
 *     closes.
 *
 *   - On selection, the overlay calls `onSelect` with the trigger metadata
 *     and the chosen item; the host wires this to BlockNote's API to splice
 *     the autocomplete into the document.
 *
 * This module avoids depending on BlockNote internals so the unit tests can
 * exercise `detectTrigger` directly.
 */

import { findEmoji, type EmojiEntry } from './emoji-dict'

export type TriggerKind = 'wiki' | 'mention' | 'emoji'

export interface TriggerMatch {
  kind: TriggerKind
  /** Length in characters that the autocomplete will replace (incl. trigger). */
  consume: number
  /** Substring after the trigger marker. */
  query: string
}

/**
 * Inspect the text before the caret and decide whether an autocomplete
 * trigger is active. Pure — exercised heavily by tests.
 */
export function detectTrigger(textBeforeCaret: string): TriggerMatch | null {
  if (!textBeforeCaret) return null

  // 1) Wiki link `[[query`
  // Look back for `[[` not followed by `[` (so triple `[[[` won't trigger).
  const wikiIdx = textBeforeCaret.lastIndexOf('[[')
  if (wikiIdx !== -1) {
    const slice = textBeforeCaret.slice(wikiIdx)
    // Must not contain a closing `]]` (already closed) or whitespace.
    if (!slice.includes(']]') && !/\n/.test(slice)) {
      const query = slice.slice(2)
      // Bail out if query has unsupported chars like `[[ `, `[[!`.
      if (/^[a-z0-9가-힣 _-]*$/i.test(query)) {
        return { kind: 'wiki', consume: 2 + query.length, query }
      }
    }
  }

  // 2) Mention `@query`
  // Trigger only when `@` is preceded by start-of-input or whitespace.
  const atIdx = textBeforeCaret.lastIndexOf('@')
  if (atIdx !== -1) {
    const before = atIdx === 0 ? ' ' : textBeforeCaret[atIdx - 1]!
    const after = textBeforeCaret.slice(atIdx + 1)
    if (/\s/.test(before) && !/[\s@]/.test(after) && after.length <= 32) {
      // Subtle: a typed-and-deleted `@` should still capture; allow empty.
      return { kind: 'mention', consume: 1 + after.length, query: after }
    }
  }

  // 3) Emoji `:query`
  const colonIdx = textBeforeCaret.lastIndexOf(':')
  if (colonIdx !== -1) {
    const before = colonIdx === 0 ? ' ' : textBeforeCaret[colonIdx - 1]!
    const after = textBeforeCaret.slice(colonIdx + 1)
    if (/\s/.test(before) && /^[a-z0-9_+-]{0,32}$/i.test(after)) {
      return { kind: 'emoji', consume: 1 + after.length, query: after }
    }
  }

  return null
}

export interface AutocompleteItem {
  id: string
  /** Korean / display label. */
  label: string
  /** Helper subtitle. */
  sublabel?: string
  /** What the picker inserts on selection (already formatted). */
  insertText: string
}

/* ── Source adapters ───────────────────────────────────────────────────── */

export async function fetchWikiCandidates(q: string): Promise<AutocompleteItem[]> {
  const safe = q.trim()
  if (!safe) return []
  try {
    const hits = await searchDocuments(safe, 10)
    const items: AutocompleteItem[] = hits.slice(0, 10).map((h) => ({
      id: h.slug,
      label: h.title,
      sublabel: h.slug,
      insertText: `[[${h.slug}|${h.title}]]`,
    }))
    // Always offer a "create" fallback at the bottom when the slug looks valid.
    if (/^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/i.test(safe)) {
      items.push({
        id: `__create:${safe}`,
        label: `+ '${safe}' 작성하기`,
        sublabel: '/docs/new?slug=…',
        insertText: `__create__${safe}`,
      })
    }
    return items
  } catch {
    return []
  }
}

export async function fetchMentionCandidates(q: string): Promise<AutocompleteItem[]> {
  const safe = q.trim()
  if (!safe) return []
  try {
    const users = await searchUsers(safe, 10)
    return users.map((u) => ({
      id: u.id,
      label: u.name ?? u.email,
      sublabel: u.email,
      insertText: `@${u.name ?? u.email}`,
    }))
  } catch {
    return []
  }
}

export function fetchEmojiCandidates(q: string): AutocompleteItem[] {
  const matches: EmojiEntry[] = findEmoji(q, 10)
  return matches.map((e) => ({
    id: e.code,
    label: `${e.glyph} :${e.code}:`,
    sublabel: (e.aliases ?? []).slice(0, 3).join(' '),
    insertText: e.glyph,
  }))
}

/* ── React overlay ─────────────────────────────────────────────────────── */

export interface OverlaySelection {
  match: TriggerMatch
  item: AutocompleteItem
}

interface OverlayProps {
  /** Ref to the contentEditable host (BlockNote surface). */
  hostRef: React.RefObject<HTMLElement | null>
  /** Called when the user picks an item. */
  onSelect: (sel: OverlaySelection) => void
}

/**
 * Inline overlay rendered next to the caret. Listens to the host's keystrokes
 * and shows up only while a trigger is active. Designed to be mounted once
 * inside the editor wrapper.
 */
export function EditorTriggerOverlay({ hostRef, onSelect }: OverlayProps) {
  const [match, setMatch] = useState<TriggerMatch | null>(null)
  const [items, setItems] = useState<AutocompleteItem[]>([])
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const reqRef = useRef(0)

  // Listen to selection / input changes on the host.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const close = () => {
      setMatch(null)
      setItems([])
      setActive(0)
      setPos(null)
    }

    const evaluate = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) {
        close()
        return
      }
      const range = sel.getRangeAt(0)
      const node = range.startContainer
      if (!host.contains(node)) {
        close()
        return
      }
      const text = node.nodeType === Node.TEXT_NODE
        ? (node.textContent ?? '').slice(0, range.startOffset)
        : ''
      const m = detectTrigger(text)
      if (!m) {
        close()
        return
      }
      setMatch(m)

      // Position the overlay just below the caret.
      const rect = range.getBoundingClientRect()
      setPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX })

      const id = ++reqRef.current
      const fetcher =
        m.kind === 'wiki'
          ? fetchWikiCandidates(m.query)
          : m.kind === 'mention'
            ? fetchMentionCandidates(m.query)
            : Promise.resolve(fetchEmojiCandidates(m.query))
      Promise.resolve(fetcher).then((next) => {
        if (id === reqRef.current) {
          setItems(next)
          setActive(0)
        }
      })
    }

    const onKey = (ev: KeyboardEvent) => {
      // Only intercept when the menu is open.
      if (!match || items.length === 0) {
        // Schedule a re-evaluation after the keystroke has applied.
        queueMicrotask(evaluate)
        return
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault()
        setActive((i) => (i + 1) % items.length)
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault()
        setActive((i) => (i - 1 + items.length) % items.length)
      } else if (ev.key === 'Enter') {
        ev.preventDefault()
        const item = items[active]
        if (item) onSelect({ match, item })
        close()
      } else if (ev.key === 'Escape') {
        ev.preventDefault()
        close()
      } else {
        queueMicrotask(evaluate)
      }
    }

    const onInput = () => queueMicrotask(evaluate)

    host.addEventListener('keydown', onKey)
    host.addEventListener('input', onInput)
    return () => {
      host.removeEventListener('keydown', onKey)
      host.removeEventListener('input', onInput)
    }
  }, [hostRef, match, items, active, onSelect])

  if (!match || !pos || items.length === 0) return null

  const style: CSSProperties = {
    position: 'absolute',
    top: pos.top,
    left: pos.left,
    zIndex: 50,
    minWidth: 240,
    maxWidth: 360,
  }
  return (
    <div
      data-trigger-overlay={match.kind}
      style={style}
      className="rounded-md border border-gray-200 bg-white text-xs shadow-lg"
      role="listbox"
    >
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect({ match, item: it })
          }}
          onMouseEnter={() => setActive(i)}
          className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${
            i === active ? 'bg-smsg-50' : 'bg-white'
          } hover:bg-smsg-50`}
        >
          <span className="truncate font-medium text-gray-900">{it.label}</span>
          {it.sublabel && (
            <span className="truncate text-[11px] text-gray-500">{it.sublabel}</span>
          )}
        </button>
      ))}
    </div>
  )
}
