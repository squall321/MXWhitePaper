import { useMemo, useState } from 'react'
 
import { create, all } from 'mathjs'
import type { CalculatorBlock } from '@/types/document'
import { Field, Input, Select } from '@/components/ui'

/**
 * mathjs is heavy; we only need the safe scalar evaluator. `create(all)`
 * gives us a sandboxed instance — note we never call `evaluate` with
 * arbitrary user functions, only the parsed expression with a scope.
 */
const math = create(all ?? {})

export type CalculatorEvalResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

/**
 * Pure helper exported for the test suite — given `formula` and the input
 * map, return either a stringified result or an error message.
 */
export function evaluateFormula(
  formula: string,
  inputs: CalculatorBlock['inputs'],
  values: Record<string, unknown>,
): CalculatorEvalResult {
  if (!formula.trim()) return { ok: false, error: '수식이 비어 있습니다.' }
  const scope: Record<string, unknown> = { inputs: values }
  // Also surface inputs as bare identifiers (`a` instead of `inputs.a`).
  for (const inp of inputs) {
    scope[inp.name] = values[inp.name]
  }
  try {
    const out = math.evaluate(formula, scope) as unknown
    if (typeof out === 'number') {
      return { ok: true, value: Number.isInteger(out) ? String(out) : out.toFixed(4).replace(/\.?0+$/, '') }
    }
    return { ok: true, value: String(out) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Coerce a raw form-input string into the correct JS value per `kind`. */
export function coerceValue(raw: string, kind: CalculatorBlock['inputs'][number]['kind']): unknown {
  if (kind === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  return raw
}

/** Build the initial value map from `inputs[].default`. */
export function defaultValues(inputs: CalculatorBlock['inputs']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const inp of inputs) {
    if (inp.default != null) out[inp.name] = inp.default
    else out[inp.name] = inp.kind === 'number' ? 0 : ''
  }
  return out
}

interface Props {
  block: CalculatorBlock
}

/**
 * Read-mode calculator. Renders one labeled input per `inputs[]` entry and
 * the live evaluation of `formula`.
 */
export function CalculatorBlockView({ block }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultValues(block.inputs))

  const result = useMemo(
    () => evaluateFormula(block.formula, block.inputs, values),
    [block.formula, block.inputs, values],
  )

  return (
    <section className="space-y-3 rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {block.inputs.map((inp) => (
          <Field key={inp.name} label={inp.label || inp.name}>
            {inp.kind === 'select' ? (
              <Select
                value={String(values[inp.name] ?? '')}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [inp.name]: coerceValue(e.target.value, inp.kind) }))
                }
              >
                <option value="">선택…</option>
              </Select>
            ) : (
              <Input
                type={inp.kind === 'number' ? 'number' : 'text'}
                value={String(values[inp.name] ?? '')}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [inp.name]: coerceValue(e.target.value, inp.kind) }))
                }
              />
            )}
          </Field>
        ))}
      </div>
      <div className="rounded border border-smsg-200 bg-smsg-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-smsg-700">
          {block.label || '결과'}
        </p>
        <p
          className="mt-0.5 text-lg font-semibold text-smsg-900"
          data-testid="calc-result"
        >
          {result.ok ? result.value : '—'}
        </p>
        {!result.ok && (
          <p className="text-[11px] text-red-600">{result.error}</p>
        )}
      </div>
    </section>
  )
}
