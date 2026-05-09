/**
 * Typed wrappers for POST /api/v1/admin/bulk-docs.
 *
 * Mirrors `BulkDocsIn` in `apps/api/app/routers/admin.py`. The endpoint
 * applies a single `op` to a batch of doc slugs and returns
 * `{ ok, failed, errors[] }` (partial-failure model).
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type BulkDocOp =
  | 'move-part'
  | 'add-tag'
  | 'remove-tag'
  | 'transition'
  | 'delete'

export interface BulkDocPayload {
  /** required for `move-part` */
  part_id?: string
  /** required for `add-tag` / `remove-tag` */
  tag?: string
  /** required for `transition`; one of draft|in_review|approved|published|archived */
  status?: 'draft' | 'in_review' | 'approved' | 'published' | 'archived'
}

export interface BulkDocsRequest {
  slugs: string[]
  op: BulkDocOp
  payload?: BulkDocPayload
}

export interface BulkDocsError {
  slug: string
  message: string
}

export interface BulkDocsResult {
  ok: number
  failed: number
  errors: BulkDocsError[]
}

export async function postBulkDocs(req: BulkDocsRequest): Promise<BulkDocsResult> {
  const res = await apiClient.post<ApiEnvelope<BulkDocsResult>>(
    '/admin/bulk-docs',
    {
      slugs: req.slugs,
      op: req.op,
      payload: req.payload ?? {},
    },
  )
  return unwrap<BulkDocsResult>(res)
}
