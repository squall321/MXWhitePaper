/**
 * Reactions API client (Cycle 0021).
 *
 * Mirrors `apps/api/app/routers/reactions.py`. Lightweight social signals
 * separate from the comments thread.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export const EMOJI_CODES = [
  'thumbs-up',
  'heart',
  'thinking',
  'pray',
  'tada',
] as const
export type EmojiCode = (typeof EMOJI_CODES)[number]

/** UI-facing glyphs for each code. Mirrors the mandate spec. */
export const EMOJI_GLYPHS: Record<EmojiCode, string> = {
  'thumbs-up': '👍',
  heart: '❤️',
  thinking: '🤔',
  pray: '🙏',
  tada: '🎉',
}

export interface ReactionAggregate {
  /** doc-level counts: emoji → count. */
  doc: Partial<Record<EmojiCode, number>>
  /** per-block counts: blockId → emoji → count. */
  blocks: Record<string, Partial<Record<EmojiCode, number>>>
}

export interface MyReactions {
  /** doc-level emojis the user has reacted with. */
  doc: EmojiCode[]
  /** per-block emojis the user has reacted with. */
  blocks: Record<string, EmojiCode[]>
}

export interface ToggleReactionInput {
  document_id: string
  block_id?: string | null
  emoji: EmojiCode
}

export interface ToggleReactionResult {
  removed: boolean
  id: string
  document_id: string
  block_id: string | null
  emoji: EmojiCode
  created_at?: string | null
}

export async function toggleReaction(
  body: ToggleReactionInput,
): Promise<ToggleReactionResult> {
  const res = await apiClient.post<ApiEnvelope<ToggleReactionResult>>(
    '/reactions',
    body,
  )
  return unwrap<ToggleReactionResult>(res)
}

export async function getReactionAggregate(
  slug: string,
): Promise<ReactionAggregate> {
  const res = await apiClient.get<ApiEnvelope<ReactionAggregate>>(
    `/documents/${encodeURIComponent(slug)}/reactions`,
  )
  return unwrap<ReactionAggregate>(res)
}

export async function getMyReactions(slug: string): Promise<MyReactions> {
  const res = await apiClient.get<ApiEnvelope<MyReactions>>(
    `/me/reactions/${encodeURIComponent(slug)}`,
  )
  return unwrap<MyReactions>(res)
}
