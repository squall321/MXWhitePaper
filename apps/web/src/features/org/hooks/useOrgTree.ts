import { useQuery } from '@tanstack/react-query'
import { getOrgTree } from '../api'
import type { OrgTree } from '../types'

export function useOrgTree() {
  return useQuery<OrgTree>({
    queryKey: ['orgs', 'tree'],
    queryFn: getOrgTree,
    staleTime: 5 * 60_000,
  })
}
