import { useEffect, useMemo, useRef, useState } from 'react'
import { listTags, type TagSuggestion } from './api'

/**
 * Reusable tag chip-input with debounced autocomplete.
 *
 * Behavior:
 *   - typing → 200ms debounced GET /tags?q=<prefix>
 *   - Enter / click suggestion → adds chip
 *   - "," or Enter on a free-typed value → adds chip (server hasn't seen it yet — fine)
 *   - Backspace on empty input → removes last chip
 */
export interface TagAutocompleteProps {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  id?: string
  ['data-testid']?: string
}

export function TagAutocomplete({
  value,
  onChange,
  placeholder,
  id,
  'data-testid': testId,
}: TagAutocompleteProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 200ms debounce on autocomplete fetch.
  useEffect(() => {
    if (!open) return
    const q = input.trim()
    let cancelled = false
    const handle = setTimeout(() => {
      void listTags({ q: q || undefined, limit: 8 })
        .then((items) => {
          if (cancelled) return
          // Filter already-selected tags out of the suggestion list so users
          // don't double-add (the chip-add path also dedupes — defense in depth).
          const filtered = (items ?? []).filter((it) => !value.includes(it.name))
          setSuggestions(filtered)
          setActiveIdx(0)
        })
        .catch(() => {
          if (cancelled) return
          setSuggestions([])
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [input, open, value])

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const dedupedSuggestions = useMemo(() => suggestions, [suggestions])

  function add(tag: string) {
    const t = tag.trim()
    if (!t) return
    if (value.includes(t)) {
      setInput('')
      return
    }
    onChange([...value, t])
    setInput('')
    setSuggestions([])
  }

  function removeAt(i: number) {
    const next = value.slice()
    next.splice(i, 1)
    onChange(next)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      // If a suggestion is highlighted and we're showing them, pick it.
      if (open && dedupedSuggestions.length > 0) {
        const pick = dedupedSuggestions[activeIdx] ?? dedupedSuggestions[0]
        if (pick) {
          add(pick.name)
          return
        }
      }
      // Otherwise add the free-typed value.
      add(input)
      return
    }
    if (e.key === 'Backspace' && input === '' && value.length > 0) {
      removeAt(value.length - 1)
      return
    }
    if (e.key === 'ArrowDown') {
      if (!open) setOpen(true)
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, dedupedSuggestions.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
  }

  return (
    <div
      ref={wrapRef}
      className="relative"
      data-testid={testId ?? 'tag-autocomplete'}
    >
      <div
        className="flex flex-wrap items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 focus-within:border-smsg-700 dark:border-gray-700 dark:bg-gray-900"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            data-testid="tag-chip"
            className="inline-flex items-center gap-1 rounded-full bg-smsg-100 px-2 py-0.5 text-xs font-medium text-smsg-800 dark:bg-smsg-900/40 dark:text-smsg-100"
          >
            #{tag}
            <button
              type="button"
              aria-label={`태그 ${tag} 제거`}
              onClick={(e) => {
                e.stopPropagation()
                removeAt(i)
              }}
              className="ml-0.5 rounded-full px-1 text-smsg-700 hover:bg-smsg-200 dark:text-smsg-200 dark:hover:bg-smsg-800/40"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? (placeholder ?? '태그 입력 후 Enter') : ''}
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-gray-400 dark:text-gray-100"
          data-testid="tag-autocomplete-input"
          autoComplete="off"
        />
      </div>

      {open && dedupedSuggestions.length > 0 && (
        <ul
          role="listbox"
          data-testid="tag-autocomplete-suggestions"
          className="absolute left-0 right-0 z-popover mt-1 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {dedupedSuggestions.map((it, i) => (
            <li key={it.name}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={(e) => {
                  // mousedown so the click fires before the input's blur closes
                  // the dropdown.
                  e.preventDefault()
                  add(it.name)
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={
                  'flex w-full items-center justify-between px-3 py-1.5 text-left ' +
                  (i === activeIdx
                    ? 'bg-smsg-50 text-smsg-900 dark:bg-smsg-900/40 dark:text-smsg-100'
                    : 'text-gray-700 dark:text-gray-200')
                }
                data-testid={`tag-suggestion-${it.name}`}
              >
                <span>#{it.name}</span>
                <span className="text-xs text-gray-500">{it.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
