import type { Heading4Block } from '@/types/document'

/**
 * Heading-4 block — sub-section heading rendered inside any section. NOT
 * surfaced in the TOC (TOC walks Section nodes only).
 *
 * Visual level is driven by `meta.level` (2 / 3 / 4). Defaults to 4 (small)
 * for backward compatibility — older docs without `meta.level` keep their
 * original look.
 */
export function Heading4BlockView({ block }: { block: Heading4Block }) {
  const lvl = block.meta?.level ?? 4
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
