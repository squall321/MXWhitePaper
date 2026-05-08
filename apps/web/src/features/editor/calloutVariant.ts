import type { CalloutBlock } from '@/types/document'

/** Cycle order used by the variant chip in CalloutBlockView. */
export const CALLOUT_VARIANTS: ReadonlyArray<CalloutBlock['variant']> = [
  'info',
  'warn',
  'danger',
  'tip',
]

/** Korean label per variant — matches the labels in CalloutBlockView. */
export const CALLOUT_LABEL: Record<CalloutBlock['variant'], string> = {
  info: '정보',
  warn: '주의',
  danger: '경고',
  tip: '팁',
}

/**
 * Pure cycle: returns the NEXT variant after `current`. Wraps from the last
 * back to the first. Unknown inputs fall through to 'info' so the UI never
 * gets stuck on a bogus value.
 */
export function nextCalloutVariant(
  current: CalloutBlock['variant'],
): CalloutBlock['variant'] {
  const idx = CALLOUT_VARIANTS.indexOf(current)
  if (idx < 0) return 'info'
  return CALLOUT_VARIANTS[(idx + 1) % CALLOUT_VARIANTS.length] ?? 'info'
}
