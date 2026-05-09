/**
 * PresenceAvatars — small "avatar stack" rendered next to the article title.
 *
 * Each circle shows the user's first character; tooltip says
 * "{name}님이 보고 있습니다". Click → scroll to that user's anchor block id
 * if we know one.
 *
 * The stack tops out at 5 avatars; overflow becomes a "+N" badge.
 */
import { usePresence } from './usePresence'
import type { PresenceUser } from './api'

const MAX_VISIBLE = 5

export interface PresenceAvatarsProps {
  slug: string | undefined
}

function initial(name: string): string {
  if (!name) return '?'
  // Strip wrapping whitespace; fall back to '?' if zero-length after.
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // Use the first non-whitespace character. Works for Hangul / English alike.
  return trimmed.charAt(0).toUpperCase()
}

function avatarColor(seed: string): string {
  // Stable hash → small palette. Keeps colors deterministic per user_id.
  let h = 0
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0
  }
  const hues = [
    'bg-emerald-100 text-emerald-800',
    'bg-sky-100 text-sky-800',
    'bg-amber-100 text-amber-800',
    'bg-rose-100 text-rose-800',
    'bg-violet-100 text-violet-800',
    'bg-teal-100 text-teal-800',
  ]
  return hues[Math.abs(h) % hues.length]!
}

function scrollToAnchor(blockId: string | null) {
  if (!blockId || typeof document === 'undefined') return
  const el = document.querySelector(`[data-block-id="${blockId}"]`)
  if (el && 'scrollIntoView' in el) {
    ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function Avatar({ user }: { user: PresenceUser }) {
  const tooltip = `${user.name || '익명'}님이 보고 있습니다`
  return (
    <button
      type="button"
      onClick={() => scrollToAnchor(user.anchor_block_id)}
      title={tooltip}
      aria-label={tooltip}
      data-testid={`presence-avatar-${user.user_id}`}
      data-anchor-block-id={user.anchor_block_id ?? ''}
      className={`-ml-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold ring-1 ring-gray-200 transition hover:scale-105 ${avatarColor(
        user.user_id,
      )}`}
    >
      {initial(user.name)}
    </button>
  )
}

export function PresenceAvatars({ slug }: PresenceAvatarsProps) {
  const { others } = usePresence(slug)
  if (!others || others.length === 0) return null

  const visible = others.slice(0, MAX_VISIBLE)
  const overflow = Math.max(0, others.length - MAX_VISIBLE)

  return (
    <div
      className="flex items-center pl-1"
      data-testid="presence-avatars"
      aria-label={`${others.length}명이 함께 보고 있습니다`}
    >
      {visible.map((u) => (
        <Avatar key={u.user_id} user={u} />
      ))}
      {overflow > 0 && (
        <span
          data-testid="presence-overflow"
          className="-ml-1 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full border-2 border-white bg-gray-100 px-1 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200"
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}
