import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Block, DocumentJSONV10, Slug, Ulid } from '@/types/document'
import {
  deleteBlock,
  insertBlock,
  isPreconditionFailed,
  moveBlock,
} from '../api'
import { useEditorStore } from '../state'
import { useBulkSelectionStore } from '../bulkSelectionStore'
import { ulid } from '../ulid'

/**
 * BulkActionsBar — fixed bottom-center bar that surfaces multi-block
 * operations. Renders only when the bulk-selection store has at least one
 * block. The actions are intentionally sequential (one fetch per block) so
 * each `withFullDocFallback` GET sees a consistent etag chain — parallelizing
 * would race the If-Match header.
 *
 * Operations:
 *   - 삭제          DELETE per block.
 *   - 복제          POST a deep-cloned payload at index+1 for each.
 *   - 위/아래로 이동  POST /move within the owning section.
 *   - 다른 섹션으로 이동  pick a section, then /move with new section_id.
 *   - 클립보드에 복사    serialize blocks as JSON to navigator.clipboard.
 *   - 닫기          clear selection.
 *
 * Partial-failure handling: if any single mutation throws, we stop the loop
 * (the rest of the IDs may be stale — server already moved/deleted siblings).
 * The user sees a small inline error, and the selection is cleared so they
 * don't attempt the same op on now-stale IDs. ETag mismatches surface the
 * standard conflict modal via `setConflict`.
 */

interface Props {
  slug: Slug
  /** The same picker logic used by SectionLinkPicker — but inline here. */
}

interface FlatSection {
  id: Ulid
  number: string | null
  title: string
  level: 1 | 2 | 3
}

/** Walk the document tree and return all sections (with or without numbers). */
function flattenSections(doc: DocumentJSONV10 | null): FlatSection[] {
  if (!doc) return []
  const out: FlatSection[] = []
  type AnyS = {
    id: Ulid
    number?: string
    title: string
    level: 1 | 2 | 3
    subsections?: AnyS[]
  }
  const walk = (s: AnyS) => {
    out.push({
      id: s.id,
      number: s.number ?? null,
      title: s.title,
      level: s.level,
    })
    if (Array.isArray(s.subsections)) {
      for (const sub of s.subsections) walk(sub)
    }
  }
  for (const s of doc.sections as AnyS[]) walk(s)
  return out
}

/** Find which section in `doc` contains `blockId`, returning {sectionId, index}. */
function locateBlock(
  doc: DocumentJSONV10 | null,
  blockId: Ulid,
): { sectionId: Ulid; index: number } | null {
  if (!doc) return null
  type AnyS = {
    id: Ulid
    blocks: Block[]
    subsections?: AnyS[]
  }
  const stack: AnyS[] = [...(doc.sections as AnyS[])]
  while (stack.length > 0) {
    const s = stack.pop()
    if (!s) continue
    const idx = s.blocks.findIndex((b) => b.id === blockId)
    if (idx >= 0) return { sectionId: s.id, index: idx }
    if (Array.isArray(s.subsections)) {
      stack.push(...s.subsections)
    }
  }
  return null
}

/**
 * Deep-clone a block AND every nested block ID (columns / tabs / accordion
 * sub-trees own their own Block[] children). The schema requires a fresh
 * 26-char ULID per cloned block so the BE doesn't reject the insert as a
 * duplicate.
 */
export function cloneBlockWithNewIds(block: Block): Block {
  const copy = JSON.parse(JSON.stringify(block)) as Block
  reassignIds(copy)
  return copy
}

function reassignIds(b: Block): void {
  ;(b as { id: string }).id = ulid()
  // Recurse into the three container block types.
  if (b.type === 'columns') {
    for (const col of b.columns) {
      for (const child of col) reassignIds(child)
    }
    return
  }
  if (b.type === 'tabs' || b.type === 'accordion') {
    const items = b.type === 'tabs' ? b.tabs : b.items
    for (const item of items) {
      for (const child of item.blocks) reassignIds(child)
    }
  }
}

