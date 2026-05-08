import { useState } from 'react'
import type { KpiCardsBlock, Slug } from '@/types/document'
import { Button, Field, IconButton, Input } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { KpiCardsBlockView } from '@/components/blocks/KpiCardsBlock'

interface Props {
  slug: Slug
  block: KpiCardsBlock
}

type KpiItem = KpiCardsBlock['items'][number]

/**
 * Pure helper — derive `trend` from a numeric delta when the user hasn't set
 * one explicitly. `> 0` → `up`, `< 0` → `down`, `= 0` → `flat`. Non-numeric
 * deltas (e.g. `"+12%"`) are parsed by stripping non-digit + sign chars.
 */
export function trendFromDelta(delta: string | number | undefined): KpiItem['trend'] {
  if (delta == null) return undefined
  const raw = String(delta).trim()
  if (!raw) return undefined
  const m = raw.match(/-?\d+(?:\.\d+)?/)
  if (!m) return undefined
  const n = Number(m[0])
  if (!Number.isFinite(n)) return undefined
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'flat'
}

/**
 * `kpi-cards` editor — rows of (label, value, delta). Trend is auto-derived
 * from the delta sign on every commit, so the user never has to set it
 * manually (but they can override by editing the trend dropdown if needed).
 */
export function KpiCardsBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<KpiCardsBlock>(block)
  const [error, setError] = useState<string | null>(null)

  const push = async (next: KpiCardsBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, 'KPI 카드 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
      else setError((err as Error).message)
    }
  }

  const updateItem = (idx: number, patch: Partial<KpiItem>) => {
    const items = local.items.map((it, i) => {
      if (i !== idx) return it
      const next = { ...it, ...patch }
      // Auto-trend on delta edits unless caller explicitly set `trend`.
      if (patch.delta !== undefined && patch.trend === undefined) {
        next.trend = trendFromDelta(patch.delta as string | number)
      }
      return next
    })
    void push({ ...local, items })
  }
  const addItem = () => {
    const next: KpiItem = { label: `지표 ${local.items.length + 1}`, value: 0 }
    void push({ ...local, items: [...local.items, next] })
  }
  const removeItem = (idx: number) => {
    void push({ ...local, items: local.items.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-700">KPI 항목</p>
        {local.items.map((it, i) => (
          <div
            key={i}
            className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <Field label="라벨">
              <Input
                value={it.label}
                onChange={(e) => updateItem(i, { label: e.target.value })}
                aria-label={`kpi ${i} label`}
              />
            </Field>
            <Field label="값">
              <Input
                value={String(it.value)}
                onChange={(e) => updateItem(i, { value: e.target.value })}
                aria-label={`kpi ${i} value`}
              />
            </Field>
            <Field label="델타">
              <Input
                value={it.delta == null ? '' : String(it.delta)}
                placeholder="예: +12%"
                onChange={(e) => updateItem(i, { delta: e.target.value })}
                aria-label={`kpi ${i} delta`}
              />
            </Field>
            <IconButton
              aria-label={`kpi ${i} remove`}
              onClick={() => removeItem(i)}
            >
              ×
            </IconButton>
          </div>
        ))}
        <Button variant="secondary" size="sm" type="button" onClick={addItem}>
          + KPI 추가
        </Button>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          미리보기
        </p>
        <KpiCardsBlockView block={local} />
      </div>
    </div>
  )
}
