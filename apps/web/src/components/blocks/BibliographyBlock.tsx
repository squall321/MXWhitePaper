import type { BibliographyBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'

/**
 * Read-mode renderer for a `bibliography` block — a numbered list of
 * references. Each entry sits at `id="cite-KEY"` (when `key` is set) so
 * inline `[[cite:KEY]]` anchors elsewhere in the document can scroll to
 * it. Without a key the entry still renders, just without an anchor.
 *
 * The list is intentionally simple and styleless — the same data should
 * round-trip back to DOCX as a flat paragraph block, and complicated
 * markup (numbered prefixes, hanging indents) lives in the BE export
 * pipeline rather than the FE.
 */
export function BibliographyBlockView({ block }: { block: BibliographyBlock }) {
  const heading = block.title ?? '참고문헌'
  return (
    <section
      data-bibliography-block
      data-block-id={block.id}
      className="my-4 border-t border-smsg-100 pt-3 text-sm text-smsg-900"
      aria-label={heading}
    >
      <h3 className="mb-2 text-base font-semibold text-smsg-900">{heading}</h3>
      <ol className="list-none space-y-1 pl-0">
        {block.entries.map((entry, idx) => (
          <li
            key={idx}
            id={entry.key ? `cite-${entry.key}` : undefined}
            className="leading-6"
          >
            <span className="mr-2 font-mono text-xs text-gray-500">
              [{idx + 1}]
            </span>
            <Inline text={entry.text} />
            {entry.url && (
              <>
                {' '}
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link hover:underline"
                >
                  {entry.url}
                </a>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