/**
 * Validate a parsed clipboard payload looks like a Block[] — the bare minimum
 * is `[{type, id, ...}]`. We don't run the whole schema (zod isn't wired here
 * for blocks) but we filter junk.
 */
export function looksLikeBlockArray(value: unknown): value is Block[] {
  if (!Array.isArray(value)) return false
  for (const v of value) {
    if (!v || typeof v !== 'object') return false
    const o = v as { type?: unknown; id?: unknown }
    if (typeof o.type !== 'string' || typeof o.id !== 'string') return false
  }
  return true
}

/**
 * Bulk-operation deps — passed in by the React layer so the loops are
 * testable in isolation (mock fns + a fake doc). Keeps the loop bodies
 * free of zustand getState gymnastics.
 */
export interface BulkOpDeps {
  slug: Slug
  /** Returns the current snapshot — fresh on each iteration. */
  getDoc: () => DocumentJSONV10 | null
  /** Returns the current etag — fresh on each iteration. */
  getEtag: () => string | null
  /** Apply a successful mutation result back to the editor store. */
  apply: (doc: DocumentJSONV10, etag: string) => void
  /** Surface a 412 to the conflict modal. */
  onConflict: () => void
  /** API hooks — can be mocked in tests. */
  api: {
    deleteBlock: typeof deleteBlock
    insertBlock: typeof insertBlock
    moveBlock: typeof moveBlock
  }
}

/** Stops the loop on first failure — see partial-failure handling note. */
export async function runBulkDelete(ids: Ulid[], deps: BulkOpDeps): Promise<{
  ok: number
  failed: number
}> {
  let ok = 0
  let failed = 0
  for (const id of ids) {
    const tag = deps.getEtag()
    if (!tag) {
      failed = ids.length - ok
      break
    }
    try {
      const result = await deps.api.deleteBlock(deps.slug, id, tag, '여러 블록 삭제')
      deps.apply(result.document, result.etag)
      ok++
    } catch (err) {
      if (isPreconditionFailed(err)) deps.onConflict()
      failed = ids.length - ok
      break
    }
  }
  return { ok, failed }
}

export async function runBulkDuplicate(
  ids: Ulid[],
  deps: BulkOpDeps,
): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  for (const id of ids) {
    const doc = deps.getDoc()
    const tag = deps.getEtag()
    if (!doc || !tag) {
      failed = ids.length - ok
      break
    }
    const loc = locateBlock(doc, id)
    if (!loc) continue
    // Find the original payload — flat-walk over all blocks (incl. nested).
    const all = doc.sections.flatMap((s) => collectBlocksRecursive(s))
    const original = all.find((b) => b.id === id)
    if (!original) continue
    const clone = cloneBlockWithNewIds(original)
    try {
      const result = await deps.api.insertBlock(
        deps.slug,
        { section_id: loc.sectionId, index: loc.index + 1, block: clone },
        tag,
        '여러 블록 복제',
      )
      deps.apply(result.document, result.etag)
      ok++
    } catch (err) {
      if (isPreconditionFailed(err)) deps.onConflict()
      failed = ids.length - ok
      break
    }
  }
  return { ok, failed }
}

export async function runBulkMoveToSection(
  ids: Ulid[],
  toSectionId: Ulid,
  deps: BulkOpDeps,
): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  for (const id of ids) {
    const tag = deps.getEtag()
    if (!tag) {
      failed = ids.length - ok
      break
    }
    try {
      const result = await deps.api.moveBlock(
        deps.slug,
        id,
        { to_section_id: toSectionId, to_index: -1 },
        tag,
        '다른 섹션으로 이동',
      )
      deps.apply(result.document, result.etag)
      ok++
    } catch (err) {
      if (isPreconditionFailed(err)) deps.onConflict()
      failed = ids.length - ok
      break
    }
  }
  return { ok, failed }
}

