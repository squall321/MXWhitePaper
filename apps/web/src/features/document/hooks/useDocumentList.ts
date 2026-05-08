import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { listDocuments, type DocumentCard, type ListDocumentsParams } from '../api'
import { toApiError } from '@/lib/api/envelope'
import { toast } from '@/components/ui/Toast'

export function useDocumentList(params: ListDocumentsParams = {}) {
  const q = useQuery<DocumentCard[]>({
    queryKey: ['documents', params],
    queryFn: () => listDocuments(params),
    staleTime: 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
    // Stable shape — DocumentCard[] is already what we want; the select is
    // here so a future BE shape change has a single place to renormalise.
    select: (rows) => (Array.isArray(rows) ? rows : []),
  })
  const lastShown = useRef<Error | null>(null)
  useEffect(() => {
    if (q.error && q.error !== lastShown.current) {
      lastShown.current = q.error
      toast.error(`문서 목록 로드 실패: ${toApiError(q.error).message}`)
    }
  }, [q.error])
  return q
}
