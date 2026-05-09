import { useMemo, useState } from 'react'
import { parse } from 'mathjs'
import type { CalculatorBlock, Slug } from '@/types/document'
import { Button, Field, IconButton, Input, Select } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { CalculatorBlockView } from '@/components/blocks/CalculatorBlock'
import { BlockHelpDrawer } from '@/features/editor/components/BlockHelpDrawer'
import { useT, t as tStatic } from '@/lib/i18n'

const KINDS: NonNullable<CalculatorBlock['inputs'][number]['kind']>[] = [
  'number',
  'text',
  'select',
]

export interface CalculatorTemplate {
  id: string
  label: string
  inputs: CalculatorBlock['inputs']
  formula: string
  resultLabel: string
}

/**
 * Two starter templates so the empty calculator block isn't a cold start.
 *   - ROI 계산기:    (gain - cost) / cost * 100
 *   - 비용편익:       benefit / cost
 */
export const CALCULATOR_TEMPLATES: ReadonlyArray<CalculatorTemplate> = [
  {
    id: 'roi',
    label: 'ROI 계산기',
    inputs: [
      { name: 'gain', label: '이익', kind: 'number', default: 0 },
      { name: 'cost', label: '비용', kind: 'number', default: 1 },
    ],
    formula: '(gain - cost) / cost * 100',
    resultLabel: 'ROI (%)',
  },
  {
    id: 'cost_benefit',
    label: '비용편익',
    inputs: [
      { name: 'benefit', label: '편익', kind: 'number', default: 0 },
      { name: 'cost', label: '비용', kind: 'number', default: 1 },
    ],
    formula: 'benefit / cost',
    resultLabel: '편익/비용 비율',
  },
]

interface Props {
  slug: Slug
  block: CalculatorBlock
}

/** Validate the formula with mathjs `parse` (does not execute). */
export function validateFormula(formula: string): { ok: true } | { ok: false; error: string } {
  if (!formula.trim()) return { ok: false, error: tStatic('editor.calc.formulaEmpty') }
  try {
    parse(formula)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Pretty-print a numeric result with comma thousands separators and an
 * optional unit suffix. Non-numeric results pass through unchanged.
 */
export function formatResult(raw: string, unit?: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return raw
  // Match the leading numeric token so e.g. `12.5 (some text)` formats nicely.
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)/)
  if (!m || m[1] == null) return unit ? `${raw} ${unit}` : raw
  const numericLiteral = m[1]
  const n = Number(numericLiteral)
  if (!Number.isFinite(n)) return raw
  const intPart = Math.trunc(n).toString()
  const sign = intPart.startsWith('-') ? '-' : ''
  const absInt = sign ? intPart.slice(1) : intPart
  const grouped = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fracMatch = numericLiteral.match(/\.(\d+)$/)
  const frac = fracMatch ? `.${fracMatch[1]}` : ''
  const numericFmt = `${sign}${grouped}${frac}`
  const rest = trimmed.slice(m[0].length)
  const head = `${numericFmt}${rest}`
  return unit ? `${head} ${unit}` : head
}

/**
 * `calculator` editor — manage `inputs[]` rows, the formula, and an output
 * label. The live `CalculatorBlockView` below acts as a preview.
 */