export function BulkActionsBar({ slug }: Props) {
  const draft = useEditorStore((s) => s.draft)
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const selected = useBulkSelectionStore((s) => s.selected)
  const clear = useBulkSelectionStore((s) => s.clear)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const ids = useMemo(() => Array.from(selected), [selected])
  const count = ids.length

  // Auto-clear inline status messages so they don't pile up.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const sections = useMemo(() => flattenSections(draft), [draft])

  /**
   * Always re-read the latest doc + etag on each iteration: each successful
   * mutation rotates the etag, so we MUST take the freshest value from the
   * store between calls.
   */
  const currentDoc = useCallback(() => useEditorStore.getState().draft, [])
  const currentEtag = useCallback(() => useEditorStore.getState().etag, [])

  const handleDelete = useCallback(async () => {
    if (count === 0 || busy) return
    setBusy(true)
    setErr(null)
    try {
      // Iterate over a snapshot of IDs — selection clears after.
      for (const id of ids) {
        const tag = currentEtag()
        if (!tag) break
        try {
          const result = await deleteBlock(slug, id, tag, '여러 블록 삭제')
          apply(result.document, result.etag)
        } catch (e) {
          if (isPreconditionFailed(e)) {
            setConflict(null)
            setErr('충돌이 발생해 일부만 삭제되었습니다.')
          } else {
            setErr('삭제 중 일부 블록에서 오류가 발생했습니다.')
          }
          break
        }
      }
      setToast('되돌리려면 Ctrl+Z')
    } finally {
      clear()
      setBusy(false)
    }
  }, [busy, count, ids, slug, apply, setConflict, currentEtag, clear])

  const handleDuplicate = useCallback(async () => {
    if (count === 0 || busy) return
    setBusy(true)
    setErr(null)
    try {
      for (const id of ids) {
        const doc = currentDoc()
        const tag = currentEtag()
        if (!doc || !tag) break
        const loc = locateBlock(doc, id)
        if (!loc) continue
        const original = doc.sections
          .flatMap((sec) => collectBlocksRecursive(sec))
          .find((b) => b.id === id)
        if (!original) continue
        const clone = cloneBlockWithNewIds(original)
        try {
          const result = await insertBlock(
            slug,
            { section_id: loc.sectionId, index: loc.index + 1, block: clone },
            tag,
            '여러 블록 복제',
          )
          apply(result.document, result.etag)
        } catch (e) {
          if (isPreconditionFailed(e)) setConflict(null)
          setErr('복제 중 일부 블록에서 오류가 발생했습니다.')
          break
        }
      }
    } finally {
      clear()
      setBusy(false)
    }
  }, [busy, count, ids, slug, apply, setConflict, currentDoc, currentEtag, clear])

  const handleMoveDirection = useCallback(
    async (dir: 'up' | 'down') => {
      if (count === 0 || busy) return
      setBusy(true)
      setErr(null)
      try {
        // To preserve relative order: when moving UP iterate top-to-bottom
        // (each block's prior sibling is already in its final spot), when
        // moving DOWN iterate bottom-to-top.
        const orderedIds = [...ids]
        orderedIds.sort((a, b) => {
          const da = currentDoc()
          if (!da) return 0
          const la = locateBlock(da, a)
          const lb = locateBlock(da, b)
          if (!la || !lb) return 0
          return la.index - lb.index
        })
        const queue = dir === 'up' ? orderedIds : [...orderedIds].reverse()
        for (const id of queue) {
          const doc = currentDoc()
          const tag = currentEtag()
          if (!doc || !tag) break
          const loc = locateBlock(doc, id)
          if (!loc) continue
          const newIdx = dir === 'up' ? loc.index - 1 : loc.index + 1
          if (newIdx < 0) continue
          try {
            const result = await moveBlock(
              slug,
              id,
              { to_section_id: loc.sectionId, to_index: newIdx },
              tag,
              `여러 블록 ${dir === 'up' ? '위' : '아래'}로 이동`,
            )
            apply(result.document, result.etag)
          } catch (e) {
            if (isPreconditionFailed(e)) setConflict(null)
            setErr('이동 중 일부 블록에서 오류가 발생했습니다.')
            break
          }
        }
      } finally {
        setBusy(false)
        // Keep selection — user may want to keep nudging.
      }
    },
    [busy, count, ids, slug, apply, setConflict, currentDoc, currentEtag],
  )

  const handleMoveToSection = useCallback(
    async (toSectionId: Ulid) => {
      if (count === 0 || busy) return
      setBusy(true)
      setErr(null)
      try {
        for (const id of ids) {
          const tag = currentEtag()
          if (!tag) break
          try {
            const result = await moveBlock(
              slug,
              id,
              { to_section_id: toSectionId, to_index: -1 },
              tag,
              '다른 섹션으로 이동',
            )
            apply(result.document, result.etag)
          } catch (e) {
            if (isPreconditionFailed(e)) setConflict(null)
            setErr('섹션 이동 중 일부 블록에서 오류가 발생했습니다.')
            break
          }
        }
      } finally {
        setShowSectionPicker(false)
        clear()
        setBusy(false)
      }
    },
    [busy, count, ids, slug, apply, setConflict, currentEtag, clear],
  )

  const handleCopyClipboard = useCallback(async () => {
    if (count === 0 || busy) return
    const doc = currentDoc()
    if (!doc) return
    const blocks: Block[] = []
    for (const s of doc.sections) {
      for (const b of collectBlocksRecursive(s)) {
        if (selected.has(b.id)) blocks.push(b)
      }
    }
    if (blocks.length === 0) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(blocks, null, 2))
      setToast(`${blocks.length}개 블록이 클립보드에 복사됐어요.`)
    } catch {
      setErr('클립보드 복사에 실패했습니다.')
    }
  }, [busy, count, currentDoc, selected])

  if (count === 0) return null

  return (
    <>
      <BulkActionsBarView
        count={count}
        busy={busy}
        onDelete={() => void handleDelete()}
        onDuplicate={() => void handleDuplicate()}
        onMoveUp={() => void handleMoveDirection('up')}
        onMoveDown={() => void handleMoveDirection('down')}
        onPickSection={() => setShowSectionPicker(true)}
        onCopy={() => void handleCopyClipboard()}
        onClose={() => clear()}
      />

      {err && (
        <div
          role="alert"
          data-testid="bulk-actions-error"
          className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-md bg-red-600 px-3 py-1 text-xs text-white shadow"
        >
          {err}
        </div>
      )}
      {toast && (
        <div
          role="status"
          data-testid="bulk-actions-toast"
          className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-md bg-gray-900 px-3 py-1 text-xs text-white shadow dark:bg-gray-100 dark:text-gray-900"
        >
          {toast}
        </div>
      )}

      {showSectionPicker && (
        <BulkSectionPicker
          sections={sections}
          onPick={(id) => void handleMoveToSection(id)}
          onCancel={() => setShowSectionPicker(false)}
        />
      )}
    </>
  )
}

