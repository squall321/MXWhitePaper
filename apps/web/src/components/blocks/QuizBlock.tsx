import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { QuizBlock, QuizQuestion } from '@/types/document'
import { Field, Input, Button } from '@/components/ui'
import { apiClient } from '@/lib/api/client'
import { useEditorStore } from '@/features/editor/state'

export type QuizAnswerValue = string | string[] | boolean | null

/** 32-bit deterministic hash of an arbitrary string (FNV-1a). Good enough as
 *  a Fisher-Yates seed; the cryptographic strength is irrelevant — we only
 *  need a stable scrambling per attempt. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Tiny xorshift32 PRNG. Deterministic for a given seed; cheap and pure. */
function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Stable Fisher-Yates shuffle. Returns a new array; does not mutate.
 * Seed is hashed before use so callers can pass a string attempt id.
 */
export function shuffleSeeded<T>(items: readonly T[], seed: string | number): T[] {
  const out = items.slice()
  const rnd = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed >>> 0)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export interface QuizBlockViewProps {
  block: QuizBlock
}

interface AttemptResult {
  id: string
  score: number
  passed: boolean
  breakdown: Array<{ question_id: string; correct: boolean; points: number }>
  explanations: Record<string, string>
  total_points: number
  earned_points: number
}

interface MyAttemptsMeta {
  count: number
  max_attempts: number
  remaining: number | null
}

const initialAnswer = (q: QuizQuestion): QuizAnswerValue => {
  if (q.kind === 'multi-choice') return []
  if (q.kind === 'true-false') return null
  return ''
}

/**
 * Pure helper used by the FE to short-circuit obviously invalid submissions
 * (empty required answers). The server is the source of truth for scoring —
 * this only flags missing answers so the user gets immediate feedback.
 */
export function findMissingAnswers(
  questions: readonly QuizQuestion[],
  answers: Record<string, QuizAnswerValue>,
): string[] {
  const missing: string[] = []
  for (const q of questions) {
    const v = answers[q.id]
    const empty =
      v == null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0)
    if (empty) missing.push(q.id)
  }
  return missing
}

