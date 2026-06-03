import { useMemo } from 'react'
import type { Slug, TimelineBlock } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { TimelineBlockView } from '@/components/blocks/TimelineBlock'

/**
 * G4 — TimelineBlockEditor.
 *
 * Mirrors SlicerBlockEditor structure: label / field / source kind +
 * optional explicit min/max overrides. The two sliders themselves live
 * inside TimelineBlockView (rendered in the preview pane); editing here
 * is restricted to the block's persistent shape, not the runtime window.
 */
interface Props {
  slug: Slug
  block: TimelineBlock
}

export function TimelineBlockEditor({ slug, block }: Props) {
  const draft = useEditorStore((s) => s.draft)
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const dataSources = useMemo(() => {
    const out: Array<{ id: string; endpoint: string }> = []
    for (const section of draft?.sections ?? []) {
      for (const b of section.blocks ?? []) {
        if (b.type === 'data-source') {
          out.push({ id: b.id, endpoint: (b as { endpoint?: string }).endpoint ?? '' })
        }
      }
    }
    return out
  }, [draft])

  const persist = async (next: TimelineBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          field: next.field,
          label: next.label,
          source: next.source,
          min: next.min,
          max: next.max,
          default: next.default,
        } as Partial<TimelineBlock>,
        etag,
        'timeline 편집',
      )
      apply(result.document, result.etag)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  const kind = block.source?.kind ?? 'inline'
  const setKind = (next: 'inline' | 'data-source') => {
    if (next === kind) return
    const nextBlock: TimelineBlock = {
      ...block,
      source:
        next === 'inline'
          ? ({ kind: 'inline', rows: [] } as TimelineBlock['source'])
          : ({ kind: 'data-source', dataSourceId: dataSources[0]?.id ?? '' } as TimelineBlock['source']),
    }
    void persist(nextBlock)
  }

  return (
    <div
      className="my-2 space-y-2 rounded border border-gray-200 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-900"
      data-block-editor="timeline"
      data-block-id={block.id}
    >
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          📅 Timeline
        </h4>
      </header>

      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <label className="flex items-center gap-1">
          <span className="text-gray-600 dark:text-gray-300">label</span>
          <input
            type="text"
            value={block.label ?? ''}
            onChange={(e) => void persist({ ...block, label: e.target.value || undefined })}
            placeholder="기간"
            data-testid="timeline-label"
            className="flex-1 rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-gray-600 dark:text-gray-300">field</span>
          <input
            type="text"
            value={block.field}
            onChange={(e) => void persist({ ...block, field: e.target.value })}
            placeholder="date"
            data-testid="timeline-field"
            className="flex-1 rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-gray-600 dark:text-gray-300">min</span>
          <input
            type="date"
            value={block.min ?? ''}
            onChange={(e) => void persist({ ...block, min: e.target.value || undefined })}
            data-testid="timeline-min"
            className="flex-1 rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-gray-600 dark:text-gray-300">max</span>
          <input
            type="date"
            value={block.max ?? ''}
            onChange={(e) => void persist({ ...block, max: e.target.value || undefined })}
            data-testid="timeline-max"
            className="flex-1 rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-semibold text-gray-700 dark:text-gray-200">Source:</span>
        {(['inline', 'data-source'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input
              type="radio"
              name={`timeline-source-${block.id}`}
              checked={kind === k}
              onChange={() => setKind(k)}
              data-testid={`timeline-source-kind-${k}`}
            />
            {k}
          </label>
        ))}
        {kind === 'data-source' && (
          <select
            value={(block.source as { dataSourceId?: string }).dataSourceId ?? ''}
            onChange={(e) =>
              void persist({
                ...block,
                source: { kind: 'data-source', dataSourceId: e.target.value } as TimelineBlock['source'],
              })
            }
            aria-label="dataSourceId"
            data-testid="timeline-data-source-id"
            className="rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
          >
            {dataSources.length === 0 && <option value="">(no DataSourceBlock)</option>}
            {dataSources.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.id.slice(0, 8)}… · {ds.endpoint || '(no endpoint)'}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="border-t border-gray-200 pt-2 dark:border-gray-700">
        <p className="mb-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
          미리보기
        </p>
        <TimelineBlockView block={block} />
      </div>
    </div>
  )
}
