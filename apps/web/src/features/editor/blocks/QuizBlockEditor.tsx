import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import type { QuizBlock, QuizQuestion, Slug } from '@/types/document'
import { Button, Field, Input, Modal, Select } from '@/components/ui'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { ulid } from '../ulid'
import { useT } from '@/lib/i18n'
import { loadBlockDefaults, rememberBlockDefaults } from '../utils/blockDefaults'
import { apiClient } from '@/lib/api/client'

interface Props {
  slug: Slug
  block: QuizBlock
}

const KIND_LABEL_KEYS: Record<QuizQuestion['kind'], 'editor.quiz.kind.singleChoice' | 'editor.quiz.kind.multiChoice' | 'editor.quiz.kind.trueFalse' | 'editor.quiz.kind.shortText'> = {
  'single-choice': 'editor.quiz.kind.singleChoice',
  'multi-choice': 'editor.quiz.kind.multiChoice',
  'true-false': 'editor.quiz.kind.trueFalse',
  'short-text': 'editor.quiz.kind.shortText',
}

/**
 * Pure helper exposed for unit tests — produces a sane default question
 * payload (with sensible `correct` default) for the given `kind`.
 *
 * pass-3 N4: `kind` 미명시 시 마지막 사용 kind 를 localStorage 에서 복원.
 */
export function makeQuizQuestion(kind?: QuizQuestion['kind']): QuizQuestion {
  const resolvedKind: QuizQuestion['kind'] =
    kind ?? loadBlockDefaults<{ kind: QuizQuestion['kind'] }>('quiz-question', { kind: 'single-choice' }).kind
  const base = {
    id: ulid(),
    kind: resolvedKind,
    label: '새 문제',
    points: 1,
  }
  // 아래 분기에서 resolvedKind 사용 — 명명을 통일.
  kind = resolvedKind
  if (kind === 'single-choice') {
    return { ...base, options: ['옵션 1', '옵션 2'], correct: '옵션 1' }
  }
  if (kind === 'multi-choice') {
    return { ...base, options: ['옵션 1', '옵션 2'], correct: ['옵션 1'] }
  }
  if (kind === 'true-false') {
    return { ...base, correct: true }
  }
  return { ...base, correct: '' }
}

