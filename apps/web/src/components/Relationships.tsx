// 문서 우측 레일의 "의미 관계" 패널 — 양방향 typed 엣지 표시 + 에디터의 직접 편집
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRelationships } from '@/features/graph/useRelationships'
import {
  createTriple,
  deleteTriple,
  fetchRelationshipTypes,
  type Triple,
} from '@/features/graph/triplesApi'
import { useAuthStore } from '@/features/auth/store'
import { Skeleton } from '@/components/ui/Skeleton'
import { toApiError } from '@/lib/api/envelope'
import type { Slug } from '@/types/document'

interface RelationshipsProps {
  slug: Slug
}

/** 들어오는 관계의 라벨 — inverse_predicate 가 있으면 그것, 없으면 generic fallback. */
function incomingLabel(t: Triple): string {
  return t.inverse_predicate?.trim() || '의 관련 문서'
}

function RelRow({ otherSlug, label, source, onDelete }: {
  otherSlug: string
  label: string
  source: 'llm' | 'manual'
  onDelete?: () => void
}) {
  return (
    <li className="rounded border border-gray-200 bg-white p-2 hover:border-smsg-500 dark:bg-gray-900 dark:border-gray-700">
      <div className="flex items-start justify-between gap-1">
        <span className="text-[11px] text-gray-500">{label}</span>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="관계 삭제"
            className="text-[11px] text-gray-400 hover:text-red-600"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Link
          to={`/docs/${encodeURIComponent(otherSlug)}`}
          className="text-link hover:underline"
        >
          {otherSlug}
        </Link>
        {source === 'llm' && (
          <span title="AI 가 추출한 관계" className="text-[10px] text-gray-400" aria-label="AI 추출">
            ✨
          </span>
        )}
      </div>
    </li>
  )
}

/** 에디터용 관계 추가 폼 — 온톨로지 predicate picker + object slug + optional inverse. */
function AddRelationForm({ slug, onDone }: { slug: Slug; onDone: () => void }) {
  const { data: types } = useQuery({
    queryKey: ['relationship-types'],
    queryFn: fetchRelationshipTypes,
    staleTime: 5 * 60_000,
  })
  const qc = useQueryClient()
  const [predicate, setPredicate] = useState('')
  const [customPredicate, setCustomPredicate] = useState('')
  const [objectSlug, setObjectSlug] = useState('')
  const [inverse, setInverse] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      createTriple({
        subject_slug: slug,
        predicate: predicate === '__custom__' ? customPredicate.trim() : predicate,
        object_slug: objectSlug.trim(),
        inverse_predicate: inverse.trim() || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['relationships', slug] })
      onDone()
    },
  })

  const effectivePredicate = predicate === '__custom__' ? customPredicate.trim() : predicate
  const canSubmit = !!effectivePredicate && !!objectSlug.trim() && !mutation.isPending

  return (
    <form
      className="mb-2 space-y-1.5 rounded border border-smsg-300 bg-smsg-50/40 p-2 dark:bg-gray-800 dark:border-gray-600"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) mutation.mutate()
      }}
    >
      <select
        aria-label="관계 유형"
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs dark:bg-gray-900 dark:border-gray-600"
        value={predicate}
        onChange={(e) => setPredicate(e.target.value)}
      >
        <option value="">관계 유형 선택…</option>
        {(types ?? []).map((t) => (
          <option key={t.key} value={t.predicate}>{t.predicate}</option>
        ))}
        <option value="__custom__">직접 입력…</option>
      </select>
      {predicate === '__custom__' && (
        <input
          aria-label="직접 입력 관계 술어"
          className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs dark:bg-gray-900 dark:border-gray-600"
          placeholder="관계 술어 (예: 참고한다)"
          value={customPredicate}
          onChange={(e) => setCustomPredicate(e.target.value)}
        />
      )}
      <input
        aria-label="대상 문서 slug"
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs dark:bg-gray-900 dark:border-gray-600"
        placeholder="대상 문서 slug"
        value={objectSlug}
        onChange={(e) => setObjectSlug(e.target.value)}
      />
      <input
        aria-label="역방향 설명 (선택)"
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs dark:bg-gray-900 dark:border-gray-600"
        placeholder="역방향 설명 (선택, 캐논이면 자동)"
        value={inverse}
        onChange={(e) => setInverse(e.target.value)}
      />
      {mutation.isError && (
        <p className="text-[11px] text-red-600">{toApiError(mutation.error).message}</p>
      )}
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-smsg-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-smsg-900 disabled:opacity-50"
        >
          추가
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 dark:border-gray-600"
        >
          취소
        </button>
      </div>
    </form>
  )
}

/**
 * 단순 하이퍼링크·백링크를 넘어, 문서 사이의 *의미 엣지*(triple)를 양방향으로 보여준다.
 * 나가는 관계는 predicate("이 문서 → 상대"), 들어오는 관계는 inverse_predicate로 설명.
 * 에디터는 이 패널에서 관계를 직접 추가/삭제한다(온톨로지 picker + 자동 inverse).
 * 데이터: `/api/v1/triples` (subject/object 필터). best-effort — 조회 실패해도 문서 보기를
 * 막지 않는다.
 */
export function Relationships({ slug }: RelationshipsProps) {
  const { data, isPending } = useRelationships(slug)
  const qc = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  const canEdit = role === 'editor' || role === 'admin'
  const [adding, setAdding] = useState(false)

  const outgoing = data?.outgoing ?? []
  const incoming = data?.incoming ?? []
  const empty = outgoing.length === 0 && incoming.length === 0

  const del = useMutation({
    mutationFn: (id: string) => deleteTriple(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['relationships', slug] }),
  })

  // 관계도 없고 편집 권한도 없으면 패널 숨김 (레일 절약). 에디터는 추가 위해 항상 노출.
  if (!isPending && empty && !canEdit) return null

  return (
    <section aria-label="의미 관계" className="mt-6 px-3">
      <div className="flex items-center justify-between pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">관계</h3>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[11px] text-link hover:underline"
          >
            + 관계 추가
          </button>
        )}
      </div>

      {canEdit && adding && <AddRelationForm slug={slug} onDone={() => setAdding(false)} />}

      {isPending ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : empty ? (
        <p className="text-xs text-gray-400">관계 없음</p>
      ) : (
        <div className="space-y-3">
          {outgoing.length > 0 && (
            <div>
              <p className="pb-1 text-[11px] font-medium text-gray-400">→ 나가는 관계</p>
              <ul className="space-y-2 text-sm">
                {outgoing.map((t) => (
                  <RelRow
                    key={t.id}
                    otherSlug={t.object_slug}
                    label={t.predicate}
                    source={t.source}
                    onDelete={canEdit ? () => del.mutate(t.id) : undefined}
                  />
                ))}
              </ul>
            </div>
          )}
          {incoming.length > 0 && (
            <div>
              <p className="pb-1 text-[11px] font-medium text-gray-400">← 들어오는 관계</p>
              <ul className="space-y-2 text-sm">
                {incoming.map((t) => (
                  <RelRow
                    key={t.id}
                    otherSlug={t.subject_slug}
                    label={incomingLabel(t)}
                    source={t.source}
                    onDelete={canEdit ? () => del.mutate(t.id) : undefined}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