/**
 * Presentational view — split out so the markup is testable in SSR without
 * needing the zustand store to surface its current state (zustand v5's
 * `getServerSnapshot` returns the initial state, so `setState` writes don't
 * make it into `renderToStaticMarkup` output).
 */
export interface BulkActionsBarViewProps {
  count: number
  busy?: boolean
  onDelete: () => void
  onDuplicate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onPickSection: () => void
  onCopy: () => void
  onClose: () => void
}

export function BulkActionsBarView({
  count,
  busy = false,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onPickSection,
  onCopy,
  onClose,
}: BulkActionsBarViewProps) {
  return (
    <div
      role="toolbar"
      aria-label="블록 일괄 작업"
      data-testid="bulk-actions-bar"
      className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 flex items-center gap-2 rounded-full border border-smsg-300 bg-white px-3 py-2 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <span
        data-testid="bulk-actions-count"
        className="rounded-full bg-smsg-100 px-2 py-0.5 text-xs font-medium text-smsg-900 dark:bg-smsg-900 dark:text-smsg-100"
      >
        {count}개 블록 선택됨
      </span>

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        data-testid="bulk-action-delete"
        className="rounded px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/30"
      >
        삭제
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        disabled={busy}
        data-testid="bulk-action-duplicate"
        className="rounded px-2 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        복제
      </button>
      <button
        type="button"
        onClick={onMoveUp}
        disabled={busy}
        data-testid="bulk-action-move-up"
        className="rounded px-2 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        위로 이동
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={busy}
        data-testid="bulk-action-move-down"
        className="rounded px-2 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        아래로 이동
      </button>
      <button
        type="button"
        onClick={onPickSection}
        disabled={busy}
        data-testid="bulk-action-move-section"
        className="rounded px-2 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        다른 섹션으로 이동
      </button>
      <button
        type="button"
        onClick={onCopy}
        disabled={busy}
        data-testid="bulk-action-copy"
        className="rounded px-2 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        클립보드에 복사
      </button>

      <span className="mx-1 h-4 w-px bg-gray-300 dark:bg-gray-700" aria-hidden />

      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        data-testid="bulk-action-close"
        aria-label="선택 해제"
        className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        닫기
      </button>
    </div>
  )
}

