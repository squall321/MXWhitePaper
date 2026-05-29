import { useState } from 'react'
import type { KpiCardsBlock, Slug } from '@/types/document'
import { Button, Field, IconButton, Input } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { KpiCardsBlockView } from '@/components/blocks/KpiCardsBlock'
import { BlockHelpDrawer } from '@/features/editor/components/BlockHelpDrawer'
import { ZebraToggle } from './ZebraToggle'
import { useT } from '@/lib/i18n'

/**
 * Sparkline color preset swatches — first four entries from the chart light
 * palette ([[src/components/blocks/ChartBlock.tsx#PALETTE]]) so KPI sparklines
 * pick from the same hues users already see in chart blocks. Custom hex input
 * lets users go outside this list.
 */
const SPARKLINE_PRESETS = ['#1428A0', '#10B981', '#F59E0B', '#DC2626'] as const

/** Loose hex validator — '#' + 3 or 6 hex digits. Used to gate custom input. */
function isHexColor(s: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(s.trim())
}

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
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<KpiCardsBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const push = async (next: KpiCardsBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, t('editor.kpi.changeLog'))
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError(t('editor.common.conflict'))
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
    const next: KpiItem = {
      label: t('editor.kpi.newItem', { n: local.items.length + 1 }),
      value: 0,
    }
    void push({ ...local, items: [...local.items, next] })
  }
  const removeItem = (idx: number) => {
    void push({ ...local, items: local.items.filter((_, i) => i !== idx) })
  }
  const updateSparklineColor = (idx: number, color: string | undefined) => {
    const items = local.items.map((it, i) => {
      if (i !== idx || !it.sparkline) return it
      // Strip the field on clear so we don't emit `color: undefined` into JSON.
      const { color: _drop, ...rest } = it.sparkline
      return { ...it, sparkline: color ? { ...rest, color } : { ...rest } }
    })
    void push({ ...local, items })
  }

  const isEmpty = local.items.length === 0

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      {isEmpty && (
        <div
          data-testid="kpi-empty-state"
          className="rounded-md border border-dashed border-smsg-300 bg-white p-4 text-center dark:bg-gray-900"
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('editor.kpi.empty')}
          </p>
          <div className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button size="sm" type="button" onClick={addItem}>{t('editor.kpi.addCard')}</Button>
            <button
              type="button"
              className="text-xs text-link hover:underline"
              onClick={() => setHelpOpen(true)}
            >
              {t('common.helpMore')}
            </button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-700">{t('editor.kpi.itemsHeader')}</p>
          <ZebraToggle
            blockType="kpi-cards"
            options={local.options}
            onChange={({ stripe }) =>
              void push({ ...local, options: { ...local.options, stripe } })
            }
          />
        </div>
        {local.items.map((it, i) => (
          <div key={i} className="space-y-1">
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <Field label={t('editor.kpi.label')}>
                <Input
                  value={it.label}
                  onChange={(e) => updateItem(i, { label: e.target.value })}
                  aria-label={`kpi ${i} label`}
                />
              </Field>
              <Field label={t('editor.kpi.value')}>
                <Input
                  value={String(it.value)}
                  onChange={(e) => updateItem(i, { value: e.target.value })}
                  aria-label={`kpi ${i} value`}
                />
              </Field>
              <Field label={t('editor.kpi.delta')}>
                <Input
                  value={it.delta == null ? '' : String(it.delta)}
                  placeholder={t('editor.kpi.deltaPlaceholder')}
                  onChange={(e) => updateItem(i, { delta: e.target.value })}
                  aria-label={`kpi ${i} delta`}
                />
              </Field>
              <IconButton
                aria-label={`kpi ${i} remove`}
                onClick={() => removeItem(i)}
              >
                <span aria-hidden="true">×</span>
              </IconButton>
            </div>
            {it.sparkline && it.sparkline.values.length > 0 && (
              <SparklineColorSwatches
                index={i}
                color={it.sparkline.color}
                onChange={(color) => updateSparklineColor(i, color)}
                label={t('editor.kpi.sparklineColor')}
                clearLabel={t('editor.kpi.sparklineColorClear')}
                customLabel={t('editor.kpi.sparklineColorCustom')}
              />
            )}
          </div>
        ))}
        <Button variant="secondary" size="sm" type="button" onClick={addItem}>
          {t('editor.kpi.addItem')}
        </Button>
      </div>

      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {t('editor.kpi.preview')}
        </p>
        <KpiCardsBlockView block={local} />
      </div>
      <BlockHelpDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={{
          title: 'KPI 카드 블록',
          description: [
            '핵심 지표(KPI)를 카드 형태로 보여줍니다. 라벨(label), 값(value), 증감(delta)이 한 카드의 기본 구성입니다.',
            '`delta` 값은 부호에 따라 자동으로 ▲/▼/= 트렌드 화살표가 붙어요. 직접 `trend` 를 지정하면 자동 추론보다 우선합니다.',
          ],
          examples: [
            {
              title: '예시 1 — 매출 / NPS',
              body: 'label: 매출\nvalue: 1200\ndelta: +8%\n\nlabel: NPS\nvalue: 42\ndelta: +5',
            },
          ],
        }}
      />
    </div>
  )
}

interface SwatchProps {
  index: number
  color: string | undefined
  onChange: (color: string | undefined) => void
  label: string
  clearLabel: string
  customLabel: string
}

/**
 * Inline color picker for a single sparkline. Shows the 4 chart-palette
 * presets as round swatches + a custom hex input. Empty input + clear-button
 * reverts to the default (trend-driven) color by removing the `color` field.
 */
export function SparklineColorSwatches({
  index,
  color,
  onChange,
  label,
  clearLabel,
  customLabel,
}: SwatchProps) {
  const [draft, setDraft] = useState(color ?? '')
  const commitCustom = () => {
    const v = draft.trim()
    if (!v) {
      onChange(undefined)
      return
    }
    if (isHexColor(v)) onChange(v)
  }
  return (
    <div
      data-testid={`kpi-sparkline-color-${index}`}
      className="flex flex-wrap items-center gap-2 pl-1 text-[11px] text-gray-600"
    >
      <span className="font-medium">{label}</span>
      {SPARKLINE_PRESETS.map((preset) => {
        const active = color === preset
        return (
          <button
            key={preset}
            type="button"
            aria-label={`kpi ${index} sparkline color ${preset}`}
            aria-pressed={active}
            onClick={() => {
              setDraft(preset)
              onChange(preset)
            }}
            className={
              'h-5 w-5 rounded-full border ' +
              (active ? 'ring-2 ring-offset-1 ring-smsg-600 border-smsg-600' : 'border-gray-300')
            }
            style={{ backgroundColor: preset }}
          />
        )
      })}
      <Input
        aria-label={`kpi ${index} sparkline color custom`}
        placeholder={customLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitCustom}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitCustom()
          }
        }}
        className="!w-20 !text-[11px]"
      />
      {color != null && (
        <button
          type="button"
          aria-label={`kpi ${index} sparkline color clear`}
          onClick={() => {
            setDraft('')
            onChange(undefined)
          }}
          className="text-[11px] text-link hover:underline"
        >
          {clearLabel}
        </button>
      )}
    </div>
  )
}
