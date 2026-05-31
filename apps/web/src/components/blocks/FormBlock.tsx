import { useState, useMemo, type FormEvent } from 'react'
import type { FormBlock, FormQuestion } from '@/types/document'
import { Field, Input, Select, Button } from '@/components/ui'
import { apiClient } from '@/lib/api/client'
import { useEditorStore } from '@/features/editor/state'
import { useT } from '@/lib/i18n'

export type AnswerValue = string | number | boolean | string[] | null

export interface FormBlockViewProps {
  block: FormBlock
}

const initialAnswer = (q: FormQuestion): AnswerValue => {
  if (q.kind === 'multi-select') return []
  if (q.kind === 'checkbox') return false
  return ''
}

/** Defense-in-depth cap mirrored from BE (forms.py:_PATTERN_MAX_LEN). */
const PATTERN_MAX_LEN = 200

/** Compile a FormQuestion.pattern safely. Returns null on invalid/too-long. */
function compilePattern(pattern: string | undefined): RegExp | null {
  if (!pattern || pattern.length > PATTERN_MAX_LEN) return null
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

/**
 * Validation error returned by `validateAnswers`. Locale-free so the
 * pure function stays decoupled from the i18n layer; the view consumes
 * this via `formatFormError(t, err)`.
 */
export type FormError =
  | { code: 'required' }
  | { code: 'invalidEmail' }
  | { code: 'numberOnly' }
  | { code: 'numberMin'; min: number }
  | { code: 'numberMax'; max: number }
  | { code: 'rating1to5' }
  | { code: 'dateFormat' }
  | { code: 'minLength'; minLength: number }
  | { code: 'maxLength'; maxLength: number }
  | { code: 'patternMismatch' }

/**
 * Pure helper: client-side validate `answers` against `questions`. Returns
 * a map of `{questionId: FormError}` for any failure (empty when ok).
 *
 * Mirrors the BE rules so the UX surfaces the same error before round-trip.
 * Locale-free: callers translate the error code via `formatFormError`.
 */
export function validateAnswers(
  questions: readonly FormQuestion[],
  answers: Record<string, AnswerValue>,
): Record<string, FormError> {
  const errs: Record<string, FormError> = {}
  for (const q of questions) {
    const v = answers[q.id]
    const isEmpty =
      v == null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0)
    if (isEmpty) {
      if (q.required) errs[q.id] = { code: 'required' }
      continue
    }
    if (q.kind === 'email' && typeof v === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      errs[q.id] = { code: 'invalidEmail' }
    }
    if (q.kind === 'number') {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) {
        errs[q.id] = { code: 'numberOnly' }
      } else {
        if (typeof q.min === 'number' && n < q.min) {
          errs[q.id] = { code: 'numberMin', min: q.min }
        } else if (typeof q.max === 'number' && n > q.max) {
          errs[q.id] = { code: 'numberMax', max: q.max }
        }
      }
    }
    if (q.kind === 'rating-5') {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n) || n < 1 || n > 5) errs[q.id] = { code: 'rating1to5' }
    }
    if (q.kind === 'date' && typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      errs[q.id] = { code: 'dateFormat' }
    }
    if (
      (q.kind === 'text' || q.kind === 'long-text' || q.kind === 'email') &&
      typeof v === 'string' &&
      !errs[q.id]
    ) {
      if (typeof q.minLength === 'number' && v.length < q.minLength) {
        errs[q.id] = { code: 'minLength', minLength: q.minLength }
      } else if (typeof q.maxLength === 'number' && v.length > q.maxLength) {
        errs[q.id] = { code: 'maxLength', maxLength: q.maxLength }
      } else if (q.pattern) {
        const re = compilePattern(q.pattern)
        if (re !== null && !re.test(v)) {
          errs[q.id] = { code: 'patternMismatch' }
        }
      }
    }
  }
  return errs
}

/**
 * Render a `FormError` into a localized string. Lives next to the pure
 * validator so the error union and its presentation stay in sync.
 */
export function formatFormError(
  t: (key: 'block.form.error.required' | 'block.form.error.invalidEmail' | 'block.form.error.numberOnly' | 'block.form.error.numberMin' | 'block.form.error.numberMax' | 'block.form.error.rating1to5' | 'block.form.error.dateFormat' | 'block.form.error.minLength' | 'block.form.error.maxLength' | 'block.form.error.patternMismatch', vars?: Record<string, string | number>) => string,
  err: FormError,
): string {
  switch (err.code) {
    case 'required':
      return t('block.form.error.required')
    case 'invalidEmail':
      return t('block.form.error.invalidEmail')
    case 'numberOnly':
      return t('block.form.error.numberOnly')
    case 'numberMin':
      return t('block.form.error.numberMin', { min: err.min })
    case 'numberMax':
      return t('block.form.error.numberMax', { max: err.max })
    case 'rating1to5':
      return t('block.form.error.rating1to5')
    case 'dateFormat':
      return t('block.form.error.dateFormat')
    case 'minLength':
      return t('block.form.error.minLength', { minLength: err.minLength })
    case 'maxLength':
      return t('block.form.error.maxLength', { maxLength: err.maxLength })
    case 'patternMismatch':
      return t('block.form.error.patternMismatch')
  }
}