/** Recursive collector for blocks across container blocks (columns/tabs/accordion). */
function collectBlocksRecursive(node: {
  blocks?: Block[]
  subsections?: Array<{ blocks?: Block[]; subsections?: unknown }>
}): Block[] {
  const out: Block[] = []
  const visitBlocks = (arr: Block[] | undefined) => {
    if (!arr) return
    for (const b of arr) {
      out.push(b)
      if (b.type === 'columns') {
        for (const col of b.columns) visitBlocks(col)
      } else if (b.type === 'tabs') {
        for (const t of b.tabs) visitBlocks(t.blocks)
      } else if (b.type === 'accordion') {
        for (const it of b.items) visitBlocks(it.blocks)
      }
    }
  }
  visitBlocks(node.blocks)
  if (Array.isArray(node.subsections)) {
    for (const sub of node.subsections) out.push(...collectBlocksRecursive(sub as never))
  }
  return out
}

interface BulkSectionPickerProps {
  sections: FlatSection[]
  onPick: (sectionId: Ulid) => void
  onCancel: () => void
}

function BulkSectionPicker({ sections, onPick, onCancel }: BulkSectionPickerProps) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    return sections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.number ?? '').toLowerCase().includes(q),
    )
  }, [sections, query])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="대상 섹션 선택"
      data-testid="bulk-section-picker"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="w-full max-w-lg rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
        <div className="border-b border-gray-200 p-3 dark:border-gray-700">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="섹션 번호 또는 제목으로 검색"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
            aria-label="섹션 검색"
            data-testid="bulk-section-picker-search"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">
              일치하는 섹션이 없습니다.
            </li>
          ) : (
            filtered.map((s) => {
              const indent = s.level === 1 ? 'pl-3' : s.level === 2 ? 'pl-6' : 'pl-9'
              return (
                <li key={s.id} role="option">
                  <button
                    type="button"
                    onClick={() => onPick(s.id)}
                    className={`flex w-full items-baseline gap-2 ${indent} pr-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800`}
                    data-testid="bulk-section-picker-item"
                  >
                    {s.number && (
                      <span className="font-mono text-xs text-gray-500">
                        {s.number}
                      </span>
                    )}
                    <span className="truncate">{s.title}</span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <div className="flex justify-end border-t border-gray-200 px-3 py-2 dark:border-gray-700">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}