export function QuizBlockView({ block }: QuizBlockViewProps) {
  const slug = useEditorStore((s) => s.slug)
  const [answers, setAnswers] = useState<Record<string, QuizAnswerValue>>(() => {
    const o: Record<string, QuizAnswerValue> = {}
    for (const q of block.questions) o[q.id] = initialAnswer(q)
    return o
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [meta, setMeta] = useState<MyAttemptsMeta | null>(null)
  const [startedAt, setStartedAt] = useState<number>(() => Date.now())
  // Frontend-side attempt id used as a Fisher-Yates seed when
  // ``block.shuffle === true``. Re-minted on `reset()` so each retry gets
  // a fresh ordering, but stable while the same form is being filled out.
  const [attemptId, setAttemptId] = useState<string>(
    () => `${block.id}:${startedAt}:${Math.random().toString(36).slice(2, 10)}`,
  )

  const showAnswers = block.show_answers_after !== false
  const questions = useMemo(() => {
    if (block.shuffle) {
      return shuffleSeeded(block.questions, attemptId)
    }
    return block.questions
  }, [block.questions, block.shuffle, attemptId])
  const remaining = meta?.remaining ?? null
  const maxAttempts = block.max_attempts ?? 0
  const canRetry = result != null && (maxAttempts === 0 || (remaining ?? 1) > 0)

  // Look up how many attempts the current user has used so we can offer
  // "다시 시도" only when allowed. Best-effort — failures stay silent.
  useEffect(() => {
    let live = true
    if (!slug) return
    void (async () => {
      try {
        const r = await apiClient.get(
          `/quiz/me/${encodeURIComponent(slug)}/${encodeURIComponent(block.id)}`,
        )
        if (!live) return
        setMeta((r.data?.meta ?? null) as MyAttemptsMeta | null)
      } catch {
        /* ignore — viewer may be anonymous on share-link route */
      }
    })()
    return () => {
      live = false
    }
  }, [slug, block.id])

  const update = (id: string, val: QuizAnswerValue) => {
    setAnswers((a) => ({ ...a, [id]: val }))
  }

  const reset = () => {
    const o: Record<string, QuizAnswerValue> = {}
    for (const q of block.questions) o[q.id] = initialAnswer(q)
    setAnswers(o)
    setResult(null)
    setSubmitError(null)
    // Mint a fresh attempt id so the (optional) shuffle re-seeds.
    const ts = Date.now()
    setStartedAt(ts)
    setAttemptId(
      `${block.id}:${ts}:${Math.random().toString(36).slice(2, 10)}`,
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (!slug) {
      setSubmitError('현재 문서를 식별할 수 없습니다.')
      return
    }
    setSubmitting(true)
    try {
      const payload: Record<string, QuizAnswerValue> = {}
      for (const q of questions) {
        const v = answers[q.id]
        if (v == null) continue
        if (typeof v === 'string' && v.trim() === '') continue
        if (Array.isArray(v) && v.length === 0) continue
        payload[q.id] = v
      }
      const duration = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      const r = await apiClient.post(
        `/quiz/${encodeURIComponent(slug)}/${encodeURIComponent(block.id)}/attempts`,
        { answers: payload, duration_seconds: duration },
      )
      const data = (r.data?.data ?? null) as AttemptResult | null
      if (data) setResult(data)
      // Refresh remaining attempts.
      try {
        const m = await apiClient.get(
          `/quiz/me/${encodeURIComponent(slug)}/${encodeURIComponent(block.id)}`,
        )
        setMeta((m.data?.meta ?? null) as MyAttemptsMeta | null)
      } catch {
        /* ignore */
      }
    } catch (err) {
      const e2 = err as {
        response?: { data?: { error?: { message?: string } }; status?: number }
        message?: string
      }
      setSubmitError(
        e2?.response?.data?.error?.message ?? e2?.message ?? '제출에 실패했습니다.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    const correctCount = result.breakdown.filter((b) => b.correct).length
    const tone = result.passed
      ? 'border-emerald-200 bg-emerald-50'
      : 'border-amber-200 bg-amber-50'
    return (
      <section
        data-quiz-block
        data-block-id={block.id}
        className={`my-3 space-y-3 rounded border p-4 ${tone}`}
      >
        <div>
          <p className="text-base font-semibold">
            점수 {result.score}점{' '}
            <span className={result.passed ? 'text-emerald-700' : 'text-amber-700'}>
              ({result.passed ? '통과' : '미통과'})
            </span>
          </p>
          <p className="text-xs text-gray-600">
            {correctCount} / {result.breakdown.length} 정답 ·{' '}
            {result.earned_points} / {result.total_points} 점
          </p>
        </div>
        {showAnswers && (
          <ul className="space-y-2">
            {questions.map((q, i) => {
              const b = result.breakdown.find((x) => x.question_id === q.id)
              const explanation = result.explanations?.[q.id]
              return (
                <li
                  key={q.id}
                  className="rounded border border-gray-200 bg-white p-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                >
                  <p className="font-medium text-smsg-900">
                    {i + 1}. {q.label}
                  </p>
                  <p
                    className={
                      b?.correct ? 'text-emerald-700 text-xs' : 'text-red-600 text-xs'
                    }
                  >
                    {b?.correct ? '정답' : '오답'} ({b?.points ?? 0}점)
                  </p>
                  {explanation && (
                    <p className="mt-1 text-xs text-gray-600">해설: {explanation}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex items-center gap-2">
          {canRetry && (
            <Button variant="secondary" size="sm" onClick={reset}>
              다시 시도
            </Button>
          )}
          {maxAttempts > 0 && remaining != null && (
            <span className="text-xs text-gray-500">
              남은 시도 {remaining} / {maxAttempts}
            </span>
          )}
        </div>
      </section>
    )
  }

  const noAttemptsLeft = maxAttempts > 0 && remaining === 0

  return (
    <form
      data-quiz-block
      data-block-id={block.id}
      onSubmit={onSubmit}
      className="my-3 space-y-3 rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      {block.title && <h3 className="text-base font-semibold text-smsg-900">{block.title}</h3>}
      {block.description && (
        <p className="text-sm text-gray-600">{block.description}</p>
      )}
      {questions.map((q, i) => (
        <Field key={q.id} label={`${i + 1}. ${q.label}`}>
          <QuestionInput
            question={q}
            value={answers[q.id] ?? null}
            onChange={(v) => update(q.id, v)}
          />
        </Field>
      ))}
      {submitError && <p className="text-xs text-red-600">{submitError}</p>}
      {noAttemptsLeft && (
        <p className="text-xs text-amber-700">최대 시도 횟수에 도달했습니다.</p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={submitting || noAttemptsLeft}>
          {submitting ? '채점 중…' : '제출'}
        </Button>
        {maxAttempts > 0 && remaining != null && (
          <span className="text-xs text-gray-500">
            남은 시도 {remaining} / {maxAttempts}
          </span>
        )}
      </div>
    </form>
  )
}

function QuestionInput({
  question: q,
  value,
  onChange,
}: {
  question: QuizQuestion
  value: QuizAnswerValue
  onChange: (v: QuizAnswerValue) => void
}) {
  if (q.kind === 'short-text') {
    return (
      <Input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (q.kind === 'true-false') {
    const v = value === true ? 'true' : value === false ? 'false' : ''
    return (
      <div className="flex gap-2" role="radiogroup" aria-label={q.label}>
        {(['true', 'false'] as const).map((opt) => (
          <label key={opt} className="flex items-center gap-1 text-sm">
            <input
              type="radio"
              name={`q-${q.id}`}
              checked={v === opt}
              onChange={() => onChange(opt === 'true')}
            />
            {opt === 'true' ? '예' : '아니오'}
          </label>
        ))}
      </div>
    )
  }
  if (q.kind === 'single-choice') {
    return (
      <div className="space-y-1" role="radiogroup" aria-label={q.label}>
        {(q.options ?? []).map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`q-${q.id}`}
              checked={value === o}
              onChange={() => onChange(o)}
            />
            {o}
          </label>
        ))}
      </div>
    )
  }
  if (q.kind === 'multi-choice') {
    const arr = Array.isArray(value) ? value : []
    return (
      <div className="space-y-1">
        {(q.options ?? []).map((o) => {
          const checked = arr.includes(o)
          return (
            <label key={o} className="flex items-center gap-2 text-sm">
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
  return null
}
