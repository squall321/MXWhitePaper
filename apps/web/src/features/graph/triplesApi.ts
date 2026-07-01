/**
 * Triple (의미 엣지) API 클라이언트 — graph-triple-fe.
 *
 * BE 의 `/api/v1/triples` (graph-edge-predicates 사이클 1차) 를 감싼다.
 * triple 은 (subject, predicate, object) 형태의 의미 엣지로, source 는
 * 'llm' (자동 추출) 또는 'manual' (사용자 입력).
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface Triple {
  id: string
  subject_slug: string
  predicate: string
  object_slug: string
  source: 'llm' | 'manual'
  confidence: number | null
  created_by: string | null
  created_at: string | null
  /** object 쪽에서 읽는 역방향 자연어 설명 (없으면 null → 표시 측 fallback). */
  inverse_predicate: string | null
}

export interface TripleCreate {
  subject_slug: string
  predicate: string
  object_slug: string
  /** 기본 'manual'. */
  source?: 'llm' | 'manual'
  confidence?: number | null
  /** 역방향 자연어 설명 (선택). */
  inverse_predicate?: string | null
}

export interface TripleListParams {
  subject?: string
  object?: string
  predicate?: string
  source?: 'llm' | 'manual'
}

export interface BulkExtractResult {
  documents: number
  stored: number
  replaced: number
  results: { subject_slug: string; stored: number; replaced: number }[]
  source: 'llm'
}

/** 필터 조회. 인자 미지정 시 전체. */
export async function fetchTriples(params: TripleListParams = {}): Promise<Triple[]> {
  const res = await apiClient.get<ApiEnvelope<Triple[]>>('/triples', { params })
  return unwrap<Triple[]>(res)
}

/** 단건 생성 (기본 manual). UNIQUE 위반 시 BE 가 409. */
export async function createTriple(body: TripleCreate): Promise<Triple> {
  const res = await apiClient.post<ApiEnvelope<Triple>>('/triples', body)
  return unwrap<Triple>(res)
}

/** 단건 삭제. 작성자 본인 또는 admin 만 (BE 가 강제). */
export async function deleteTriple(id: string): Promise<void> {
  await apiClient.delete<ApiEnvelope<{ id: string; deleted: boolean }>>(
    `/triples/${encodeURIComponent(id)}`,
  )
}

/** admin 일괄 LLM 추출. body 미지정 시 published 문서 전체 대상. */
export async function extractBulk(
  body: { slugs?: string[]; domain?: string } = {},
): Promise<BulkExtractResult> {
  const res = await apiClient.post<ApiEnvelope<BulkExtractResult>>(
    '/triples/extract/bulk',
    body,
  )
  return unwrap<BulkExtractResult>(res)
}