export function QuizBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<QuizBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [showAttempts, setShowAttempts] = useState(false)
  const debounceRef = useRef<number | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  useEffect(() => setLocal(block), [block])
  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const persist = async (next: QuizBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          title: next.title,
          description: next.description,
          questions: next.questions,
          passing_score: next.passing_score,
          shuffle: next.shuffle,
          max_attempts: next.max_attempts,
          show_answers_after: next.show_answers_after,
        } as Partial<QuizBlock>,
        etag,
        t('editor.quiz.changeLog'),
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError(t('editor.quiz.conflictError'))
      } else {
        setError((err as Error).message)
      }
    }
  }

  const schedule = (next: QuizBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const updateQuestion = (idx: number, patch: Partial<QuizQuestion>) => {
    const next = {
      ...local,
      questions: local.questions.map((q, i) =>
        i === idx ? { ...q, ...patch } : q,
      ) as QuizBlock['questions'],
    }
    schedule(next)
  }

  const addQuestion = () => {
    const q = makeQuizQuestion('single-choice')
    const next = { ...local, questions: [...local.questions, q] as QuizBlock['questions'] }
    schedule(next)
  }

  const removeQuestion = (idx: number) => {
    if (local.questions.length <= 1) return
    const next = {
      ...local,
      questions: local.questions.filter((_, i) => i !== idx) as QuizBlock['questions'],
    }
    schedule(next)
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = local.questions.map((q) => q.id)
    const from = ids.indexOf(active.id as string)
    const to = ids.indexOf(over.id as string)
    if (from < 0 || to < 0) return
    const next = {
      ...local,
      questions: arrayMove(local.questions as QuizQuestion[], from, to) as QuizBlock['questions'],
    }
    schedule(next)
  }

  return (
    <div
      data-quiz-block-editor
      data-block-id={block.id}
      className="my-3 space-y-3 rounded border border-smsg-100 bg-smsg-50/40 p-3"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          value={local.title ?? ''}
          placeholder={t('editor.quiz.titlePlaceholder')}
          onChange={(e) => schedule({ ...local, title: e.target.value || undefined })}
        />
        <Button variant="secondary" size="sm" onClick={() => setShowAttempts(true)}>
          {t('editor.quiz.viewAttempts')}
        </Button>
      </div>
      <textarea
        value={local.description ?? ''}
        placeholder={t('editor.quiz.descriptionPlaceholder')}
        onChange={(e) => schedule({ ...local, description: e.target.value || undefined })}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        rows={2}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={local.questions.map((q) => q.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {local.questions.map((q, i) => (
              <QuestionRow
                key={q.id}
                question={q}
                onChange={(p) => updateQuestion(i, p)}
                onRemove={() => removeQuestion(i)}
                canRemove={local.questions.length > 1}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div>
        <Button variant="secondary" size="sm" onClick={addQuestion}>
          {t('editor.quiz.addQuestion')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t('editor.quiz.passingScoreLabel')}>
          <Input
            type="number"
            min={0}
            max={100}
            value={local.passing_score ?? 70}
            onChange={(e) => {
              const n = Math.max(0, Math.min(100, Number(e.target.value) || 0))
              schedule({ ...local, passing_score: n })
            }}
          />
        </Field>
        <Field label={t('editor.quiz.maxAttemptsLabel')}>
          <Input
            type="number"
            min={0}
            value={local.max_attempts ?? 0}
            onChange={(e) => {
              const n = Math.max(0, Number(e.target.value) || 0)
              schedule({ ...local, max_attempts: n })
            }}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={!!local.shuffle}
            onChange={(e) => schedule({ ...local, shuffle: e.target.checked })}
          />
          {t('editor.quiz.shuffleLabel')}
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={local.show_answers_after !== false}
            onChange={(e) =>
              schedule({ ...local, show_answers_after: e.target.checked })
            }
          />
          {t('editor.quiz.showAnswersLabel')}
        </label>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {showAttempts && (
        <AttemptsModal
          slug={slug}
          block={local}
          onClose={() => setShowAttempts(false)}
        />
      )}
    </div>
  )
}

function QuestionRow({
  question,
  onChange,
  onRemove,
  canRemove,
}: {
  question: QuizQuestion
  onChange: (p: Partial<QuizQuestion>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const t = useT()
  const sortable = useSortable({ id: question.id })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  } as React.CSSProperties
  const showOptions =
    question.kind === 'single-choice' || question.kind === 'multi-choice'

  const onKindChange = (kind: QuizQuestion['kind']) => {
    // pass-3 N4: 마지막 사용 kind 를 기억해 다음 문제 추가 시 prefill.
    rememberBlockDefaults('quiz-question', { kind })
    // Reset `correct` to a sane default when the kind flips so the union
    // shape stays valid.
    if (kind === 'true-false') onChange({ kind, correct: true, options: undefined })
    else if (kind === 'short-text') onChange({ kind, correct: '', options: undefined })
    else if (kind === 'single-choice')
      onChange({
        kind,
        options: question.options ?? ['옵션 1', '옵션 2'],
        correct: (question.options ?? ['옵션 1'])[0] ?? '',
      })
    else if (kind === 'multi-choice')
      onChange({
        kind,
        options: question.options ?? ['옵션 1', '옵션 2'],
        correct: [],
      })
  }

  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className="rounded border border-gray-200 bg-white p-2"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t('editor.quiz.row.dragAria')}
          {...sortable.attributes}
          {...sortable.listeners}
          className="cursor-grab text-gray-400 hover:text-gray-700"
        >
          ⋮⋮
        </button>
        <Input
          value={question.label}
          placeholder={t('editor.quiz.row.questionPlaceholder')}
          onChange={(e) => onChange({ label: e.target.value })}
          className="flex-1"
        />
        <Select
          value={question.kind}
          onChange={(e) => onKindChange(e.target.value as QuizQuestion['kind'])}
        >
          {(Object.keys(KIND_LABEL_KEYS) as Array<QuizQuestion['kind']>).map((k) => (
            <option key={k} value={k}>
              {t(KIND_LABEL_KEYS[k])}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          min={0}
          value={question.points ?? 1}
          onChange={(e) => onChange({ points: Math.max(0, Number(e.target.value) || 0) })}
          className="w-16"
          aria-label={t('editor.quiz.row.pointsAria')}
        />
        <Button variant="ghost" size="sm" onClick={onRemove} disabled={!canRemove}>
          {t('editor.quiz.row.delete')}
        </Button>
      </div>

      {showOptions && (
        <div className="mt-2">
          <Input
            value={(question.options ?? []).join(', ')}
            placeholder={t('editor.quiz.row.optionsPlaceholder')}
            onChange={(e) => {
              const opts = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
              onChange({ options: opts })
            }}
          />
        </div>
      )}

      <div className="mt-2 grid grid-cols-1 gap-2">
        <Field label={t('editor.quiz.row.correctLabel')}>
          <CorrectInput question={question} onChange={onChange} />
        </Field>
        <Field label={t('editor.quiz.row.explanationLabel')}>
          <textarea
            value={question.explanation ?? ''}
            onChange={(e) => onChange({ explanation: e.target.value || undefined })}
            rows={2}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
          />
        </Field>
      </div>
    </li>
  )
}

function CorrectInput({
  question: q,
  onChange,
}: {
  question: QuizQuestion
  onChange: (p: Partial<QuizQuestion>) => void
}) {
  const t = useT()
  if (q.kind === 'short-text') {
    const v = typeof q.correct === 'string' ? q.correct : ''
    return (
      <Input
        value={v}
        placeholder={t('editor.quiz.correctInput.shortPlaceholder')}
        onChange={(e) => onChange({ correct: e.target.value })}
      />
    )
  }
  if (q.kind === 'true-false') {
    const v = q.correct === true
    return (
      <div className="flex gap-3" role="radiogroup">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="radio"
            checked={v}
            onChange={() => onChange({ correct: true })}
          />
          {t('editor.quiz.correctInput.tfYes')}
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="radio"
            checked={!v}
            onChange={() => onChange({ correct: false })}
          />
          {t('editor.quiz.correctInput.tfNo')}
        </label>
      </div>
    )
  }
  if (q.kind === 'single-choice') {
    const v = typeof q.correct === 'string' ? q.correct : ''
    return (
      <Select value={v} onChange={(e) => onChange({ correct: e.target.value })}>
        <option value="">{t('editor.quiz.correctInput.singlePick')}</option>
        {(q.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    )
  }
  if (q.kind === 'multi-choice') {
    const arr = Array.isArray(q.correct) ? q.correct : []
    return (
      <div className="flex flex-wrap gap-2">
        {(q.options ?? []).map((o) => {
          const checked = arr.includes(o)
          return (
            <label key={o} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...arr, o]
                    : arr.filter((x) => x !== o)
                  onChange({ correct: next })
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

interface AttemptRow {
  id: string
  user_id: string | null
  score: number
  passed: boolean
  duration_seconds: number
  submitted_at: string | null
  submitter_name: string | null
  submitter_email: string | null
  answers: Record<string, unknown>
}

function AttemptsModal({
  slug,
  block,
  onClose,
}: {
  slug: Slug
  block: QuizBlock
  onClose: () => void
}) {
  const t = useT()
  const [items, setItems] = useState<AttemptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      setLoading(true)
      setErr(null)
      try {
        const r = await apiClient.get(
          `/quiz/${encodeURIComponent(slug)}/${encodeURIComponent(block.id)}/attempts`,
        )
        if (!live) return
        setItems((r.data?.data?.items ?? []) as AttemptRow[])
      } catch (e) {
        if (!live) return
        setErr((e as Error).message)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [slug, block.id])

  const histogram = useMemo(() => {
    // 10-point buckets: 0-9, 10-19, …, 100.
    const buckets = Array.from({ length: 11 }, (_, i) => ({
      bucket: i === 10 ? '100' : `${i * 10}–${i * 10 + 9}`,
      count: 0,
    }))
    for (const r of items) {
      const idx = Math.min(10, Math.max(0, Math.floor(r.score / 10)))
      const bucket = buckets[idx]
      if (bucket) bucket.count += 1
    }
    return buckets
  }, [items])

  const accuracy = useMemo(() => {
    // Per-question accuracy across all attempts using the recorded answers.
    return block.questions.map((q) => {
      let total = 0
      let right = 0
      for (const r of items) {
        const ans = r.answers?.[q.id]
        total += 1
        if (q.kind === 'multi-choice') {
          const correct = Array.isArray(q.correct) ? q.correct : []
          const a = Array.isArray(ans) ? ans.map(String) : []
          if (
            a.length === correct.length &&
            new Set(a).size === new Set(correct).size &&
            a.every((x) => correct.includes(x))
          ) {
            right += 1
          }
        } else if (q.kind === 'true-false') {
          if (ans === q.correct) right += 1
        } else if (q.kind === 'short-text') {
          if (
            typeof ans === 'string' &&
            typeof q.correct === 'string' &&
            ans.trim().toLowerCase() === q.correct.trim().toLowerCase()
          ) {
            right += 1
          }
        } else if (q.kind === 'single-choice') {
          if (typeof ans === 'string' && ans === q.correct) right += 1
        }
      }
      const pct = total === 0 ? 0 : Math.round((right * 100) / total)
      return { question_id: q.id, label: q.label, pct }
    })
  }, [items, block.questions])

  return (
    <Modal open onClose={onClose} title={t('editor.quiz.attempts.modalTitle')} size="lg">
      {loading && <p className="text-sm text-gray-500">{t('editor.quiz.attempts.loading')}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!loading && !err && (
        <div className="space-y-4">
          <section>
            <h4 className="mb-2 text-sm font-semibold text-smsg-900">
              {t('editor.quiz.attempts.histogramHeading')}
            </h4>
            {items.length === 0 ? (
              <p className="text-xs text-gray-500">{t('editor.quiz.attempts.emptyHistogram')}</p>
            ) : (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogram}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" />
                    <YAxis allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="count" fill="#0ea5e9" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-smsg-900">
              {t('editor.quiz.attempts.accuracyHeading')}
            </h4>
            {items.length === 0 ? (
              <p className="text-xs text-gray-500">{t('editor.quiz.attempts.emptyAccuracy')}</p>
            ) : (
              <ul className="space-y-1">
                {accuracy.map((a) => (
                  <li key={a.question_id} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700">{a.label}</span>
                      <span className="text-gray-500">{a.pct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-gray-100">
                      <div
                        className="h-full bg-emerald-400"
                        style={{ width: `${a.pct}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-smsg-900">{t('editor.quiz.attempts.listHeading')}</h4>
            {items.length === 0 ? (
              <p className="text-xs text-gray-500">{t('editor.quiz.attempts.emptyList')}</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-2 py-1">{t('editor.quiz.attempts.col.submitter')}</th>
                    <th className="px-2 py-1">{t('editor.quiz.attempts.col.score')}</th>
                    <th className="px-2 py-1">{t('editor.quiz.attempts.col.passed')}</th>
                    <th className="px-2 py-1">{t('editor.quiz.attempts.col.duration')}</th>
                    <th className="px-2 py-1">{t('editor.quiz.attempts.col.time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-2 py-1">
                        {r.submitter_name ?? r.submitter_email ?? t('editor.quiz.attempts.anonymous')}
                      </td>
                      <td className="px-2 py-1">{r.score}</td>
                      <td className="px-2 py-1">{r.passed ? '✅' : '—'}</td>
                      <td className="px-2 py-1">{r.duration_seconds}s</td>
                      <td className="px-2 py-1 text-gray-500">
                        {r.submitted_at?.slice(0, 16) ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
