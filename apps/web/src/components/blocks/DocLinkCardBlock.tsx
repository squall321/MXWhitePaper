import { Link } from 'react-router-dom'
import type { DocLinkCardBlock } from '@/types/document'
import { useDocument } from '@/features/document/hooks/useDocument'
import { Skeleton } from '@/components/ui/Skeleton'
import { useT } from '@/lib/i18n'

/**
 * Doc-link card. Lazily fetches `/documents/:slug` via TanStack Query and
 * shows a card with title + (optional) summary. 404 → red "missing" state.
 */
export function DocLinkCardBlockView({ block }: { block: DocLinkCardBlock }) {
  const t = useT()
  const { data, isPending, isError } = useDocument(block.slug)

  if (isPending) {
    return (
      <div className="space-y-2 rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900" aria-busy="true">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-full" />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        {t('block.docLink.missing')}: <code>{block.slug}</code>
      </div>
    )
  }
  const showSummary = block.showSummary !== false
  return (
    <Link
      to={`/docs/${encodeURIComponent(block.slug)}`}
      className="block rounded border border-gray-200 bg-white p-3 hover:border-smsg-500 dark:border-gray-700 dark:bg-gray-900"
    >
      <p className="text-sm font-semibold text-smsg-900 dark:text-gray-100">{data.document.title}</p>
      {showSummary && data.document.summary && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{data.document.summary}</p>
      )}
      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">/{block.slug}</p>
    </Link>
  )
}
