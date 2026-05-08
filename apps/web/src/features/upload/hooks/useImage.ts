import { useQuery } from '@tanstack/react-query'
import { getImage, type ImageRecord } from '../api'

/**
 * Look up an image record by id, cached forever-ish (5 min). Components keep
 * the call site tiny: `const { data } = useImage(block.imageId)`.
 */
export function useImage(imageId: string | undefined) {
  return useQuery<ImageRecord>({
    queryKey: ['image', imageId],
    queryFn: () => {
      if (!imageId) throw new Error('imageId required')
      return getImage(imageId)
    },
    enabled: Boolean(imageId),
    // Image URLs are immutable per id, so we can cache aggressively.
    staleTime: 5 * 60_000,
  })
}
