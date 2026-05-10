import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type {
  DocumentJSONV10,
  SectionLevel1,
  Slug,
  Ulid,
} from '@/types/document'
import {
  patchSection,
  reorderSections,
  isPreconditionFailed,
  type SectionOutlineNode,
} from '../api'
import { useEditorStore } from '../state'
import { ulid } from '../ulid'

interface OutlinePanelProps {
  slug: Slug
  document: DocumentJSONV10
}

interface FlatRow {
  id: Ulid
  level: number
  title: string
  parentId: Ulid | null
}

/**
 * Flatten the section tree into rows for dnd. Recurses to arbitrary
 * depth — schema no longer caps section nesting.
 */
function flatten(doc: DocumentJSONV10): FlatRow[] {
  const out: FlatRow[] = []
  type Section = DocumentJSONV10['sections'][number]
  const walk = (sec: Section, level: number, parentId: Ulid | null) => {
    out.push({ id: sec.id, level, title: sec.title, parentId })
    for (const sub of sec.subsections ?? []) {
      walk(sub as Section, level + 1, sec.id)
    }
  }
  for (const s1 of doc.sections) walk(s1, 1, null)
  return out
}

/** Stable string signature of the section tree — used as a dependency
 *  guard so we only re-sync `rows` when the actual outline changes (id /
 *  level / title), not on every parent re-render. */
function signature(doc: DocumentJSONV10): string {
  const rows = flatten(doc)
  return rows.map((r) => `${r.id}|${r.level}|${r.title}`).join('//')
}

function sameRows(a: FlatRow[], b: FlatRow[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.id !== y.id || x.level !== y.level || x.title !== y.title) return false
  }
  return true
}

/** Convert flat rows back into the nested outline payload the BE expects.
 *  Uses a stack indexed by depth so an arbitrary level mix (1, 2, 4, 1, 3)
 *  still produces a well-formed tree. */
function rowsToOutline(
  rows: FlatRow[],
  doc: DocumentJSONV10,
): SectionOutlineNode[] {
  const titleById = new Map<Ulid, string>()
  type Section = DocumentJSONV10['sections'][number]
  const collect = (sec: Section) => {
    titleById.set(sec.id, sec.title)
    for (const sub of sec.subsections ?? []) collect(sub as Section)
  }
  for (const s of doc.sections) collect(s)

  const out: SectionOutlineNode[] = []
  // Stack of currently-open parents, ordered by depth.
  const stack: SectionOutlineNode[] = []
  for (const r of rows) {
    // Pop until the top of the stack is one level above this row.
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= r.level) {
      stack.pop()
    }
    const node: SectionOutlineNode = {
      id: r.id,
      level: r.level,
      title: r.title || titleById.get(r.id) || '',
      children: [],
    }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else out.push(node)
    stack.push(node)
  }
  return out
}

/**
 * Outline panel — renders inside the left sidebar in fullEdit mode.
 * Provides drag-to-reorder, indent/outdent, add/delete/duplicate.
 */
