import { apiClient } from '@/lib/api/client'
import { unwrapListMaybe } from '@/lib/api/envelope'
import type { OrgDivision, OrgTree } from './types'

/**
 * GET /api/v1/orgs/tree
 *
 * BE contract: returns `{ data: { divisions: OrgDivision[] }, meta, error }`.
 * The OrgTree type on the FE is a plain `OrgDivision[]`, so we pull the list
 * out of the keyed `divisions` envelope. 404 / network → `[]`.
 */
export async function getOrgTree(): Promise<OrgTree> {
  return unwrapListMaybe<OrgDivision>(
    apiClient.get('/orgs/tree'),
    'divisions',
  )
}