export function CalculatorBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<CalculatorBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState<string>('')
  const [unit, setUnit] = useState<string>('')
  const [helpOpen, setHelpOpen] = useState(false)

  const formulaCheck = useMemo(() => validateFormula(local.formula), [local.formula])

  const push = async (next: CalculatorBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, t('editor.calc.changeLog'))
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError(t('editor.common.conflict'))
      else setError((err as Error).message)
    }
  }

  const updateInput = (idx: number, patch: Partial<CalculatorBlock['inputs'][number]>) => {
    const inputs = local.inputs.map((inp, i) => (i === idx ? { ...inp, ...patch } : inp))
    void push({ ...local, inputs })
  }
  const addInput = () => {
    const next: CalculatorBlock['inputs'][number] = {
      name: `var${local.inputs.length + 1}`,
      label: t('editor.calc.newVar', { n: local.inputs.length + 1 }),
      kind: 'number',
      default: 0,
    }
    void push({ ...local, inputs: [...local.inputs, next] })
  }
  const removeInput = (idx: number) => {
    void push({ ...local, inputs: local.inputs.filter((_, i) => i !== idx) })
  }

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    if (!id) return
    const tpl = CALCULATOR_TEMPLATES.find((t) => t.id === id)
    if (!tpl) return
    void push({
      ...local,
      inputs: tpl.inputs,
      formula: tpl.formula,
      label: tpl.resultLabel,
    })
  }

  const isEmpty = local.inputs.length === 0 && !local.formula.trim()

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      {isEmpty && (
        <div
          data-testid="calculator-empty-state"
          className="rounded-md border border-dashed border-smsg-300 bg-white p-4 text-center dark:bg-gray-900"
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('editor.calc.empty')}
          </p>
          <div className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button
              size="sm"
              type="button"
              onClick={() => applyTemplate('roi')}
            >
              {t('editor.calc.addRoiTemplate')}
            </Button>
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t('editor.calc.resultLabel')}>
          <Input
            value={local.label ?? ''}
            onChange={(e) => setLocal({ ...local, label: e.target.value })}
            onBlur={() => void push(local)}
            placeholder={t('editor.calc.resultPlaceholder')}
            aria-label={t('editor.calc.resultLabel')}
          />
        </Field>
        <Field label={t('editor.calc.template')}>
          <Select
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            aria-label={t('editor.calc.template')}
          >
            <option value="">{t('editor.calc.templatePick')}</option>
            {CALCULATOR_TEMPLATES.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={t('editor.calc.unit')}>
        <Input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder={t('editor.calc.unitPlaceholder')}
          aria-label={t('editor.calc.unit')}
        />
      </Field>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-700">{t('editor.calc.inputsHeader')}</p>
        {local.inputs.map((inp, i) => (
          <div
            key={i}
            className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]"
          >
            <Field label={t('editor.calc.inputName')}>
              <Input
                value={inp.name}
                onChange={(e) => updateInput(i, { name: e.target.value })}
                aria-label={`input ${i} name`}
              />
            </Field>
            <Field label={t('editor.calc.inputLabel')}>
              <Input
                value={inp.label}
                onChange={(e) => updateInput(i, { label: e.target.value })}
                aria-label={`input ${i} label`}
              />
            </Field>
            <Field label={t('editor.calc.inputKind')}>
              <Select
                value={inp.kind ?? 'number'}
                onChange={(e) =>
                  updateInput(i, {
                    kind: e.target.value as NonNullable<CalculatorBlock['inputs'][number]['kind']>,
                  })
                }
                aria-label={`input ${i} kind`}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('editor.calc.inputDefault')}>
              <Input
                value={inp.default == null ? '' : String(inp.default)}
                onChange={(e) =>
                  updateInput(i, {
                    default:
                      inp.kind === 'number'
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
                aria-label={`input ${i} default`}
              />
            </Field>
            <IconButton
              aria-label={`input ${i} remove`}
              onClick={() => removeInput(i)}
            >
              <span aria-hidden="true">×</span>
            </IconButton>
          </div>
        ))}
        <Button variant="secondary" size="sm" type="button" onClick={addInput}>
          {t('editor.calc.addInput')}
        </Button>
      </div>

      <Field
        label={t('editor.calc.formula')}
        hint={formulaCheck.ok ? t('editor.calc.formulaOk') : undefined}
        error={!formulaCheck.ok ? formulaCheck.error : undefined}
      >
        <textarea
          value={local.formula}
          onChange={(e) => setLocal({ ...local, formula: e.target.value })}
          onBlur={() => void push(local)}
          rows={3}
          aria-label={t('editor.calc.formula')}
          aria-invalid={!formulaCheck.ok || undefined}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
        />
      </Field>

      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {t('editor.calc.preview')}
        </p>
        <CalculatorBlockView block={local} />
        {unit && (
          <p className="mt-2 text-[11px] text-gray-500" data-testid="formatted-hint">
            {t('editor.calc.unitHint', { unit })}
          </p>
        )}
      </div>
      <BlockHelpDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={{
          title: '계산기 블록',
          description: [
            '`inputs[]` 로 변수를 정의하고 `formula` 에 mathjs 호환 수식을 작성합니다. 미리보기가 즉시 결과를 계산해 보여줘요.',
            '입력 변수에는 `name` (수식에서 참조), `label` (UI 표시), `kind` (number/text/select), `default` 가 있습니다.',
          ],
          examples: [
            {
              title: '예시 — ROI',
              body: 'inputs:\n  - name: gain, label: 이익, kind: number\n  - name: cost, label: 비용, kind: number\nformula: (gain - cost) / cost * 100',
            },
          ],
        }}
      />
    </div>
  )
}
