import type { DocumentJSONV10, GlossaryItem } from '@/types/document'
import { TableOfContents } from '../TableOfContents'
import { RelatedDocs } from '../RelatedDocs'
import { Backlinks } from '../Backlinks'
import { RailBoundary } from '../blocks/BlockBoundary'

interface RightRailProps {
  document: DocumentJSONV10
}

/**
 * Composes the right-column components: TOC + RelatedDocs + Backlinks +
 * Glossary. Glossary is rendered inline (small enough to belong here in
 * Sprints 2/3 — moves to its own page in Sprint 4 if the list grows).
 *
 * Each panel is wrapped in `<RailBoundary>` (Hardening C) so one panel
 * failing won't take the whole rail (and the page) down.
 */
export function RightRail({ document }: RightRailProps) {
  if (!document) return null
  const related = Array.isArray(document.related_documents)
    ? document.related_documents
    : []
  const glossary = Array.isArray(document.glossary) ? document.glossary : []

  return (
    <div className="space-y-2 py-3" data-testid="right-rail-toc">
      <RailBoundary name="목차">
        <TableOfContents document={document} />
      </RailBoundary>
      {related.length > 0 && (
        <RailBoundary name="관련 문서">
          <RelatedDocs items={related} />
        </RailBoundary>
      )}
      <RailBoundary name="백링크">
        <div data-testid="right-rail-backlinks">
          <Backlinks slug={document.slug} />
        </div>
      </RailBoundary>
      {glossary.length > 0 && (
        <RailBoundary name="용어집">
          <GlossaryPanel items={glossary} />
        </RailBoundary>
      )}
    </div>
  )
}

function GlossaryPanel({ items }: { items: GlossaryItem[] }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <section aria-label="용어집" className="mt-6 px-3">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        용어
      </h3>
      <dl className="space-y-2 text-sm">
        {items.map((g) => (
          <div key={g?.term ?? Math.random().toString(36)}>
            <dt className="font-semibold text-smsg-900">{g?.term ?? '(용어 없음)'}</dt>
            <dd className="text-xs text-gray-600">{g?.definition ?? ''}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
