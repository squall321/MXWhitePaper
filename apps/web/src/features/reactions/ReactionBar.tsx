/**
 * ReactionBar — five emoji toggle buttons + count badges (Cycle 0021).
 *
 * Used in two places:
 *   - Doc bottom (WikiArticle): omit `blockId` → doc-level reactions.
 *   - Per-block (BlockRenderer sibling): pass `blockId` → block-level.
 *
 * Counts come from `useReactionAggregate(slug)`; the user's own state comes
 * from `useMyReactions(slug)`. Both hooks are slug-scoped and shared across
 * every ReactionBar on the page (one fetch per slug).
 */
import { useMemo } from 'react'
import {
  EMOJI_CODES,
  EMOJI_GLYPHS,
  type EmojiCode,
} from './api'
import {
  useMyReactions,
  useReactionAggregate,
  useToggleReaction,
} from './hooks'

interface ReactionBarProps {
  /** Doc slug — used for cache keys + aggregate fetch. */
  slug: string
  /** Doc id — needed for the toggle POST body (BE accepts slug too, but id is canonical). */
  documentId?: string
  /** Block ULID. Omit for doc-level reactions. */
  blockId?: string
  /** Visual variant — `compact` for per-block overlays. */
  variant?: 'default' | 'compact'
  className?: string
  /** When true, hide buttons that have zero count AND the user hasn't reacted with. */
  collapseEmpty?: boolean
}

export function ReactionBar({
  slug,
  documentId,
  blockId,
  variant = 'default',
  className,
  collapseEmpty = false,
}: ReactionBarProps) {
  const aggQ = useReactionAggregate(slug)
  const meQ = useMyReactions(slug)
  const toggle = useToggleReaction(slug)

  const counts = useMemo<Partial<Record<EmojiCode, number>>>(() => {
    const agg = aggQ.data
    if (!agg) return {}
    if (blockId) return agg.blocks[blockId] ?? {}
    return agg.doc ?? {}
  }, [aggQ.data, blockId])

  const myEmojis = useMemo<Set<EmojiCode>>(() => {
    const me = meQ.data
    if (!me) return new Set()
    if (blockId) return new Set((me.blocks[blockId] ?? []) as EmojiCode[])
    return new Set(me.doc as EmojiCode[])
  }, [meQ.data, blockId])

  const onClick = (emoji: EmojiCode) => {
    if (!documentId && !slug) return
    toggle.mutate({
      // BE accepts slug-or-uuid; pass the id when we have it for clarity.
      document_id: documentId ?? slug,
      block_id: blockId ?? null,
      emoji,
    })
  }

  const compact = variant === 'compact'
  const baseBtn = compact
    ? 'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors'
    : 'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition-colors'

  return (
    <div
      role="group"
      aria-label="이모지 반응"
      data-testid={blockId ? `reaction-bar-block-${blockId}` : 'reaction-bar-doc'}
      data-block-id={blockId ?? ''}
      className={[
        compact
          ? 'inline-flex flex-wrap items-center gap-1'
          : 'flex flex-wrap items-center gap-1.5',
        className ?? '',
      ].join(' ')}
    >
      {EMOJI_CODES.map((emoji) => {
        const count = counts[emoji] ?? 0
        const reacted = myEmojis.has(emoji)
        if (collapseEmpty && count === 0 && !reacted) return null
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={reacted}
            aria-label={`${EMOJI_GLYPHS[emoji]} ${count}`}
            data-testid={`reaction-${emoji}`}
            data-reacted={reacted ? 'true' : 'false'}
            data-count={count}
            disabled={toggle.isPending}
            onClick={() => onClick(emoji)}
            className={[
              baseBtn,
              reacted
                ? 'border-smsg-700 bg-smsg-50 text-smsg-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-smsg-700 hover:text-smsg-700',
              toggle.isPending ? 'cursor-wait opacity-70' : 'cursor-pointer',
            ].join(' ')}
          >
            <span aria-hidden="true">{EMOJI_GLYPHS[emoji]}</span>
            {count > 0 && (
              <span
                data-testid={`reaction-count-${emoji}`}
                className={compact ? 'tabular-nums' : 'tabular-nums font-medium'}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
