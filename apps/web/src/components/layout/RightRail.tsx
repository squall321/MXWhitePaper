import type { DocumentJSONV10, GlossaryItem } from '@/types/document'
import { TableOfContents } from '../TableOfContents'
import { RelatedDocs } from '../RelatedDocs'
import { Backlinks } from '../Backlinks'

interface RightRailProps {
  document: DocumentJSONV10
}

/**
 * Composes the right-column components: TOC + RelatedDocs + Backlinks +
 * Glossary. Glossary is rendered inline (small enough to belong here in
 * Sprints 2/3 — moves to its own page in Sprint 4 if the list grows).
 */
export function RightRail({ document }: RightRailProps) {
  return (
    <div className="space-y-2 py-3">
      <TableOfContents document={document} />
      {document.related_documents && document.related_documents.length > 0 && (
        <RelatedDocs items={document.related_documents} />
      )}
      <Backlinks slug={document.slug} />
      {document.glossary && document.glossary.length > 0 && (
        <GlossaryPanel items={document.glossary} />
      )}
    </div>
  )
}

function GlossaryPanel({ items }: { items: GlossaryItem[] }) {
  return (
    <section aria-label="용어집" className="mt-6 px-3">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        용어
      </h3>
      <dl className="space-y-2 text-sm">
        {items.map((g) => (
          <div key={g.term}>
            <dt className="font-semibold text-smsg-900">{g.term}</dt>
            <dd className="text-xs text-gray-600">{g.definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
