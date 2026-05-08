import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Block, DocumentJSONV10, Slug, Ulid } from '@/types/document'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'

/**
 * FindReplaceModal — Ctrl+F overrides the browser find for the current article
 * (it would otherwise miss the contentEditable swarm + only highlight one
 * block at a time). Walks `draft.sections[*].blocks` (recursively into
 * subsections) and surfaces every match in the text-bearing fields:
 *
 *   - paragraph.text
 *   - heading-4.title
 *   - quote.text
 *   - callout.text / callout.title
 *   - list.items[]
 *   - code.code
 *   - table.headers / table.rows
 *
 * Replace-all fires one `patchBlock` per touched block, sequentially — small
 * docs in a wiki never have enough matches for this to be slow, and it lets
 * us surface per-block conflicts cleanly.
 *
 * Wires:
 *   - Open via Ctrl+F (preventDefault) when fullEdit is on, OR via the
 *     toolbar "찾기" button.
 *   - Close via Esc or the X button.
 *   - Case-insensitive by default; checkbox to toggle.
 *   - Whole-word + regex left out as YAGNI.
 */
interface Props {
  open: boolean
  onClose: () => void
  slug: Slug
}

interface Match {
  blockId: Ulid
  field: string // human label for context, e.g. "para.text" / "list.items[2]"
  preview: string
}

