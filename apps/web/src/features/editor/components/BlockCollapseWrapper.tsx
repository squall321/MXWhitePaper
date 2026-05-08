import { useCallback, useState, type ReactNode } from 'react'
import type { Block, Slug } from '@/types/document'
import { COLLAPSIBLE_BLOCK_TYPES } from './BlockResizeWrapper'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore, editorSelectors } from '../state'

/**
 * BlockCollapseWrapper — adds a small "접기 / 펴기" toggle to the top-right
 * of "tall" blocks (chart, table, code, gallery, etc.). Persistence model:
 *
 *   - Read mode: the chevron drives a local React state — readers can
 *     collapse a heavy chart for the duration of the visit but nothing is
 *     written to the doc.
 *   - Edit mode (fullEdit): the chevron writes `meta.collapsed` on the
 *     block via `patchBlock` so the preference survives reloads for every
 *     viewer.
 *
 * When collapsed, the children are replaced with a 1-line summary so heavy
 * widgets (charts, kpi-cards, etc.) don't pay their render cost.
 */

interface Props {
  block: Block
  /** When in edit mode, the wrapper persists toggles to the BE. */
  slug?: Slug
  children: ReactNode
}

export function BlockCollapseWrapper({ block, slug, children }: Props) {
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  // Stored preference (from the doc); used as the initial value.
  const persisted = block.meta?.collapsed === true
  const [localCollapsed, setLocalCollapsed] = useState<boolean>(persisted)

  // Edit mode reads from `persisted` (server snapshot is the source of truth);
  // read mode reads from local state so navigating away resets it.
  const isEditMode = Boolean(isFullEditing && slug)
  const collapsed = isEditMode ? persisted : localCollapsed

  const persist = useCallback(
    async (next: boolean) => {
      if (!isEditMode || !slug || !etag) return
      const nextMeta: Record<string, unknown> = { ...(block.meta ?? {}) }
      if (next) nextMeta.collapsed = true
      else delete nextMeta.collapsed
      const patched = { ...block, meta: nextMeta } as Block
      try {
        const result = await patchBlock(slug, block.id, patched, etag, '블록 접기/펴기')
        apply(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      }
    },
    [block, slug, etag, isEditMode, apply, setConflict],
  )

  const onToggle = useCallback(() => {
    const next = !collapsed
    if (isEditMode) {
      void persist(next)
    } else {
      setLocalCollapsed(next)
    }
  }, [collapsed, isEditMode, persist])

  if (!COLLAPSIBLE_BLOCK_TYPES.has(block.type)) {
    // Not a tall block — pass through. Shouldn't happen because the caller
    // already gates, but defensive.
    return <>{children}</>
  }

  const panelId = `block-panel-${block.id}`
  return (
    <div data-block-collapse-wrapper data-block-id={block.id} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? '블록 펴기' : '블록 접기'}
        aria-expanded={!collapsed}
        aria-controls={panelId}
        data-testid="block-collapse-toggle"
        className="absolute right-1 top-1 z-[6] inline-flex items-center gap-1 rounded border border-gray-200 bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-600 opacity-0 shadow-sm transition-opacity hover:text-smsg-700 group-hover/block:opacity-100 focus:opacity-100"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="h-3 w-3 transition-transform"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="2,4 6,8 10,4" />
        </svg>
        {collapsed ? '펴기' : '접기'}
      </button>
      {collapsed ? (
        <CollapsedSummary block={block} id={panelId} onExpand={onToggle} />
      ) : (
        <div id={panelId} className="group/block">
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * One-line summary shown in place of the widget while collapsed. We surface
 * the block type and a quick row/title hint so users know what they collapsed.
 */
function CollapsedSummary({
  block,
  id,
  onExpand,
}: {
  block: Block
  id: string
  onExpand: () => void
}) {
  const label = humanLabel(block.type)
  const hint = summaryHint(block)
  return (
    <button
      type="button"
      id={id}
      onClick={onExpand}
      className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-left text-xs text-gray-600 hover:border-smsg-300 hover:bg-smsg-50 hover:text-smsg-900 dark:border-gray-700 dark:bg-gray-900"
    >
      <span className="flex items-center gap-2">
        <span className="font-medium text-smsg-700">{label}</span>
        {hint && <span className="truncate text-gray-500">{hint}</span>}
      </span>
      <span aria-hidden="true" className="text-gray-400">접힘 — 클릭하여 펴기</span>
    </button>
  )
}

function humanLabel(type: Block['type']): string {
  switch (type) {
    case 'chart': return '차트'
    case 'table': return '표'
    case 'code': return '코드'
    case 'gallery': return '갤러리'
    case 'gantt': return '간트'
    case 'flow': return '플로우'
    case 'kpi-cards': return 'KPI 카드'
    case 'calculator': return '계산기'
    case 'dashboard-embed': return '대시보드'
    case 'math': return '수식'
    case 'org-chart': return '조직도'
    default: return String(type)
  }
}

function summaryHint(block: Block): string {
  // Light-weight, defensive — never throws on missing fields. Each branch
  // peeks at one shape-specific count/title (via `unknown` cast) so the
  // summary feels alive without depending on each block's type literal.
  const anyBlock = block as unknown as Record<string, unknown>
  try {
    if (block.type === 'table' && Array.isArray(anyBlock.rows)) {
      return `${(anyBlock.rows as unknown[]).length}행`
    }
    if (block.type === 'gallery' && Array.isArray(anyBlock.items)) {
      return `${(anyBlock.items as unknown[]).length}장`
    }
    if (block.type === 'code') {
      const lang = anyBlock.language
      return typeof lang === 'string' ? lang : ''
    }
    if (block.type === 'chart') {
      const title = anyBlock.title
      return typeof title === 'string' ? title : ''
    }
    if (block.type === 'kpi-cards' && Array.isArray(anyBlock.cards)) {
      return `${(anyBlock.cards as unknown[]).length}개`
    }
    if (block.type === 'gantt' && Array.isArray(anyBlock.tasks)) {
      return `${(anyBlock.tasks as unknown[]).length}개 작업`
    }
    if (block.type === 'flow' && Array.isArray(anyBlock.nodes)) {
      return `${(anyBlock.nodes as unknown[]).length}개 노드`
    }
    if (block.type === 'math') {
      const expr = anyBlock.expression
      return typeof expr === 'string' ? expr.slice(0, 60) : ''
    }
    if (block.type === 'calculator') {
      const title = anyBlock.title
      return typeof title === 'string' ? title : ''
    }
    if (block.type === 'dashboard-embed') {
      const title = anyBlock.title
      return typeof title === 'string' ? title : ''
    }
  } catch {
    /* swallow — summaries are best-effort */
  }
  return ''
}