export function OutlinePanel({ slug, document }: OutlinePanelProps) {
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const setDraft = useEditorStore((s) => s.setDraft)

  const [rows, setRows] = useState<FlatRow[]>(() => flatten(document))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<Ulid | null>(rows[0]?.id ?? null)

  // Track whether any title input inside this panel is focused. While the
  // user is typing we MUST NOT clobber `rows` from the server snapshot —
  // doing so eats their keystrokes mid-flight (the previous `useMemo`
  // pattern had this exact bug).
  const isTypingRef = useRef(false)

  // Re-sync when the document's section tree actually changes. We compare
  // a stable signature (id + level + title per row) instead of the prop
  // reference because the parent re-renders the doc on every keystroke
  // somewhere else in the editor and a reference-only check would still
  // wipe rows.
  useEffect(() => {
    if (isTypingRef.current) return
    const next = flatten(document)
    setRows((prev) => (sameRows(prev, next) ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature(document)])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const commit = useCallback(
    async (next: FlatRow[]) => {
      if (!etag) return
      setBusy(true)
      setError(null)
      try {
        const outline = rowsToOutline(next, document)
        const result = await reorderSections(slug, outline, etag, '섹션 재정렬')
        applySnapshot(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) {
          setConflict(null)
          setError('충돌 발생 — 새로고침이 필요합니다')
        } else {
          setError((err as Error).message)
        }
      } finally {
        setBusy(false)
      }
    },
    [slug, etag, document, applySnapshot, setConflict],
  )

  /**
   * Commit a *rename* — title-only update. Goes through `patchSection`
   * (cheap PATCH on a single section) instead of the much heavier
   * `reorderSections` (which rebuilds the whole tree). This was the root
   * cause of the "이름 입력해도 잘 안된다" complaint: every keystroke
   * triggered a full tree rebuild on the server, the response wiped local
   * `rows`, and subsequent keystrokes fought the round-trip.
   */
  const commitRename = useCallback(
    async (sectionId: Ulid, newTitle: string) => {
      if (!etag) return
      const trimmed = newTitle.trim()
      if (!trimmed) {
        // Schema requires non-empty title — surface a clear error and
        // refuse the patch instead of letting the BE 422 through.
        setError('섹션 제목은 비울 수 없어요')
        return
      }
      setError(null)
      try {
        const result = await patchSection(
          slug,
          sectionId,
          { title: trimmed },
          etag,
          '섹션 이름 수정',
        )
        applySnapshot(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) {
          setConflict(null)
          setError('충돌 발생 — 새로고침이 필요합니다')
        } else {
          setError((err as Error).message)
        }
      }
    },
    [slug, etag, applySnapshot, setConflict],
  )

  const handleDragEnd = useCallback(
    (ev: DragEndEvent) => {
      const { active, over } = ev
      if (!over || active.id === over.id) return
      const oldIdx = rows.findIndex((r) => r.id === active.id)
      const newIdx = rows.findIndex((r) => r.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return
      const next = arrayMove(rows, oldIdx, newIdx)
      setRows(next)
      void commit(next)
    },
    [rows, commit],
  )

  const indent = useCallback(
    (id: Ulid) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx <= 0) return
      const cur = rows[idx]
      if (!cur) return
      // Cap at the BE's MAX_DEPTH safety net so we never produce a tree
      // the validator will refuse.
      if (cur.level >= 16) return
      const next = [...rows]
      next[idx] = { ...cur, level: cur.level + 1 }
      setRows(next)
      void commit(next)
    },
    [rows, commit],
  )

  const outdent = useCallback(
    (id: Ulid) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx < 0) return
      const cur = rows[idx]
      if (!cur || cur.level <= 1) return
      const next = [...rows]
      next[idx] = { ...cur, level: cur.level - 1 }
      setRows(next)
      void commit(next)
    },
    [rows, commit],
  )

  const addSibling = useCallback(() => {
    const newId = ulid()
    const newRow: FlatRow = {
      id: newId,
      level: 1,
      title: '새 섹션',
      parentId: null,
    }
    const next = [...rows, newRow]
    setRows(next)
    // Optimistic local: add into draft so it shows up before reorder commits.
    const draft: DocumentJSONV10 = {
      ...document,
      sections: [
        ...document.sections,
        {
          id: newId,
          level: 1,
          title: '새 섹션',
          blocks: [],
          subsections: [],
        } satisfies SectionLevel1,
      ],
    }
    setDraft(draft)
    setSelectedId(newId)
    void commit(next)
  }, [rows, document, commit, setDraft])

  const addSub = useCallback(() => {
    if (!selectedId) return
    const idx = rows.findIndex((r) => r.id === selectedId)
    if (idx < 0) return
    const parent = rows[idx]
    if (!parent) return
    if (parent.level >= 16) return
    const newId = ulid()
    const newRow: FlatRow = {
      id: newId,
      level: parent.level + 1,
      title: '새 하위 섹션',
      parentId: parent.id,
    }
    const next = [...rows.slice(0, idx + 1), newRow, ...rows.slice(idx + 1)]
    setRows(next)
    setSelectedId(newId)
    // commit() goes through reorderSections which now accepts unknown
    // ids and creates the section server-side. No local draft surgery
    // needed — the optimistic `setRows` above is enough until the
    // round-trip lands.
    void commit(next)
  }, [rows, selectedId, commit])

  const removeRow = useCallback(() => {
    if (!selectedId) return
    const next = rows.filter((r) => r.id !== selectedId)
    setRows(next)
    setSelectedId(next[0]?.id ?? null)
    void commit(next)
  }, [rows, selectedId, commit])

  const duplicateRow = useCallback(() => {
    if (!selectedId) return
    const idx = rows.findIndex((r) => r.id === selectedId)
    if (idx < 0) return
    const cur = rows[idx]
    if (!cur) return
    const dup: FlatRow = { ...cur, id: ulid(), title: `${cur.title} (복사)` }
    const next = [...rows.slice(0, idx + 1), dup, ...rows.slice(idx + 1)]
    setRows(next)
    void commit(next)
  }, [rows, selectedId, commit])

  return (
    <div className="space-y-2 px-2 py-2 text-sm">
      <div className="flex flex-wrap gap-1">
        <ToolbarButton onClick={addSibling}>+ 섹션</ToolbarButton>
        <ToolbarButton onClick={addSub} disabled={!selectedId}>
          + 하위
        </ToolbarButton>
        <ToolbarButton onClick={duplicateRow} disabled={!selectedId}>
          복제
        </ToolbarButton>
        <ToolbarButton onClick={removeRow} disabled={!selectedId}>
          삭제
        </ToolbarButton>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {rows.map((r) => (
              <OutlineRow
                key={r.id}
                row={r}
                selected={r.id === selectedId}
                onSelect={() => setSelectedId(r.id)}
                onIndent={() => indent(r.id)}
                onOutdent={() => outdent(r.id)}
                onFocusChange={(focused) => {
                  isTypingRef.current = focused
                }}
                onCommitRename={(t) => {
                  // Local state immediately so the input stays in sync,
                  // then fire a single PATCH for the title only.
                  setRows((prev) =>
                    prev.map((x) => (x.id === r.id ? { ...x, title: t } : x)),
                  )
                  void commitRename(r.id, t)
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {busy && <p className="text-xs text-gray-500">저장 중…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

interface OutlineRowProps {
  row: FlatRow
  selected: boolean
  onSelect: () => void
  onIndent: () => void
  onOutdent: () => void
  /** Fires once per keystroke so the panel can lock its sync-from-prop. */
  onFocusChange: (focused: boolean) => void
  /** Called once per blur / Enter — not on every keystroke. */
  onCommitRename: (title: string) => void
}

function OutlineRow({
  row,
  selected,
  onSelect,
  onIndent,
  onOutdent,
  onFocusChange,
  onCommitRename,
}: OutlineRowProps) {
  // Local draft so the input is uncontrolled while focused. Sync from
  // props only when the row.title changes externally AND we don't
  // currently own the focus.
  const [draft, setDraft] = useState(row.title)
  const focusedRef = useRef(false)
  useEffect(() => {
    if (!focusedRef.current && draft !== row.title) {
      setDraft(row.title)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.title])
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    paddingLeft: `${(row.level - 1) * 16}px`,
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) onOutdent()
      else onIndent()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.currentTarget as HTMLInputElement).blur()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(row.title)
      ;(e.currentTarget as HTMLInputElement).blur()
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-selected={selected ? '' : undefined}
      className={`group relative flex items-center gap-1 rounded-md px-1 py-1 transition-colors ${
        selected ? 'bg-smsg-100 ring-1 ring-smsg-300' : 'hover:bg-gray-50'
      }`}
      onClick={onSelect}
    >
      {/* indent guide lines */}
      {row.level > 1 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 bottom-0 border-l border-gray-200"
          style={{ left: `${(row.level - 1) * 8 + 2}px` }}
        />
      )}
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab select-none px-1 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="끌어서 재정렬"
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="3" r="1" /><circle cx="7" cy="3" r="1" />
          <circle cx="3" cy="7" r="1" /><circle cx="7" cy="7" r="1" />
          <circle cx="3" cy="11" r="1" /><circle cx="7" cy="11" r="1" />
        </svg>
      </span>
      <input
        className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:text-smsg-900"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          focusedRef.current = true
          onFocusChange(true)
        }}
        onBlur={() => {
          focusedRef.current = false
          onFocusChange(false)
          if (draft !== row.title) onCommitRename(draft)
        }}
        onKeyDown={onKey}
        placeholder="섹션 제목"
        aria-label={`level ${row.level} 섹션 제목`}
      />
    </li>
  )
}

function ToolbarButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-smsg-900 hover:bg-smsg-100 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
