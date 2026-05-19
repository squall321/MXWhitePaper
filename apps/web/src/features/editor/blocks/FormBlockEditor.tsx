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
import type { FormBlock, FormQuestion, Slug } from '@/types/document'
import { Button, Field, Input, Modal, Select } from '@/components/ui'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { ulid } from '../ulid'
import { apiClient } from '@/lib/api/client'
import { loadBlockDefaults, rememberBlockDefaults } from '../utils/blockDefaults'

interface Props {
  slug: Slug
  block: FormBlock
}

const KIND_LABELS: Record<FormQuestion['kind'], string> = {
  text: '단답',
  'long-text': '서술형',
  email: '이메일',
  number: '숫자',
  select: '단일 선택',
  'multi-select': '복수 선택',
  checkbox: '체크박스',
  'rating-5': '별점 5',
  date: '날짜',
}

/**
 * Pure helper exposed for unit tests — produces a sane default question
 * payload for the given `kind`.
 */
/**
 * pass-3 N4: `kind` 가 명시되지 않으면 사용자의 마지막 선택 (localStorage) 을
 * 기본값으로 적용. 호출자가 명시하면 그 값 우선. `required` 도 마지막 토글
 * 상태를 기억해 다음 추가 시 prefill.
 */
export function makeQuestion(kind?: FormQuestion['kind']): FormQuestion {
  const defaults = loadBlockDefaults<{ kind: FormQuestion['kind']; required: boolean }>(
    'form-field',
    { kind: 'text', required: false },
  )
  const resolvedKind = kind ?? defaults.kind
  const base: FormQuestion = {
    id: ulid(),
    kind: resolvedKind,
    label: '새 질문',
    required: defaults.required,
  }
  if (resolvedKind === 'select' || resolvedKind === 'multi-select') {
    return { ...base, options: ['옵션 1', '옵션 2'] }
  }
  return base
}

