import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getDocument, type DocumentResult } from '../api'
import type { Slug } from '@/types/document'

export function useDocument(slug: Slug | undefined) {
  return useQuery<DocumentResult>({
    queryKey: ['document', slug],
    queryFn: () => {
      if (!slug) throw new Error('slug is required')
      return getDocument(slug)
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  })
}
