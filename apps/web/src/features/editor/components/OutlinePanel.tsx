import { useCallback, useMemo, useState } from 'react'
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
import { reorderSections, isPreconditionFailed, type SectionOutlineNode } from '../api'
import { useEditorStore } from '../state'
import { ulid } from '../ulid'

interface OutlinePanelProps {
  slug: Slug
  document: DocumentJSONV10
}

interface FlatRow {
  id: Ulid
  level: 1 | 2 | 3
  title: string
  parentId: Ulid | null
}

/**
 * Flatten the section tree into rows for dnd. Order is preserved.
 */
function flatten(doc: DocumentJSONV10): FlatRow[] {
  const out: FlatRow[] = []
  for (const s1 of doc.sections) {
    out.push({ id: s1.id, level: 1, title: s1.title, parentId: null })
    for (const s2 of s1.subsections) {
      out.push({ id: s2.id, level: 2, title: s2.title, parentId: s1.id })
      for (const s3 of s2.subsections ?? []) {
        out.push({ id: s3.id, level: 3, title: s3.title, parentId: s2.id })
      }
    }
  }
  return out
}

/** Convert flat rows back into the nested outline payload the BE expects. */
function rowsToOutline(
  rows: FlatRow[],
  doc: DocumentJSONV10,
): SectionOutlineNode[] {
  // Build a quick lookup of original section objects so we don't lose blocks.
  const titleById = new Map<Ulid, string>()
  for (const s of doc.sections) {
    titleById.set(s.id, s.title)
    for (const s2 of s.subsections) {
      titleById.set(s2.id, s2.title)
      for (const s3 of s2.subsections ?? []) titleById.set(s3.id, s3.title)
    }
  }
  const out: SectionOutlineNode[] = []
  let cur1: SectionOutlineNode | null = null
  let cur2: SectionOutlineNode | null = null
  for (const r of rows) {
    const node: SectionOutlineNode = {
      id: r.id,
      level: r.level,
      title: r.title || titleById.get(r.id) || '',
      children: [],
    }
    if (r.level === 1) {
      out.push(node)
      cur1 = node
      cur2 = null
    } else if (r.level === 2) {
      if (cur1) cur1.children.push(node)
      cur2 = node
    } else {
      if (cur2) cur2.children.push(node)
    }
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

  // Re-sync when the document prop changes (after a save).
  useMemo(() => setRows(flatten(document)), [document])

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
      if (cur.level >= 3) return
      const next = [...rows]
      next[idx] = { ...cur, level: (cur.level + 1) as 2 | 3 }
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
      next[idx] = { ...cur, level: (cur.level - 1) as 1 | 2 }
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
    if (!parent || parent.level >= 3) return
    const newRow: FlatRow = {
      id: ulid(),
      level: (parent.level + 1) as 2 | 3,
      title: '새 하위 섹션',
      parentId: parent.id,
    }
    const next = [...rows.slice(0, idx + 1), newRow, ...rows.slice(idx + 1)]
    setRows(next)
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
                onRename={(t) => {
                  const next = rows.map((x) => (x.id === r.id ? { ...x, title: t } : x))
                  setRows(next)
                }}
                onCommitRename={() => commit(rows)}
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
  onRename: (title: string) => void
  onCommitRename: () => void
}

function OutlineRow({
  row,
  selected,
  onSelect,
  onIndent,
  onOutdent,
  onRename,
  onCommitRename,
}: OutlineRowProps) {
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
        value={row.title}
        onChange={(e) => onRename(e.target.value)}
        onBlur={onCommitRename}
        onKeyDown={onKey}
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
