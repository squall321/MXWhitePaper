import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { getOrgTree } from '../api'
import { toApiError } from '@/lib/api/envelope'
import { toast } from '@/components/ui/Toast'
import type { OrgTree } from '../types'

export function useOrgTree() {
  const q = useQuery<OrgTree>({
    queryKey: ['orgs', 'tree'],
    queryFn: getOrgTree,
    staleTime: 5 * 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  })
  // Surface fresh errors to the toast layer once per error instance so
  // SSR snapshots and HMR remounts don't double-fire.
  const lastShown = useRef<Error | null>(null)
  useEffect(() => {
    if (q.error && q.error !== lastShown.current) {
      lastShown.current = q.error
      toast.error(`조직 트리 로드 실패: ${toApiError(q.error).message}`)
    }
  }, [q.error])
  return q
}
