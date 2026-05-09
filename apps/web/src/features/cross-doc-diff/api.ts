import type { Slug, DocumentJSONV10 } from '@/types/document'
import { getDocument, type DocumentResult } from '@/features/document/api'
import {
  diffDocument,
  type DocDiff,
} from '@/features/editor/diff/document-diff'

export interface CrossDocCompareResult {
  left: DocumentResult
  right: DocumentResult
  /** Convenience aliases used by the UI. */
  leftDoc: DocumentJSONV10
  rightDoc: DocumentJSONV10
  diff: DocDiff
}

/**
 * Fetches both documents in parallel via `getDocument(slug)` and computes the
 * `DocDiff` once so callers can pass it down to `<InlineDiff>` / summary
 * panels without recomputing.
 *
 * No new endpoint — reuses `GET /documents/:slug`.
 */
export async function compareDocs(
  leftSlug: Slug,
  rightSlug: Slug,
): Promise<CrossDocCompareResult> {
  const [left, right] = await Promise.all([
    getDocument(leftSlug),
    getDocument(rightSlug),
  ])
  const diff = diffDocument(left.document, right.document)
  return {
    left,
    right,
    leftDoc: left.document,
    rightDoc: right.document,
    diff,
  }
}