export function FindReplaceModal({ open, onClose, slug }: Props) {
  const draft = useEditorStore((s) => s.draft)
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [needle, setNeedle] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the search box when opened.
  useEffect(() => {
    if (open) {
      setStatus(null)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  // Esc closes.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const matches = useMemo<Match[]>(() => {
    if (!draft || needle.length === 0) return []
    const out: Match[] = []
    const flags = caseSensitive ? 'g' : 'gi'
    const re = safeRegex(needle, flags)
    if (!re) return []
    walkBlocks(draft, (block) => {
      const visit = (field: string, text: string | undefined | null) => {
        if (!text) return
        if (re.test(text)) {
          re.lastIndex = 0
          out.push({
            blockId: block.id,
            field,
            preview: previewSnippet(text, re),
          })
        }
      }
      switch (block.type) {
        case 'paragraph':
          visit('paragraph', block.text)
          break
        case 'heading-4':
          visit('heading', block.title)
          break
        case 'quote':
          visit('quote', block.text)
          break
        case 'callout':
          visit('callout', block.text)
          if (block.title) visit('callout.title', block.title)
          break
        case 'list':
          block.items.forEach((item, i) => visit(`list[${i}]`, item))
          break
        case 'code':
          visit('code', block.code)
          break
        case 'table':
          block.headers.forEach((h, i) => visit(`table.h[${i}]`, h))
          block.rows.forEach((row, ri) =>
            row.forEach((cell, ci) => visit(`table[${ri},${ci}]`, cell)),
          )
          break
        default:
          break
      }
    })
    return out
  }, [draft, needle, caseSensitive])

  const onReplaceAll = useCallback(async () => {
    if (!draft || !etag || needle.length === 0 || matches.length === 0) return
    setBusy(true)
    setStatus(null)
    let curEtag = etag
    let touched = 0
    const flags = caseSensitive ? 'g' : 'gi'
    // Group matches by block so we can issue one PATCH per block.
    const blockIds = Array.from(new Set(matches.map((m) => m.blockId)))
    try {
      for (const id of blockIds) {
        const block = findBlockById(draft, id)
        if (!block) continue
        const patched = replaceInBlock(block, needle, replacement, flags)
        if (!patched) continue
        try {
          const result = await patchBlock(slug, id, patched as never, curEtag, '찾기/바꾸기')
          curEtag = result.etag
          apply(result.document, result.etag)
          touched += 1
        } catch (err) {
          if (isPreconditionFailed(err)) {
            setConflict(null)
            setStatus('충돌 — 새로고침 후 다시 시도하세요.')
            break
          }
          throw err
        }
      }
      setStatus(`${touched}개 블록에서 변경 완료`)
    } catch {
      setStatus('일부 블록 변경에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }, [draft, etag, slug, matches, needle, replacement, caseSensitive, apply, setConflict])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="찾기 / 바꾸기"
      data-testid="find-replace-modal"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-smsg-900">찾기 / 바꾸기</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            aria-label="닫기"
          >
            Esc
          </button>
        </header>

        <div className="space-y-2">
          <input
            ref={inputRef}
            type="text"
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="찾을 텍스트…"
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none"
            data-testid="find-needle"
          />
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="바꿀 텍스트… (선택)"
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none"
            data-testid="find-replacement"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-smsg-700"
            />
            대소문자 구분
          </label>
        </div>

        <div className="mt-3 max-h-48 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800">
          {needle.length === 0 ? (
            <span className="text-gray-400">검색어를 입력하세요.</span>
          ) : matches.length === 0 ? (
            <span className="text-gray-400">일치하는 항목이 없습니다.</span>
          ) : (
            <ul className="space-y-1" data-testid="find-results">
              {matches.slice(0, 50).map((m, i) => (
                <li key={`${m.blockId}-${i}`} className="truncate">
                  <span className="mr-1 font-mono text-[10px] text-gray-400">
                    {m.field}
                  </span>
                  {m.preview}
                </li>
              ))}
              {matches.length > 50 && (
                <li className="text-gray-400">
                  …외 {matches.length - 50}개 더
                </li>
              )}
            </ul>
          )}
        </div>

        {status && (
          <p className="mt-2 text-xs text-smsg-700" data-testid="find-status">
            {status}
          </p>
        )}

        <footer className="mt-4 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {matches.length > 0 ? `${matches.length}개 일치` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              disabled={busy || matches.length === 0}
              onClick={() => void onReplaceAll()}
              className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="find-replace-all"
            >
              {busy ? '바꾸는 중…' : '모두 바꾸기'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** Compile a regex; return null when the pattern is invalid. */
function safeRegex(src: string, flags: string): RegExp | null {
  try {
    // Escape so the user can search literal symbols without learning regex.
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, flags)
  } catch {
    return null
  }
}

/** Build a short context preview around the first match. */
function previewSnippet(text: string, re: RegExp): string {
  re.lastIndex = 0
  const m = re.exec(text)
  if (!m) return text.slice(0, 80)
  const start = Math.max(0, m.index - 20)
  const end = Math.min(text.length, m.index + m[0].length + 30)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

/** Walk every block in the document, descending into subsections. */
function walkBlocks(doc: DocumentJSONV10, visit: (b: Block) => void) {
  for (const s1 of doc.sections) {
    for (const b of s1.blocks ?? []) visit(b)
    for (const s2 of s1.subsections ?? []) {
      for (const b of s2.blocks ?? []) visit(b)
      for (const s3 of s2.subsections ?? []) {
        for (const b of s3.blocks ?? []) visit(b)
      }
    }
  }
}

function findBlockById(doc: DocumentJSONV10, id: Ulid): Block | undefined {
  let found: Block | undefined
  walkBlocks(doc, (b) => {
    if (!found && b.id === id) found = b
  })
  return found
}

/**
 * Build a partial-block patch with the find/replace applied. Returns null
 * when the block has no text-bearing fields touched by the regex.
 */
function replaceInBlock(
  block: Block,
  needle: string,
  replacement: string,
  flags: string,
): Partial<Block> | null {
  const re = safeRegex(needle, flags)
  if (!re) return null
  switch (block.type) {
    case 'paragraph':
      if (!re.test(block.text)) return null
      return { type: 'paragraph', id: block.id, text: block.text.replace(re, replacement) }
    case 'heading-4':
      if (!re.test(block.title)) return null
      return { type: 'heading-4', id: block.id, title: block.title.replace(re, replacement) }
    case 'quote':
      if (!re.test(block.text)) return null
      return { type: 'quote', id: block.id, text: block.text.replace(re, replacement) }
    case 'callout': {
      const text = block.text.replace(re, replacement)
      const title = block.title ? block.title.replace(re, replacement) : undefined
      const changed = text !== block.text || title !== block.title
      if (!changed) return null
      return {
        type: 'callout',
        id: block.id,
        variant: block.variant,
        text,
        ...(title !== undefined ? { title } : {}),
      }
    }
    case 'list': {
      const items = block.items.map((it) => it.replace(re, replacement))
      if (items.every((v, i) => v === block.items[i])) return null
      return { type: 'list', id: block.id, style: block.style, items }
    }
    case 'code':
      if (!re.test(block.code)) return null
      return {
        type: 'code',
        id: block.id,
        language: block.language,
        code: block.code.replace(re, replacement),
      }
    case 'table': {
      const headers = block.headers.map((h) => h.replace(re, replacement))
      const rows = block.rows.map((row) => row.map((c) => c.replace(re, replacement)))
      const headersChanged = headers.some((v, i) => v !== block.headers[i])
      const rowsChanged = rows.some((row, ri) =>
        row.some((c, ci) => c !== block.rows[ri]?.[ci]),
      )
      if (!headersChanged && !rowsChanged) return null
      return { type: 'table', id: block.id, headers, rows }
    }
    default:
      return null
  }
}
