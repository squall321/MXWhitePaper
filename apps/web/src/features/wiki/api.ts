// AI 위키 API — 목록 · 기록 · 원천 · 검토 큐 · 위키 문서 정보(배지 · 근거) · 켜짐 여부(W4) · 온톨로지 · 엔티티 등록부 · 합치기(W5) · 내 후보 · 되쌓기 · 질문(W6) · 점검 · 질문판(W7)
/**
 * `apps/api/app/routers/wiki.py`(`/api/v1/wiki/*`)와 1:1. 위키가 꺼져 있으면 모두 404(`wiki_disabled`) — `useWikiEnabled` 가
 * 인증 없는 `/wiki/health` 로 본다. 범위 밖 원천 · 문서 · 묶음은 서버가 404 로 감춘다.
 */
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface WikiCite {
  source_id: string
  short: string
  kind: string
  title: string
  system: string
  url: string | null
  captured_at: string
  status: string
  locator: Record<string, unknown>
  quote: string | null
  doc_slug: string | null
}

export type WikiSourceRef = Omit<WikiCite, 'locator' | 'quote'>

export interface WikiPageInfo {
  slug: string
  kind: string
  managed: 'ai' | 'human'
  audience: string[]
  review_lock: boolean
  stale_since: string | null
  entity: { type_key: string; name: string } | null
  citations: Record<string, WikiCite[]>
  sources: WikiSourceRef[]
}

export interface WikiIndexItem {
  slug: string
  title: string
  summary: string
  kind: string
}

export interface WikiIndexSection {
  key: string
  label: string
  count: number
  items: WikiIndexItem[]
  more: number
}

export interface WikiIndex {
  version: number
  at: string
  docs: number
  sources: number
  sections: WikiIndexSection[]
}

export interface WikiLogEntry {
  id: number
  at: string
  op: string
  title: string
  detail: Record<string, unknown>
  actor: string | null
  job_id: string | null
  changeset_id: string | null
}

export interface WikiSource {
  id: string
  short: string
  kind: string
  origin: { system: string; ref: string; rev: string | null; url: string | null }
  title: string
  summary: string | null
  audience: string[]
  sensitivity: string
  via: string
  captured_at: string
  received_at: string
  status: 'active' | 'superseded' | 'withdrawn'
  ingest_state: string
  supersedes_id: string | null
  doc_slug: string | null
  attachments: number
  mine: boolean
  payload?: Record<string, unknown>
  blobs?: { key: string; name: string; mime: string; sha256: string; bytes: number; role: string }[]
}

export type WikiVerdict = 'pass' | 'warn' | 'review' | 'fail'

export interface WikiCheck {
  rule: string
  verdict: WikiVerdict
  detail: string
}

export interface WikiChangeRow {
  id: string
  short: string
  op: string
  status: string
  created_at: string
  source: { id: string | null; short: string | null }
  docs: { slug: string; title: string; new: boolean }[]
  rules: string[]
  audience: string[]
  error: string | null
}

export interface WikiChangeOp {
  op: 'block.insert' | 'block.update' | 'block.delete'
  block_id: string
  why: string
  section: string | null
  before: string | null
  after: string | null
  cites: { sid: string; short: string; title: string; loc: Record<string, unknown>; quote: string | null }[]
}

export interface WikiChangeDoc {
  slug: string
  title: string
  new: boolean
  kind: string
  type_key: string
  audience: string[]
  why: string
  ops: WikiChangeOp[]
}

/** 관계 연산(W5) — 코드가 단 것(code)과 계획이 낸 것(llm). label 은 목적어 뒤에 붙여 읽는 술어 이름. */
export interface WikiChangeRelation {
  subject: string
  subject_title: string
  predicate: string
  label: string
  object: string
  object_title: string
  why: string
  origin: 'code' | 'llm'
  confidence: number | null
  cites: { short: string; title: string }[]
}

/** 합치기 한쪽 — 제안 때의 모습(계획에 남은 것). */
export interface WikiMergeSide {
  id: string
  type_key: string
  name: string
  aliases: string[]
  ext_ids: Record<string, string>
  audience: string[]
  status: string
}

export interface WikiChangeMerge {
  from: WikiMergeSide
  into: WikiMergeSide
  why: string
  /** 반영했으면 — 다시 이은 문서(같은 범위에 문서가 이미 있으면 낡음) · 다시 들일 원천. */
  applied: { pages: { doc_id: string; slug: string; stale: boolean }[]; reingest: string[] } | null
}

export interface WikiChange {
  id: string
  short: string
  op: string
  status: string
  created_at: string
  schema_version: number
  model: string | null
  summary: string
  questions: string[]
  contradictions: string[]
  source: { id: string | null; short: string | null }
  validation: WikiCheck[]
  audience: string[]
  error: string | null
  decision: { by: string | null; at: string | null; note: string | null }
  docs: WikiChangeDoc[]
  relations?: WikiChangeRelation[]
  relations_dropped?: { subject: string; predicate: string; object: string; why: string }[]
  merges?: WikiChangeMerge[]
}