export function FormBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<FormBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [showResponses, setShowResponses] = useState(false)
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

  const persist = async (next: FormBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          title: next.title,
          description: next.description,
          questions: next.questions,
          submit_label: next.submit_label,
          thanks_message: next.thanks_message,
          allow_multiple_responses: next.allow_multiple_responses,
        } as Partial<FormBlock>,
        etag,
        '폼 편집',
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('충돌 — 새로고침 필요')
      } else {
        setError((err as Error).message)
      }
    }
  }

  const schedule = (next: FormBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const updateQuestion = (idx: number, patch: Partial<FormQuestion>) => {
    const next = {
      ...local,
      questions: local.questions.map((q, i) => (i === idx ? { ...q, ...patch } : q)) as FormBlock['questions'],
    }
    schedule(next)
  }

  const addQuestion = () => {
    const q = makeQuestion('text')
    const next = { ...local, questions: [...local.questions, q] as FormBlock['questions'] }
    schedule(next)
  }

  const removeQuestion = (idx: number) => {
    if (local.questions.length <= 1) return // schema minItems
    const next = {
      ...local,
      questions: local.questions.filter((_, i) => i !== idx) as FormBlock['questions'],
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
      questions: arrayMove(local.questions as FormQuestion[], from, to) as FormBlock['questions'],
    }
    schedule(next)
  }

  return (
    <div
      data-form-block-editor
      data-block-id={block.id}
      className="my-3 space-y-3 rounded border border-smsg-100 bg-smsg-50/40 p-3"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          value={local.title ?? ''}
          placeholder="폼 제목"
          onChange={(e) => schedule({ ...local, title: e.target.value || undefined })}
        />
        <Button variant="secondary" size="sm" onClick={() => setShowResponses(true)}>
          응답 보기
        </Button>
      </div>
      <textarea
        value={local.description ?? ''}
        placeholder="설명 (선택)"
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
          + 질문 추가
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="제출 버튼 라벨">
          <Input
            value={local.submit_label ?? ''}
            placeholder="제출"
            onChange={(e) => schedule({ ...local, submit_label: e.target.value || undefined })}
          />
        </Field>
        <Field label="감사 메시지">
          <Input
            value={local.thanks_message ?? ''}
            placeholder="응답해 주셔서 감사합니다."
            onChange={(e) => schedule({ ...local, thanks_message: e.target.value || undefined })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={!!local.allow_multiple_responses}
          onChange={(e) => schedule({ ...local, allow_multiple_responses: e.target.checked })}
        />
        다중 응답 허용
      </label>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {showResponses && (
        <ResponsesModal
          slug={slug}
          block={local}
          onClose={() => setShowResponses(false)}
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
  question: FormQuestion
  onChange: (p: Partial<FormQuestion>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const sortable = useSortable({ id: question.id })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  } as React.CSSProperties
  const showOptions = question.kind === 'select' || question.kind === 'multi-select'

  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className="rounded border border-gray-200 bg-white p-2"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="드래그하여 순서 변경"
          {...sortable.attributes}
          {...sortable.listeners}
          className="cursor-grab text-gray-400 hover:text-gray-700"
        >
          ⋮⋮
        </button>
        <Input
          value={question.label}
          placeholder="질문"
          onChange={(e) => onChange({ label: e.target.value })}
          className="flex-1"
        />
        <Select
          value={question.kind}
          onChange={(e) => {
            const k = e.target.value as FormQuestion['kind']
            rememberBlockDefaults('form-field', { kind: k })
            onChange({ kind: k })
          }}
        >
          {(Object.keys(KIND_LABELS) as Array<FormQuestion['kind']>).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={!!question.required}
            onChange={(e) => {
              rememberBlockDefaults('form-field', { required: e.target.checked })
              onChange({ required: e.target.checked })
            }}
          />
          필수
        </label>
        <Button variant="ghost" size="sm" onClick={onRemove} disabled={!canRemove}>
          삭제
        </Button>
      </div>
      {showOptions && (
        <div className="mt-2">
          <Input
            value={(question.options ?? []).join(', ')}
            placeholder="옵션을 쉼표로 구분 (예: 좋음, 보통, 나쁨)"
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      )}
    </li>
  )
}

interface ResponseRow {
  id: string
  user_id: string | null
  answers: Record<string, unknown>
  submitted_at: string | null
  submitter_name: string | null
  submitter_email: string | null
}

interface AggregateEntry {
  question_id: string
  label?: string
  kind: FormQuestion['kind']
  response_count: number
  counts?: Array<{ option: string; count: number }>
  samples?: string[]
  min?: number | null
  max?: number | null
  avg?: number | null
  weeks?: Array<{ week: string; count: number }>
  true_count?: number
  false_count?: number
  unique_count?: number
}

function ResponsesModal({
  slug,
  block,
  onClose,
}: {
  slug: Slug
  block: FormBlock
  onClose: () => void
}) {
  const [items, setItems] = useState<ResponseRow[]>([])
  const [aggregate, setAggregate] = useState<AggregateEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      setLoading(true)
      setErr(null)
      try {
        const [respRes, aggRes] = await Promise.all([
          apiClient.get(
            `/forms/${encodeURIComponent(slug)}/${encodeURIComponent(block.id)}/responses`,
          ),
          apiClient.get(
            `/forms/${encodeURIComponent(slug)}/${encodeURIComponent(block.id)}/aggregate`,
          ),
        ])
        if (!live) return
        setItems((respRes.data?.data?.items ?? []) as ResponseRow[])
        setAggregate((aggRes.data?.data?.questions ?? []) as AggregateEntry[])
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

  const byId = useMemo(() => {
    const m = new Map<string, FormQuestion>()
    for (const q of block.questions) m.set(q.id, q)
    return m
  }, [block.questions])

  return (
    <Modal open onClose={onClose} title="응답 보기" size="lg">
      {loading && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!loading && !err && (
        <div className="space-y-4">
          <section>
            <h4 className="mb-2 text-sm font-semibold text-smsg-900">집계</h4>
            {aggregate.length === 0 ? (
              <p className="text-xs text-gray-500">아직 응답이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {aggregate.map((a) => (
                  <li key={a.question_id} className="rounded border border-gray-200 p-2">
                    <p className="text-xs font-medium text-gray-700">
                      {a.label ?? a.question_id}{' '}
                      <span className="text-gray-400">({a.kind})</span>
                    </p>
                    <p className="text-[11px] text-gray-500">응답 {a.response_count}건</p>
                    {a.counts && a.counts.length > 0 && (
                      <div className="mt-1 h-32">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={a.counts}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="option" />
                            <YAxis allowDecimals={false} />
                            <RTooltip />
                            <Bar dataKey="count" fill="#0ea5e9" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {a.samples && a.samples.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-[11px] text-gray-600">
                        {a.samples.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    )}
                    {(a.min != null || a.max != null || a.avg != null) && (
                      <p className="mt-1 text-[11px] text-gray-600">
                        min: {a.min ?? '—'} / max: {a.max ?? '—'} / avg:{' '}
                        {a.avg == null ? '—' : a.avg.toFixed(2)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-smsg-900">목록</h4>
            {items.length === 0 ? (
              <p className="text-xs text-gray-500">응답이 없습니다.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-2 py-1">제출자</th>
                    <th className="px-2 py-1">제출일</th>
                    {block.questions.map((q) => (
                      <th key={q.id} className="px-2 py-1">
                        {q.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-2 py-1">
                        {r.submitter_name ?? r.submitter_email ?? '익명'}
                      </td>
                      <td className="px-2 py-1 text-gray-500">
                        {r.submitted_at?.slice(0, 16) ?? '—'}
                      </td>
                      {block.questions.map((q) => {
                        const v = r.answers?.[q.id]
                        const display = Array.isArray(v)
                          ? v.join(', ')
                          : typeof v === 'boolean'
                            ? v
                              ? '예'
                              : '아니오'
                            : v == null
                              ? '—'
                              : String(v)
                        return (
                          <td key={q.id} className="px-2 py-1">
                            {display}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
      {/* keep byId reference live for type-check completeness */}
      <span data-test-by-id-count={byId.size} hidden />
    </Modal>
  )
}
