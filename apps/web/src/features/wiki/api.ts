// AI 위키 API — 목록 · 기록 · 원천 · 검토 큐 · 위키 문서 정보(배지 · 근거) · 켜짐 여부(docs/llm-wiki W4)
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