export type OntologyStatus = 'approved' | 'proposed' | 'rejected'

export interface WikiEntityType {
  key: string
  label_ko: string
  label_en: string | null
  parent_key: string | null
  abbr: string
  description: string | null
  ext_axes: { ra?: string; sp?: string; other?: string; ext_ids?: string[] }
  status: OntologyStatus
  decided_at: string | null
  decision_note: string | null
  created_at: string | null
  entities: number
}

export interface WikiPredicate {
  key: string
  label_ko: string
  inverse_ko: string
  domain_types: string[]
  range_types: string[]
  symmetric: boolean
  description: string | null
  status: OntologyStatus
  decided_at: string | null
  decision_note: string | null
  created_at: string | null
}

export interface WikiEntityPage {
  slug: string
  title: string
  audience: string[]
  stale_since: string | null
}

/** `full` 이 아니면(엔티티를 만든 범위의 토큰이 없으면) 별칭 · 외부 id · 속성은 비어 온다. */
export interface WikiEntity {
  id: string
  type_key: string
  type_label: string
  name: string
  status: 'active' | 'merged' | 'retired'
  merged_into: string | null
  created_at: string
  updated_at: string
  full: boolean
  pages: WikiEntityPage[]
  aliases: string[]
  ext_ids: Record<string, string>
  attrs: Record<string, unknown>
  merged_from?: { id: string; name: string }[]
}

export interface WikiDuplicate {
  type_key: string
  why: string
  a: { id: string; name: string; audience: string[] }
  b: { id: string; name: string; audience: string[] }
}

export async function getWikiHealth(): Promise<unknown> {
  const res = await apiClient.get<ApiEnvelope<unknown>>('/wiki/health')
  return unwrap(res)
}

/** 위키가 켜져 있나 — `/wiki/health` 가 200 이면 켜짐(꺼지면 404). 내비 링크 · 문서 배지를 가린다. */
export function useWikiEnabled(): boolean {
  const q = useQuery({ queryKey: ['wiki', 'health'], queryFn: getWikiHealth, retry: false, staleTime: 5 * 60_000 })
  return q.isSuccess
}

export async function getWikiIndex(): Promise<WikiIndex> {
  return unwrap(await apiClient.get<ApiEnvelope<WikiIndex>>('/wiki/index'))
}

export async function getWikiLog(limit = 200): Promise<WikiLogEntry[]> {
  return unwrap(await apiClient.get<ApiEnvelope<WikiLogEntry[]>>('/wiki/log', { params: { limit } })) ?? []
}

export async function getWikiSource(id: string): Promise<WikiSource> {
  return unwrap(await apiClient.get<ApiEnvelope<WikiSource>>(`/wiki/sources/${encodeURIComponent(id)}`))
}

export async function withdrawWikiSource(id: string): Promise<{ status: string; changed: boolean }> {
  return unwrap(await apiClient.post<ApiEnvelope<{ status: string; changed: boolean }>>(
    `/wiki/sources/${encodeURIComponent(id)}/withdraw`,
  ))
}

export async function getWikiPage(slug: string): Promise<WikiPageInfo> {
  return unwrap(await apiClient.get<ApiEnvelope<WikiPageInfo>>(`/wiki/pages/${encodeURIComponent(slug)}`))
}

export async function listWikiChanges(status?: string): Promise<{ rows: WikiChangeRow[]; total: number }> {
  const res = await apiClient.get<ApiEnvelope<WikiChangeRow[]>>('/wiki/changes', {
    params: { status: status || undefined, limit: 100 },
  })
  return { rows: unwrap(res) ?? [], total: Number(res.data.meta?.total ?? 0) }
}

export async function getWikiChange(id: string): Promise<WikiChange> {
  return unwrap(await apiClient.get<ApiEnvelope<WikiChange>>(`/wiki/changes/${encodeURIComponent(id)}`))
}

export async function decideWikiChange(
  id: string,
  action: 'approve' | 'reject' | 'revert',
  note?: string,
): Promise<{ status: string }> {
  const body = action === 'revert' ? undefined : { note: note || null }
  return unwrap(await apiClient.post<ApiEnvelope<{ status: string }>>(
    `/wiki/changes/${encodeURIComponent(id)}/${action}`,
    body,
  ))
}

export async function getWikiOntology(): Promise<{ types: WikiEntityType[]; predicates: WikiPredicate[] }> {
  return unwrap(await apiClient.get<ApiEnvelope<{ types: WikiEntityType[]; predicates: WikiPredicate[] }>>('/wiki/ontology'))
}

