import type { Block } from '@/types/document'

export type AudienceView = 'wiki' | 'slide'

/**
 * Drop blocks whose `meta.audience` excludes the current view.
 *
 *   audience='both'        → kept everywhere (default)
 *   audience='wiki-only'   → hidden in slide view
 *   audience='slide-only'  → hidden in wiki view
 *
 * Speaker notes are handled separately by `splitSpeakerNotes` so this
 * helper is purely about the explicit audience opt-in.
 */
export function filterForAudience<T extends Block>(
  blocks: readonly T[],
  view: AudienceView,
): T[] {
  return blocks.filter((b) => {
    const a = b.meta?.audience
    if (!a || a === 'both') return true
    if (view === 'slide') return a !== 'wiki-only'
    return a !== 'slide-only'
  })
}
