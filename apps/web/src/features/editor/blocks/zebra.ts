/**
 * Zebra-striping utility for table/spreadsheet editor (and views that share
 * the same row-class contract). Pulled out as a pure function so we can
 * unit-test the row-coloring rule without mounting any UI.
 *
 * Contract:
 *   - `stripe` defaults to ON. Only an explicit `stripe: false` disables.
 *   - Header row is *not* coloured by this util (callers pass the data-row
 *     index, starting at 0 = first data row).
 *   - Data rows at odd indices (1, 3, 5…) get the stripe class.
 *
 * Block-type colour tokens:
 *   - `table` reuses the existing gray-50 background (= var(--smsg-gray-050)).
 *   - `spreadsheet` uses a paler blue (var(--smsg-blue-050)) to visually
 *     differentiate from regular tables. Both tokens have dark-mode variants
 *     wired in `tokens.css`, so this util is theme-agnostic.
 */

export type ZebraOpts = { stripe?: boolean }
export type ZebraBlockType = 'table' | 'spreadsheet'

const STRIPE_CLASSES: Record<ZebraBlockType, string> = {
  table: 'bg-gray-50',
  spreadsheet: 'bg-[var(--smsg-blue-050)]',
}

export function getZebraClass(
  blockType: ZebraBlockType,
  opts: ZebraOpts | undefined,
  rowIndex: number,
): string {
  const stripe = opts?.stripe !== false
  if (!stripe) return ''
  return rowIndex % 2 === 1 ? STRIPE_CLASSES[blockType] : ''
}
