import type { Block } from '@/types/document'

/**
 * Render a "not implemented yet" placeholder for blocks whose UI lands in a
 * later sprint. Includes a `<details>` with the raw JSON so reviewers can
 * verify the data is still flowing through.
 */
export function PlaceholderBlockView({
  block,
  sprint,
}: {
  block: Block
  sprint: string
}) {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          {block.type}
        </p>
        <span className="rounded bg-smsg-100 px-2 py-0.5 text-[11px] font-medium text-smsg-700">
          {sprint}
        </span>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-gray-500">
          raw JSON
        </summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed text-gray-700">
          {JSON.stringify(block, null, 2)}
        </pre>
      </details>
    </div>
  )
}
