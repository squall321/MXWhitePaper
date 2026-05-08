import type { ListBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'

/**
 * List block — bullet / number / check.  Check items render an inert
 * checkbox (read-only in Sprints 2/3; interactive flips arrive in Sprint 5).
 */
export function ListBlockView({ block }: { block: ListBlock }) {
  if (block.style === 'number') {
    return (
      <ol className="ml-6 list-decimal space-y-1 text-[15px] leading-7 text-smsg-900">
        {block.items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ol>
    )
  }
  if (block.style === 'check') {
    return (
      <ul className="space-y-1 text-[15px] leading-7 text-smsg-900">
        {block.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <input
              type="checkbox"
              disabled
              className="mt-1 h-4 w-4 rounded border-gray-300"
              aria-label={`체크 ${i + 1}`}
            />
            <span>
              <Inline text={item} />
            </span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul className="ml-6 list-disc space-y-1 text-[15px] leading-7 text-smsg-900">
      {block.items.map((item, i) => (
        <li key={i}>
          <Inline text={item} />
        </li>
      ))}
    </ul>
  )
}
