import { useQuery } from '@tanstack/react-query'
import { listDocuments, type DocumentCard, type ListDocumentsParams } from '../api'

export function useDocumentList(params: ListDocumentsParams = {}) {
  return useQuery<DocumentCard[]>({
    queryKey: ['documents', params],
    queryFn: () => listDocuments(params),
    staleTime: 60_000,
  })
}
