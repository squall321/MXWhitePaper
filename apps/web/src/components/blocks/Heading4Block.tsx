import type { Heading4Block } from '@/types/document'

/**
 * Heading-4 block — sub-section heading rendered inside any section. NOT
 * surfaced in the TOC (TOC walks Section nodes only).
 *
 * Visual level is driven by `block.level` (2 / 3 / 4). Older fixtures stored
 * the same value at `block.meta.level` — we read both so legacy docs keep
 * their look while new inserts use the canonical top-level field. Defaults
 * to 4 (small) when neither is set.
 *
 * HD4-02 — outline safety: semantic element is *always* `<h4>` so the
 * surrounding section's h1/h2/h3 outline is not interrupted. `block.level`
 * still drives the *visual* size only (className). Prior to this fix, a
 * level=2 inline heading would emit a real `<h2>`, polluting the document
 * outline that screen readers walk.
 */
export function Heading4BlockView({ block }: { block: Heading4Block }) {
  const legacy = (block.meta as { level?: number } | undefined)?.level
  const lvl = block.level ?? legacy ?? 4
  const sizeClass =
    lvl === 2
      ? 'text-2xl'
      : lvl === 3
        ? 'text-xl'
        : 'text-base'
  return (
    <h4
      data-heading4-visual-level={lvl}
      className={`mt-4 font-semibold text-smsg-900 dark:text-gray-100 ${sizeClass}`}
    >
      {block.title}
    </h4>
  )
}
