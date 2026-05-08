import { apiClient } from '@/lib/api/client'
import type { OrgDivision, OrgTree } from './types'

interface ApiEnvelope<T> {
  data: T
  error?: { code: string; message: string } | null
}

/**
 * GET /api/v1/orgs/tree
 *
 * BE contract: returns `{ data: { divisions: OrgDivision[] }, meta, error }`.
 * The OrgTree type on the FE is a plain `OrgDivision[]`, so we unwrap the
 * `divisions` array here.
 */
export async function getOrgTree(): Promise<OrgTree> {
  try {
    const res = await apiClient.get<ApiEnvelope<{ divisions: OrgDivision[] }>>(
      '/orgs/tree',
    )
    return res.data.data?.divisions ?? []
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) {
      return []
    }
    throw err
  }
}
