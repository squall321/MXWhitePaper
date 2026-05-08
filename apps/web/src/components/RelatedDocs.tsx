import type { RelatedDoc } from '@/types/document'
import { WikiLink } from './wiki/WikiLink'

interface RelatedDocsProps {
  items: RelatedDoc[]
}

/**
 * Right-rail list of related documents. Each card uses `<WikiLink>` so a
 * missing target shows up red, matching inline references inside the body.
 */
export function RelatedDocs({ items }: RelatedDocsProps) {
  if (!items || items.length === 0) return null
  return (
    <section aria-label="관련 문서" className="mt-6 px-3">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        관련 문서
      </h3>
      <ul className="space-y-2 text-sm">
        {items.map((it) => (
          <li
            key={it.slug}
            className="rounded border border-gray-200 bg-white p-2 hover:border-smsg-500"
          >
            <p className="text-[11px] uppercase tracking-wide text-gray-500">
              {it.relation}
            </p>
            <WikiLink slug={it.slug} />
          </li>
        ))}
      </ul>
    </section>
  )
}
