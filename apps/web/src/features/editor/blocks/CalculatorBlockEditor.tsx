import { useMemo, useState } from 'react'
import { parse } from 'mathjs'
import type { CalculatorBlock, Slug } from '@/types/document'
import { Button, Field, IconButton, Input, Select } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { CalculatorBlockView } from '@/components/blocks/CalculatorBlock'

const KINDS: NonNullable<CalculatorBlock['inputs'][number]['kind']>[] = [
  'number',
  'text',
  'select',
]

interface Props {
  slug: Slug
  block: CalculatorBlock
}

/** Validate the formula with mathjs `parse` (does not execute). */
export function validateFormula(formula: string): { ok: true } | { ok: false; error: string } {
  if (!formula.trim()) return { ok: false, error: '수식이 비어 있습니다.' }
  try {
    parse(formula)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * `calculator` editor — manage `inputs[]` rows, the formula, and an output
 * label. The live `CalculatorBlockView` below acts as a preview.
 */
export function CalculatorBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<CalculatorBlock>(block)
  const [error, setError] = useState<string | null>(null)

  const formulaCheck = useMemo(() => validateFormula(local.formula), [local.formula])

  const push = async (next: CalculatorBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '계산기 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
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
      label: `변수 ${local.inputs.length + 1}`,
      kind: 'number',
      default: 0,
    }
    void push({ ...local, inputs: [...local.inputs, next] })
  }
  const removeInput = (idx: number) => {
    void push({ ...local, inputs: local.inputs.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      <Field label="결과 라벨">
        <Input
          value={local.label ?? ''}
          onChange={(e) => setLocal({ ...local, label: e.target.value })}
          onBlur={() => void push(local)}
          placeholder="예: 총합"
        />
      </Field>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-700">입력 변수</p>
        {local.inputs.map((inp, i) => (
          <div
            key={i}
            className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]"
          >
            <Field label="이름">
              <Input
                value={inp.name}
                onChange={(e) => updateInput(i, { name: e.target.value })}
                aria-label={`input ${i} name`}
              />
            </Field>
            <Field label="라벨">
              <Input
                value={inp.label}
                onChange={(e) => updateInput(i, { label: e.target.value })}
                aria-label={`input ${i} label`}
              />
            </Field>
            <Field label="종류">
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
            <Field label="기본값">
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
              ×
            </IconButton>
          </div>
        ))}
        <Button variant="secondary" size="sm" type="button" onClick={addInput}>
          + 입력 변수
        </Button>
      </div>

      <Field
        label="수식"
        hint={formulaCheck.ok ? '구문 OK' : undefined}
        error={!formulaCheck.ok ? formulaCheck.error : undefined}
      >
        <textarea
          value={local.formula}
          onChange={(e) => setLocal({ ...local, formula: e.target.value })}
          onBlur={() => void push(local)}
          rows={3}
          aria-label="formula"
          aria-invalid={!formulaCheck.ok || undefined}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
        />
      </Field>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          미리보기
        </p>
        <CalculatorBlockView block={local} />
      </div>
    </div>
  )
}
