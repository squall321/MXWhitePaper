import type { Heading4Block } from '@/types/document'

/**
 * Heading-4 block — sub-section heading rendered inside any section. NOT
 * surfaced in the TOC (TOC walks Section nodes only).
 *
 * Visual level is driven by `block.level` (2 / 3 / 4). Older fixtures stored
 * the same value at `block.meta.level` — we read both so legacy docs keep
 * their look while new inserts use the canonical top-level field. Defaults
 * to 4 (small) when neither is set.
 */
export function Heading4BlockView({ block }: { block: Heading4Block }) {
  const legacy = (block.meta as { level?: number } | undefined)?.level
  const lvl = block.level ?? legacy ?? 4
  if (lvl === 2) {
    return (
      <h2 className="mt-4 text-2xl font-semibold text-smsg-900">{block.title}</h2>
    )
  }
  if (lvl === 3) {
    return (
      <h3 className="mt-4 text-xl font-semibold text-smsg-900">{block.title}</h3>
    )
  }
  return (
    <h4 className="mt-4 text-base font-semibold text-smsg-900">{block.title}</h4>
  )
}
