/**
 * Read receipts API client (Cycle 0023).
 *
 * Mirrors `apps/api/app/routers/read_receipts.py`:
 *   POST /documents/:slug/ack-read    — explicit "확인했어요" button (idempotent)
 *   GET  /documents/:slug/read-receipts — implicit reads + explicit acks (editor+)
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { Slug } from '@/types/document'

export interface ReadReceipt {
  user_id: string
  name: string | null
  email: string | null
  last_read_at: string | null
  read_seconds: number
  acknowledged_at: string | null
  comment: string | null
}

export interface ReadReceiptsList {
  readers: ReadReceipt[]
}

export interface AckReadResult {
  id: string
  document_id: string
  slug: string
  acknowledged_at: string | null
  comment: string | null
}

export async function ackRead(
  slug: Slug,
  comment?: string | null,
): Promise<AckReadResult> {
  const res = await apiClient.post<ApiEnvelope<AckReadResult>>(
    `/documents/${encodeURIComponent(slug)}/ack-read`,
    { comment: comment ?? null },
  )
  return unwrap<AckReadResult>(res)
}

export async function listReadReceipts(slug: Slug): Promise<ReadReceipt[]> {
  const res = await apiClient.get<ApiEnvelope<ReadReceiptsList>>(
    `/documents/${encodeURIComponent(slug)}/read-receipts`,
  )
  return unwrap<ReadReceiptsList>(res).readers ?? []
}

export interface RemindResult {
  slug: string
  user_id: string
  /** False when the recipient has the in_app channel disabled — caller may
   *  still surface a soft "리마인더 발송됨 (수신자 알림 차단)" toast. */
  notified: boolean
}

export async function remindReader(
  slug: Slug,
  userId: string,
): Promise<RemindResult> {
  const res = await apiClient.post<ApiEnvelope<RemindResult>>(
    `/documents/${encodeURIComponent(slug)}/read-receipts/remind`,
    { user_id: userId },
  )
  return unwrap<RemindResult>(res)
}
