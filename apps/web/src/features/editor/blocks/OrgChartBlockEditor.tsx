import { useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { OrgChartBlock, OrgChartNode, Slug } from '@/types/document'
import { Button, Field, IconButton, Input, Select } from '@/components/ui'
import { ulid } from '@/features/editor/ulid'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { OrgChartBlockView } from '@/components/blocks/OrgChartBlock'
import { parseCsv } from '@/features/editor/extensions/csv-paste'

/**
 * Parse a 2-column CSV (Manager, Subordinate) into an org-chart tree. Pure;
 * exported for tests.
 *
 * Rules:
 *   - The first row may be a header (e.g. `Manager,Subordinate`); detected
 *     when neither cell looks like a real name (we accept any non-empty cell
 *     for now and just skip the row when both cells equal the literal
 *     `Manager` / `Subordinate`).
 *   - The first manager seen becomes the tree root.
 *   - A subordinate appearing later as a manager attaches its children
 *     under itself.
 *   - Any subordinate whose manager isn't in the file is silently dropped.
 */
export function parseOrgCsv(text: string): OrgChartNode | null {
  const parsed = parseCsv(text)
  if (!parsed) return null
  const rows = parsed.rows.filter((r) => r.length >= 2 && r[0]!.trim() && r[1]!.trim())
  // Drop a likely header row.
  const isHeader =
    rows[0]?.[0]?.toLowerCase() === 'manager' && rows[0]?.[1]?.toLowerCase() === 'subordinate'
  const data = isHeader ? rows.slice(1) : rows
  if (data.length === 0) return null

  const nodeMap = new Map<string, OrgChartNode>()
  const childOrder = new Map<string, string[]>()
  const seenAsChild = new Set<string>()

  const get = (label: string): OrgChartNode => {
    const key = label.trim()
    let n = nodeMap.get(key)
    if (!n) {
      n = { id: ulid(), label: key, children: [] }
      nodeMap.set(key, n)
    }
    return n
  }

  for (const [mgr, sub] of data) {
    const m = get(mgr!.trim())
    const s = get(sub!.trim())
    const arr = childOrder.get(m.label) ?? []
    if (!arr.includes(s.label)) arr.push(s.label)
    childOrder.set(m.label, arr)
    seenAsChild.add(s.label)
  }

  // Hook up children once order is known.
  for (const [mgrLabel, kids] of childOrder.entries()) {
    const m = nodeMap.get(mgrLabel)!
    m.children = kids.map((k) => nodeMap.get(k)!)
  }

  // Find the root: the manager that never appears as a child.
  const rootLabel = data.find(([mgr]) => !seenAsChild.has(mgr!.trim()))?.[0]?.trim()
  if (!rootLabel) return null
  return nodeMap.get(rootLabel) ?? null
}

interface Props {
  slug: Slug
  block: OrgChartBlock
}

/* ── Pure tree helpers (exported for tests) ───────────────────────────── */

function cloneTree(n: OrgChartNode): OrgChartNode {
  return {
    ...n,
    children: n.children?.map(cloneTree),
  }
}

export function addChild(root: OrgChartNode, parentId: string, child: OrgChartNode): OrgChartNode {
  const next = cloneTree(root)
  function visit(n: OrgChartNode): boolean {
    if (n.id === parentId) {
      n.children = [...(n.children ?? []), child]
      return true
    }
    for (const c of n.children ?? []) if (visit(c)) return true
    return false
  }
  visit(next)
  return next
}

export function removeNode(root: OrgChartNode, id: string): OrgChartNode {
  if (root.id === id) return root // never remove the root
  const next = cloneTree(root)
  function visit(n: OrgChartNode) {
    if (!n.children) return
    n.children = n.children.filter((c) => c.id !== id)
    n.children.forEach(visit)
  }
  visit(next)
  return next
}

export function updateNode(
  root: OrgChartNode,
  id: string,
  patch: Partial<OrgChartNode>,
): OrgChartNode {
  const next = cloneTree(root)
  function visit(n: OrgChartNode): boolean {
    if (n.id === id) {
      Object.assign(n, patch)
      return true
    }
    for (const c of n.children ?? []) if (visit(c)) return true
    return false
  }
  visit(next)
  return next
}

/** True if `ancestor` contains `id` in its subtree. */
function descendantOf(root: OrgChartNode, ancestorId: string, id: string): boolean {
  function find(n: OrgChartNode): OrgChartNode | null {
    if (n.id === ancestorId) return n
    for (const c of n.children ?? []) {
      const f = find(c)
      if (f) return f
    }
    return null
  }
  const sub = find(root)
  if (!sub) return false
  function walk(n: OrgChartNode): boolean {
    if (n.id === id) return true
    for (const c of n.children ?? []) if (walk(c)) return true
    return false
  }
  return walk(sub)
}

export function reparent(root: OrgChartNode, nodeId: string, newParentId: string): OrgChartNode {
  if (nodeId === newParentId) return root
  if (root.id === nodeId) return root // can't move root
  // Disallow moving a node under one of its own descendants.
  if (descendantOf(root, nodeId, newParentId)) return root

  // Find + detach the node first.
  let detached: OrgChartNode | null = null
  function detach(n: OrgChartNode): OrgChartNode {
    return {
      ...n,
      children: (n.children ?? [])
        .filter((c) => {
          if (c.id === nodeId) {
            detached = c
            return false
          }
          return true
        })
        .map(detach),
    }
  }
  const stripped = detach(root)
  if (!detached) return root
  return addChild(stripped, newParentId, detached)
}

/* ── DnD pieces ───────────────────────────────────────────────────────── */

interface NodeRowProps {
  node: OrgChartNode
  depth: number
  isRoot: boolean
  onAdd: (parentId: string) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<OrgChartNode>) => void
}