export async function proposeWikiType(body: { key: string; label_ko: string; abbr: string; description?: string }): Promise<WikiEntityType> {
  return unwrap(await apiClient.post<ApiEnvelope<WikiEntityType>>('/wiki/ontology/types', body))
}

export async function proposeWikiPredicate(body: {
  key: string; label_ko: string; inverse_ko: string; domain_types: string[]; range_types: string[]; symmetric: boolean
}): Promise<WikiPredicate> {
  return unwrap(await apiClient.post<ApiEnvelope<WikiPredicate>>('/wiki/ontology/predicates', body))
}

export async function decideWikiOntology(
  kind: 'types' | 'predicates', key: string, action: 'approve' | 'reject', note?: string,
): Promise<{ status: OntologyStatus }> {
  return unwrap(await apiClient.post<ApiEnvelope<{ status: OntologyStatus }>>(
    `/wiki/ontology/${kind}/${encodeURIComponent(key)}/${action}`, { note: note || null },
  ))
}

export async function listWikiEntities(params: { type?: string; q?: string; status?: string; limit?: number }):
Promise<{ rows: WikiEntity[]; total: number }> {
  const res = await apiClient.get<ApiEnvelope<WikiEntity[]>>('/wiki/entities', {
    params: { type: params.type || undefined, q: params.q || undefined, status: params.status || undefined,
      limit: params.limit ?? 100 },
  })
  return { rows: unwrap(res) ?? [], total: Number(res.data.meta?.total ?? 0) }
}

export async function getWikiEntity(id: string): Promise<WikiEntity> {
  return unwrap(await apiClient.get<ApiEnvelope<WikiEntity>>(`/wiki/entities/${encodeURIComponent(id)}`))
}

export async function patchWikiEntity(id: string, body: { aliases?: string[]; ext_ids?: Record<string, string> }): Promise<WikiEntity> {
  return unwrap(await apiClient.patch<ApiEnvelope<WikiEntity>>(`/wiki/entities/${encodeURIComponent(id)}`, body))
}

export async function getWikiDuplicates(): Promise<WikiDuplicate[]> {
  return unwrap(await apiClient.get<ApiEnvelope<WikiDuplicate[]>>('/wiki/entities/duplicates')) ?? []
}

export async function proposeWikiMerge(fromId: string, intoId: string, note?: string): Promise<{ id: string; short: string; status: string }> {
  return unwrap(await apiClient.post<ApiEnvelope<{ id: string; short: string; status: string }>>(
    '/wiki/entities/merge', { from_id: fromId, into_id: intoId, note: note || null },
  ))
}

/** 내 후보(W6) — 포털 챗이 보낸 주인만 보는 원천. 승인하면 고른 범위로 들이고, 기한이 지나면 서버가 철회한다. */
export interface WikiCandidate {
  id: string
  short: string
  kind: string
  title: string
  summary: string
  received_at: string
  expires_at: string
  suggested_audience: string[]
  system: string
  doc_slug: string | null
}

export async function listWikiCandidates(): Promise<WikiCandidate[]> {
  return unwrap(await apiClient.get<ApiEnvelope<WikiCandidate[]>>('/wiki/candidates')) ?? []
}

export async function approveWikiCandidate(id: string, audience?: string[]): Promise<{ id: string; short: string; audience: string[] }> {
  return unwrap(await apiClient.post<ApiEnvelope<{ id: string; short: string; audience: string[] }>>(
    `/wiki/candidates/${encodeURIComponent(id)}/approve`, { audience: audience ?? null },
  ))
}

export async function discardWikiCandidate(id: string): Promise<{ status: string }> {
  return unwrap(await apiClient.post<ApiEnvelope<{ status: string }>>(`/wiki/candidates/${encodeURIComponent(id)}/discard`))
}

export interface WikiFilebackResult {
  id: string
  short: string
  dedup: boolean
  doc_slug: string | null
  ingest_state: string
  audience: string[]
}

/** 묻기의 답을 위키에 남긴다 — qa 원천(그 사람 명의) → 들이기. 범위는 근거보다 넓을 수 없다(서버가 본다). */
export async function filebackWikiAnswer(body: {
  question: string
  answer: string
  citations: { slug: string; block_id: string; n: number }[]
  outcome: 'solved' | 'partial' | 'unknown'
  audience?: string[]
}): Promise<WikiFilebackResult> {
  return unwrap(await apiClient.post<ApiEnvelope<WikiFilebackResult>>('/wiki/fileback', body))
}

/** 질문 대기열에 남긴다 — 범위를 주지 않으면 남긴 사람만 본다. 같은 물음이면 물은 수만 오른다. */
export async function addWikiQuestion(text: string, origin: 'user' | 'query_miss', audience?: string[]):
  Promise<{ id: string; asked_count: number; created: boolean; audience: string[] }> {
  return unwrap(await apiClient.post<ApiEnvelope<{ id: string; asked_count: number; created: boolean; audience: string[] }>>(
    '/wiki/questions', { text, origin, ...(audience ? { audience } : {}) },
  ))
}

