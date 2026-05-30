/**
 * Zebra-striping utility for row-based blocks. Pulled out as a pure
 * function so we can unit-test the row-coloring rule without mounting
 * any UI.
 *
 * Contract:
 *   - `stripe` defaults to ON. Only an explicit `stripe: false` disables.
 *   - Header row (when applicable) is *not* coloured by this util; callers
 *     pass the data-row index, starting at 0 = first data row.
 *   - Data rows at odd indices (1, 3, 5…) get the stripe class.
 *
 * Block-type colour tokens (one per `ZebraBlockType`):
 *   - `table` / `list` / `bibliography` / `figure-index` reuse gray-50.
 *   - `spreadsheet` / `kpi-cards` use the paler blue (`var(--smsg-blue-050)`)
 *     to visually mark data-card / numeric-grid surfaces. Both tokens
 *     have dark-mode variants wired in `tokens.css`, so this util is
 *     theme-agnostic.
 */

export type ZebraOpts = { stripe?: boolean }
export type ZebraBlockType =
  | 'table'
  | 'spreadsheet'
  | 'list'
  | 'kpi-cards'
  | 'bibliography'
  | 'figure-index'
  | 'gantt'

const STRIPE_CLASSES: Record<ZebraBlockType, string> = {
  table: 'bg-gray-50 dark:bg-gray-800',
  spreadsheet: 'bg-[var(--smsg-blue-050)]',
  list: 'bg-gray-50 dark:bg-gray-800',
  'kpi-cards': 'bg-[var(--smsg-blue-050)]',
  bibliography: 'bg-gray-50 dark:bg-gray-800',
  'figure-index': 'bg-gray-50 dark:bg-gray-800',
  // gantt is an SVG block — its rows are painted via inline `<rect
  // fill="var(--smsg-gray-050)">` (token reference so darkmode resolves
  // through `.dark`), not a className. The entry below exists so
  // ZebraToggle and the exhaustive type check accept blockType="gantt";
  // the value is intentionally unused by GanttBlockView.
  gantt: 'bg-gray-50',
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
