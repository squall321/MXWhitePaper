import { useState } from 'react'
import type { GanttBlock, Slug } from '@/types/document'
import { Field, Input } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { GanttBlockView } from '@/components/blocks/GanttBlock'
import { ZebraToggle } from './ZebraToggle'
import { useT } from '@/lib/i18n'

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
 * Pure key → patch resolver used by the bar's `onKeyDown`. Extracted so it
 * can be unit-tested without a DOM. Returns `null` for keys we don't handle
 * (so the caller can let them propagate normally).
 *
 * - ArrowLeft  / ArrowRight        : shift end ±1 (resize)
 * - Shift + ArrowLeft / ArrowRight : shift start + end ±1 (move whole bar)
 */
export function ganttKeyToPatch(
  task: Pick<GanttBlock['tasks'][number], 'start' | 'end'>,
  ev: { key: string; shiftKey: boolean },
): Partial<GanttBlock['tasks'][number]> | null {
  const delta = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0
  if (delta === 0) return null
  if (ev.shiftKey) {
    return { start: shiftDate(task.start, delta), end: shiftDate(task.end, delta) }
  }
  return { end: shiftDate(task.end, delta) }
}

/**
 * Editable Gantt chart. Rows have name / start / end / progress. Live preview
 * uses the same SVG renderer used in read mode (no mermaid here — we already
 * have a recharts-free SVG view).
 */
export function GanttBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<GanttBlock>(block)
  const [error, setError] = useState<string | null>(null)

  const push = async (next: GanttBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, t('editor.gantt.changeLog'))
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError(t('editor.common.conflict'))
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
      tasks: [
        ...local.tasks,
        {
          name: t('editor.gantt.newTaskName', { n: local.tasks.length + 1 }),
          start,
          end,
          progress: 0,
        },
      ],
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
          {t('editor.gantt.tasksHeader', { n: local.tasks.length })}
        </p>
        <div className="flex items-center gap-2">
          <ZebraToggle
            blockType="gantt"
            options={local.options}
            onChange={({ stripe }) =>
              void push({ ...local, options: { ...local.options, stripe } })
            }
          />
          <button
            type="button"
            onClick={add}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
            aria-label={t('editor.gantt.addTask')}
          >
            {t('editor.gantt.addTask')}
          </button>
        </div>
      </div>

      {local.tasks.length === 0 ? (
        <p className="text-xs text-gray-500">{t('editor.gantt.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1 text-left">{t('editor.gantt.colName')}</th>
                <th className="px-2 py-1 text-left">{t('editor.gantt.colStart')}</th>
                <th className="px-2 py-1 text-left">{t('editor.gantt.colEnd')}</th>
                <th className="px-2 py-1 text-left">{t('editor.gantt.colProgress')}</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {local.tasks.map((task, i) => (
                <tr
                  key={i}
                  tabIndex={0}
                  role="button"
                  aria-label={t('editor.gantt.barAriaLabel', {
                    n: i + 1,
                    name: task.name,
                    start: task.start,
                    end: task.end,
                  })}
                  data-gantt-bar-row={i}
                  onKeyDown={(e) => {
                    // Don't hijack typing inside the row's <input>s.
                    const target = e.target as HTMLElement
                    if (
                      target.tagName === 'INPUT' ||
                      target.tagName === 'TEXTAREA' ||
                      target.tagName === 'SELECT'
                    ) {
                      return
                    }
                    const patch = ganttKeyToPatch(task, e)
                    if (patch === null) return
                    e.preventDefault()
                    update(i, patch)
                  }}
                  className="border-t border-gray-100 outline-none focus:ring-2 focus:ring-smsg-300"
                >
                  <td className="px-2 py-1">
                    <Input
                      value={task.name}
                      aria-label={`task ${i} name`}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="date"
                      value={task.start}
                      aria-label={`task ${i} start`}
                      onChange={(e) => update(i, { start: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="date"
                      value={task.end}
                      aria-label={`task ${i} end`}
                      onChange={(e) => update(i, { end: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={task.progress ?? 0}
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

      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}

      <Field label={t('editor.gantt.preview')}>
        <div className="rounded border border-gray-200 bg-white p-2">
          <GanttBlockView block={local} />
        </div>
      </Field>
    </div>
  )
}