/** 질문판(W7) — 지속 질의가 푼 결과(답 원천 · 실험 제안 · 사람이 필요한 까닭)는 `detail`. 범위 밖 물음은 서버가 감춘다. */
export type WikiQuestionStatus = 'open' | 'asking' | 'answered' | 'needs_human' | 'needs_experiment' | 'closed' | 'dropped'

export interface WikiQuestion {
  id: string
  text: string
  origin: 'lint' | 'ingest' | 'user' | 'query_miss' | 'standing'
  audience: string[]
  priority: number
  status: WikiQuestionStatus
  asked_count: number
  last_asked_at: string
  created_at: string
  mine: boolean
  attempts: number
  detail: Record<string, unknown>
  answer_source: { id: string; short: string } | null
  answered_at: string | null
}

export async function listWikiQuestions(status?: WikiQuestionStatus): Promise<{ rows: WikiQuestion[]; total: number }> {
  const res = await apiClient.get<ApiEnvelope<WikiQuestion[]>>('/wiki/questions', { params: { status: status || undefined, limit: 200 } })
  return { rows: unwrap(res) ?? [], total: Number(res.data.meta?.total ?? 0) }
}

export async function patchWikiQuestion(id: string, body: { status?: 'open' | 'closed' | 'dropped'; priority?: number }): Promise<WikiQuestion> {
  return unwrap(await apiClient.patch<ApiEnvelope<WikiQuestion>>(`/wiki/questions/${encodeURIComponent(id)}`, body))
}

/** 사람이 답한다 — 그 사람 명의의 원천이 되어 위키에 들어간다(전사 물음은 검토자 · admin 만). */
export async function answerWikiQuestion(id: string, answer: string, confidence = 0.8):
  Promise<WikiQuestion & { source: { id: string; short: string } }> {
  return unwrap(await apiClient.post<ApiEnvelope<WikiQuestion & { source: { id: string; short: string } }>>(
    `/wiki/questions/${encodeURIComponent(id)}/answer`, { answer, confidence },
  ))
}

/** 점검(W7) — 결함은 한 줄로 이어진다. 범위 토큰을 다 가진 것만 보인다. */
export type WikiLintRule =
  | 'orphan' | 'uncited' | 'stale' | 'contradiction' | 'missing_page' | 'missing_link' | 'gap' | 'schema' | 'stuck_review'

export interface WikiFinding {
  id: string
  rule: WikiLintRule
  severity: 'info' | 'warn' | 'error'
  title: string
  status: 'open' | 'question_raised' | 'fixed' | 'dismissed'
  docs: { slug: string; title: string }[]
  sources: { id: string; short: string }[]
  detail: Record<string, unknown>
  question_id: string | null
  fixed_by_changeset: string | null
  first_seen_at: string
  last_seen_at: string
  audience: string[]
}

export interface WikiLintMeta {
  total: number
  by_rule: Partial<Record<WikiLintRule, number>>
  last_run: { id: string; scope: string; llm: boolean; started_at: string; finished_at: string; error: string | null } | null
}

export async function listWikiFindings(params: { rule?: WikiLintRule; status?: 'fixed' | 'dismissed' | 'all' }):
  Promise<{ rows: WikiFinding[]; meta: WikiLintMeta }> {
  const res = await apiClient.get<ApiEnvelope<WikiFinding[]>>('/wiki/lint/findings', { params: { ...params, limit: 200 } })
  const meta = (res.data.meta ?? {}) as Partial<WikiLintMeta>
  return { rows: unwrap(res) ?? [], meta: { total: Number(meta.total ?? 0), by_rule: meta.by_rule ?? {}, last_run: meta.last_run ?? null } }
}

export async function dismissWikiFinding(id: string, note: string): Promise<{ id: string; status: string }> {
  return unwrap(await apiClient.post<ApiEnvelope<{ id: string; status: string }>>(
    `/wiki/lint/findings/${encodeURIComponent(id)}/dismiss`, { note },
  ))
}

/** 점검을 줄 세운다(검토자) — 워커가 돈다. LLM 을 켜면 조용한 시간까지 기다릴 수 있다. */
export async function runWikiLint(body: { scope: 'full' | 'docs'; slugs?: string[]; llm?: boolean } = { scope: 'full' }):
  Promise<{ job_id: string }> {
  return unwrap(await apiClient.post<ApiEnvelope<{ job_id: string }>>('/wiki/lint', body))
}

/** ISO 시각 → `YYYY-MM-DD HH:MM`(KST) — 규칙서의 날짜 꼴. */
export function kst(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}
