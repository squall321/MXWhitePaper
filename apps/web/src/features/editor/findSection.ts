import type { Block, DocumentJSONV10, Ulid } from '@/types/document'
import type { Section } from '@/components/SectionRenderer'

/**
 * Walk the section tree and find the section that directly contains the
 * block with the given id. Returns null if no section owns it (the block
 * was deleted, or the document is loading).
 *
 * Used by features that need a `section_id` to call `insertBlock` — e.g.
 * inserting a chart next to its source table.
 */
export function findParentSection(
  doc: DocumentJSONV10 | null,
  blockId: Ulid,
): Section | null {
  if (!doc) return null
  const stack: Section[] = [...doc.sections]
  while (stack.length > 0) {
    const s = stack.pop()
    if (!s) continue
    if (containsBlock(s.blocks, blockId)) return s
    if ('subsections' in s && s.subsections) {
      stack.push(...(s.subsections as Section[]))
    }
  }
  return null
}

function containsBlock(blocks: Block[], id: Ulid): boolean {
  for (const b of blocks) {
    if (b.id === id) return true
  }
  return false
}