export function FormBlockView({ block }: FormBlockViewProps) {
  const t = useT()
  const slug = useEditorStore((s) => s.slug)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
    const o: Record<string, AnswerValue> = {}
    for (const q of block.questions) o[q.id] = initialAnswer(q)
    return o
  })
  const [errors, setErrors] = useState<Record<string, FormError>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const submitLabel = block.submit_label ?? t('block.form.button.submit')
  const thanksMessage = block.thanks_message ?? t('block.form.message.thanks')
  const allowAgain = !!block.allow_multiple_responses
  const questions = useMemo(() => block.questions, [block.questions])

  const update = (id: string, val: AnswerValue) => {
    setAnswers((a) => ({ ...a, [id]: val }))
    setErrors((e) => {
      if (!(id in e)) return e
      const next = { ...e }
      delete next[id]
      return next
    })
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    const errs = validateAnswers(questions, answers)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    if (!slug) {
      setSubmitError(t('block.form.error.docUnidentified'))
      return
    }
    setSubmitting(true)
    try {
      // Strip empties so BE doesn't choke on blank optional fields.
      const payload: Record<string, AnswerValue> = {}
      for (const q of questions) {
        const v = answers[q.id]
        if (v == null) continue
        if (typeof v === 'string' && v.trim() === '') continue
        if (Array.isArray(v) && v.length === 0) continue
        payload[q.id] = v
      }
      await apiClient.post(
        `/forms/${encodeURIComponent(slug)}/${encodeURIComponent(block.id)}/responses`,
        { answers: payload },
      )
      setSubmitted(true)
    } catch (err) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } }; message?: string }
      setSubmitError(
        e2?.response?.data?.error?.message ?? e2?.message ?? t('block.form.error.submitFailed'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <section
        data-form-block
        data-block-id={block.id}
        className="my-3 rounded border border-emerald-200 bg-emerald-50 p-4"
      >
        <p className="text-sm font-medium text-emerald-900">{thanksMessage}</p>
        {allowAgain && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              const o: Record<string, AnswerValue> = {}
              for (const q of questions) o[q.id] = initialAnswer(q)
              setAnswers(o)
              setSubmitted(false)
            }}
          >
            {t('block.form.button.respondAgain')}
          </Button>
        )}
      </section>
    )
  }

  return (
    <form
      data-form-block
      data-block-id={block.id}
      onSubmit={onSubmit}
      className="my-3 space-y-3 rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      {block.title && <h3 className="text-base font-semibold text-smsg-900">{block.title}</h3>}
      {block.description && (
        <p className="text-sm text-gray-600">{block.description}</p>
      )}
      {questions.map((q) => (
        <Field
          key={q.id}
          label={`${q.label}${q.required ? ' *' : ''}`}
          error={errors[q.id] ? formatFormError(t, errors[q.id]!) : undefined}
        >
          <QuestionInput
            question={q}
            value={answers[q.id] ?? null}
            onChange={(v) => update(q.id, v)}
          />
        </Field>
      ))}
      {submitError && <p className="text-xs text-red-600">{submitError}</p>}
      <div>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? '제출 중…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}

function QuestionInput({
  question: q,
  value,
  onChange,
}: {
  question: FormQuestion
  value: AnswerValue
  onChange: (v: AnswerValue) => void
}) {
  if (q.kind === 'text' || q.kind === 'email') {
    return (
      <Input
        type={q.kind === 'email' ? 'email' : 'text'}
        value={String(value ?? '')}
        placeholder={q.placeholder ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (q.kind === 'long-text') {
    return (
      <textarea
        value={String(value ?? '')}
        placeholder={q.placeholder ?? ''}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />
    )
  }
  if (q.kind === 'number') {
    return (
      <Input
        type="number"
        value={value == null ? '' : String(value)}
        placeholder={q.placeholder ?? ''}
        onChange={(e) => {
          const n = e.target.value === '' ? '' : Number(e.target.value)
          onChange(n)
        }}
      />
    )
  }
  if (q.kind === 'date') {
    return (
      <Input
        type="date"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (q.kind === 'select') {
    return (
      <Select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">선택…</option>
        {(q.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    )
  }
  if (q.kind === 'multi-select') {
    const arr = Array.isArray(value) ? value : []
    return (
      <div className="flex flex-wrap gap-2">
        {(q.options ?? []).map((o) => {
          const checked = arr.includes(o)
          return (
            <label key={o} className="flex items-center gap-1 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...arr, o]
                    : arr.filter((x) => x !== o)
                  onChange(next)
                }}
              />
              {o}
            </label>
          )
        })}
      </div>
    )
  }
  if (q.kind === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{q.placeholder ?? '확인'}</span>
      </label>
    )
  }
  if (q.kind === 'rating-5') {
    const n = typeof value === 'number' ? value : 0
    return (
      <div className="flex gap-1" role="radiogroup" aria-label={q.label}>
        {[1, 2, 3, 4, 5].map((r) => (
          <button
            type="button"
            key={r}
            role="radio"
            aria-checked={n === r}
            onClick={() => onChange(r)}
            className={`h-8 w-8 rounded text-sm ${
              n >= r
                ? 'bg-amber-400 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700'
            }`}
          >
            ★
          </button>
        ))}
      </div>
    )
  }
  return null
}