function DraggableHandle({ id, isRoot }: { id: string; isRoot: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id, disabled: isRoot })
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={`drag ${id}`}
      {...attributes}
      {...listeners}
      className="cursor-grab text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
      disabled={isRoot}
    >
      ⋮⋮
    </button>
  )
}

function DroppableSlot({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={
        'rounded-md border border-transparent transition-colors ' +
        (isOver ? 'border-smsg-400 bg-smsg-50' : '')
      }
    >
      {children}
    </div>
  )
}

function NodeRow({ node, depth, isRoot, onAdd, onRemove, onUpdate }: NodeRowProps) {
  return (
    <div className="space-y-1" style={{ paddingLeft: depth * 16 }}>
      <DroppableSlot id={node.id}>
        <div className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1.5">
          <DraggableHandle id={node.id} isRoot={isRoot} />
          <Input
            value={node.label}
            onChange={(e) => onUpdate(node.id, { label: e.target.value })}
            placeholder="이름"
            aria-label={`node ${node.id} label`}
            className="flex-1"
          />
          <Input
            value={node.role ?? ''}
            onChange={(e) => onUpdate(node.id, { role: e.target.value })}
            placeholder="역할"
            aria-label={`node ${node.id} role`}
            className="w-32"
          />
          <IconButton aria-label={`add child to ${node.id}`} onClick={() => onAdd(node.id)}>
            +
          </IconButton>
          {!isRoot && (
            <IconButton aria-label={`remove ${node.id}`} onClick={() => onRemove(node.id)}>
              ×
            </IconButton>
          )}
        </div>
      </DroppableSlot>
      {(node.children ?? []).map((c) => (
        <NodeRow
          key={c.id}
          node={c}
          depth={depth + 1}
          isRoot={false}
          onAdd={onAdd}
          onRemove={onRemove}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  )
}

/* ── Editor component ─────────────────────────────────────────────────── */

const LAYOUTS: NonNullable<OrgChartBlock['layout']>[] = ['tree', 'horizontal']

export function OrgChartBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<OrgChartBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(block.root, null, 2))
  const [jsonErr, setJsonErr] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const push = async (next: OrgChartBlock) => {
    setLocal(next)
    setJsonText(JSON.stringify(next.root, null, 2))
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '조직도 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
      else setError((err as Error).message)
    }
  }

  const onAdd = (parentId: string) => {
    const child: OrgChartNode = { id: ulid(), label: '신규' }
    void push({ ...local, root: addChild(local.root, parentId, child) })
  }
  const onRemove = (id: string) => void push({ ...local, root: removeNode(local.root, id) })
  const onUpdate = (id: string, patch: Partial<OrgChartNode>) =>
    void push({ ...local, root: updateNode(local.root, id, patch) })

  const onDragEnd = (e: DragEndEvent) => {
    const dragId = e.active.id as string
    const dropId = e.over?.id as string | undefined
    if (!dropId || dragId === dropId) return
    const next = reparent(local.root, dragId, dropId)
    if (next === local.root) return // disallowed move
    void push({ ...local, root: next })
  }

  const onJsonBlur = () => {
    try {
      const parsed = JSON.parse(jsonText) as OrgChartNode
      if (!parsed.id || typeof parsed.label !== 'string') {
        setJsonErr('id, label 필드가 필요합니다.')
        return
      }
      setJsonErr(null)
      void push({ ...local, root: parsed })
    } catch (err) {
      setJsonErr((err as Error).message)
    }
  }

  const onCsvPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain')
    const root = parseOrgCsv(text)
    if (!root) return
    e.preventDefault()
    void push({ ...local, root })
  }

  const dndContent = useMemo(
    () => (
      <NodeRow
        node={local.root}
        depth={0}
        isRoot
        onAdd={onAdd}
        onRemove={onRemove}
        onUpdate={onUpdate}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [local.root],
  )

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <Field label="레이아웃">
          <Select
            value={local.layout ?? 'tree'}
            onChange={(e) =>
              void push({ ...local, layout: e.target.value as OrgChartBlock['layout'] })
            }
          >
            {LAYOUTS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
        </Field>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => setJsonMode((v) => !v)}
        >
          {jsonMode ? '트리 편집기' : 'JSON 직접 편집'}
        </Button>
      </div>

      {jsonMode ? (
        <Field label="root JSON" error={jsonErr ?? undefined}>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            onBlur={onJsonBlur}
            rows={10}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
            aria-label="org-chart json"
          />
        </Field>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {dndContent}
        </DndContext>
      )}

      <details className="rounded border border-gray-200 bg-white p-2 text-xs">
        <summary className="cursor-pointer text-gray-600">엑셀에서 붙여넣기 (Manager,Subordinate)</summary>
        <textarea
          aria-label="org-csv-paste"
          rows={4}
          placeholder={'Manager,Subordinate\nCEO,COO\nCEO,CTO'}
          onPaste={onCsvPaste}
          className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-[11px]"
        />
      </details>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          미리보기
        </p>
        <OrgChartBlockView block={local} />
      </div>
    </div>
  )
}
