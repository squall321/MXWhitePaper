/**
 * Pure formatters used by the activity feed UI. Kept module-local so the
 * widget + page + tests share one source of truth and so we don't reimport
 * RecentRail's relative-time helper (which is tied to its own component).
 */
import type { ActivityKind } from './api'

/**
 * Korean-friendly relative time. `now` is injected so tests can pin it.
 * Returns '' for non-finite / unparseable inputs.
 */
export function formatRelative(
  ts: string | number | null | undefined,
  now: number = Date.now(),
): string {
  if (ts == null) return ''
  const t =
    typeof ts === 'number' ? ts : Date.parse(String(ts))
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '방금 전'
  if (diff < hour) return `${Math.floor(diff / min)}분 전`
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`
  if (diff < 2 * day) return '어제'
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`
  try {
    return new Date(t).toLocaleDateString('ko-KR', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    })
  } catch {
    return ''
  }
}

/** Two-letter avatar fallback. Defensive against empty / non-string names. */
export function initialsFor(name: string | null | undefined): string {
  const safe = (name ?? '').trim()
  if (!safe) return '?'
  // Korean name: take first character. Latin: take first letter of two words.
  const parts = safe.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  return safe.slice(0, 1).toUpperCase()
}

/** Stable color from a string key — same palette as Home cards. */
const PALETTE = [
  '#1428A0',
  '#2E5BFF',
  '#5C7CFF',
  '#0A1F8F',
  '#10B981',
  '#F59E0B',
] as const

export function colorForKey(key: string): string {
  if (!key) return PALETTE[0]
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

/**
 * Map the chip filter (전체 / 내 활동 / 댓글 / 편집 / 승인) to the BE
 * `?kind=` value. `me` is handled by switching endpoints, so we return null.
 */
export type ChipKey = 'all' | 'mine' | 'comments' | 'edits' | 'approvals'

export const CHIP_OPTIONS: Array<{ key: ChipKey; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'mine', label: '내 활동' },
  { key: 'comments', label: '댓글' },
  { key: 'edits', label: '편집' },
  { key: 'approvals', label: '승인' },
]

export function kindsForChip(chip: ChipKey): ActivityKind[] | null {
  if (chip === 'all' || chip === 'mine') return null
  if (chip === 'comments') return ['comment_added']
  if (chip === 'edits') return ['doc_edited', 'doc_created']
  if (chip === 'approvals') return ['review_requested', 'review_decided']
  return null
}
