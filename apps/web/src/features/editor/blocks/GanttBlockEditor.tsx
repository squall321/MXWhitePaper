import { useState } from 'react'
import type { GanttBlock, Slug } from '@/types/document'
import { Field, Input } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { GanttBlockView } from '@/components/blocks/GanttBlock'

interface Props {
  slug: Slug
  block: GanttBlock
}

export type Task = GanttBlock['tasks'][number]

/** Today as `YYYY-MM-DD` — used as a default for newly-added rows. */
function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Add `n` days to `YYYY-MM-DD`; tolerant of bad input (returns the same). */
export function shiftDate(iso: string, days: number): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const d = new Date(t)
  d.setDate(d.getDate() + days)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Editable Gantt chart. Rows have name / start / end / progress. Live preview
 * uses the same SVG renderer used in read mode (no mermaid here — we already
 * have a recharts-free SVG view).
 */
export function GanttBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<GanttBlock>(block)
  const [error, setError] = useState<string | null>(null)

  const push = async (next: GanttBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '간트 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
      else setError((err as Error).message)
    }
  }

  const update = (idx: number, patch: Partial<Task>) => {
    const next: GanttBlock = {
      ...local,
      tasks: local.tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    }
    void push(next)
  }

  const add = () => {
    const last = local.tasks[local.tasks.length - 1]
    const start = last?.end ?? todayISO()
    const end = shiftDate(start, 3)
    const next: GanttBlock = {
      ...local,
      tasks: [...local.tasks, { name: `작업 ${local.tasks.length + 1}`, start, end, progress: 0 }],
    }
    void push(next)
  }

  const remove = (idx: number) => {
    const next: GanttBlock = {
      ...local,
      tasks: local.tasks.filter((_, i) => i !== idx),
    }
    void push(next)
  }

  return (
    <div
      data-gantt-block-editor
      data-block-id={block.id}
      className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          간트 작업 ({local.tasks.length})
        </p>
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          aria-label="add gantt task"
        >
          + 작업 추가
        </button>
      </div>

      {local.tasks.length === 0 ? (
        <p className="text-xs text-gray-500">작업이 없습니다. 위의 “+ 작업 추가” 버튼으로 시작하세요.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1 text-left">이름</th>
                <th className="px-2 py-1 text-left">시작 (YYYY-MM-DD)</th>
                <th className="px-2 py-1 text-left">종료 (YYYY-MM-DD)</th>
                <th className="px-2 py-1 text-left">진행 %</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {local.tasks.map((t, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1">
                    <Input
                      value={t.name}
                      aria-label={`task ${i} name`}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="date"
                      value={t.start}
                      aria-label={`task ${i} start`}
                      onChange={(e) => update(i, { start: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="date"
                      value={t.end}
                      aria-label={`task ${i} end`}
                      onChange={(e) => update(i, { end: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={t.progress ?? 0}
                      aria-label={`task ${i} progress`}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (!Number.isFinite(v)) return
                        update(i, { progress: Math.max(0, Math.min(100, v)) })
                      }}
                      className="w-20"
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="rounded px-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`remove task ${i}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <Field label="미리보기">
        <div className="rounded border border-gray-200 bg-white p-2">
          <GanttBlockView block={local} />
        </div>
      </Field>
    </div>
  )
}
