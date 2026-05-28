/**
 * Map a server-side notification (kind + payload) to a store-shaped item.
 *
 * BE INSERTs (`apps/api/app/routers/comments.py`, `approvals.py`,
 * `reactions.py`, `read_receipts.py`, plus `services/{reminder,digest,
 * retention,automation}_runner.py`) all use slightly different payload
 * keys; this normaliser is the single place that absorbs those differences.
 *
 * The mapper is defensive — payloads with missing keys still produce a
 * sensible Korean message instead of throwing. Display strings remain
 * compact so they fit one drawer row.
 */
import type { NotificationCategory, NotificationItem } from './store'
import type { NotificationServerItem } from './api'

/** Subset of `NotificationItem` we synthesise from a server row. */
export type StoreItemFromServer = Omit<
  NotificationItem,
  'createdAt' | 'read'
> & {
  createdAt: number
  read: boolean
}

const COMMENT_KINDS = new Set<string>(['comment_mention', 'comment_reply'])
const ACTIVITY_KINDS = new Set<string>([
  'review_request',
  'review_decision',
  'reaction_added',
  'read_ack_reminder',
  'reminder',
  'subscription_event',
  'subscription_digest',
])
const SYSTEM_KINDS = new Set<string>([
  'retention_warning',
  'automation_blast',
])

export function categoryForKind(kind: string): NotificationCategory {
  if (COMMENT_KINDS.has(kind)) return 'comment'
  if (ACTIVITY_KINDS.has(kind)) return 'activity'
  if (SYSTEM_KINDS.has(kind)) return 'system'
  return 'system'
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function readNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const v = payload[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Best-effort actor display string (name → email → "다른 사용자"). */
function actorLabel(payload: Record<string, unknown>): string {
  return (
    readString(payload, 'actor_name') ??
    readString(payload, 'actor') ??
    readString(payload, 'from_user_name') ??
    readString(payload, 'from_user_email') ??
    '다른 사용자'
  )
}

function docTitle(payload: Record<string, unknown>): string | undefined {
  return (
    readString(payload, 'doc_title') ??
    readString(payload, 'title') ??
    readString(payload, 'slug')
  )
}

function docSlug(payload: Record<string, unknown>): string | undefined {
  return (
    readString(payload, 'doc_slug') ??
    readString(payload, 'slug')
  )
}

export interface BuiltMessage {
  message: string
  detail?: string
}

export function buildMessage(
  kind: string,
  payload: Record<string, unknown>,
): BuiltMessage {
  const actor = actorLabel(payload)
  const title = docTitle(payload)
  const titleSuffix = title ? ` — ${title}` : ''

  switch (kind) {
    case 'comment_mention':
      return { message: `${actor} 님이 회원님을 언급했습니다${titleSuffix}` }

    case 'comment_reply':
      return { message: `${actor} 님이 댓글에 답글을 남겼습니다${titleSuffix}` }

    case 'review_request':
      return { message: `${actor} 님이 리뷰를 요청했습니다${titleSuffix}` }

    case 'review_decision': {
      const status = readString(payload, 'status') ?? readString(payload, 'decision')
      const decisionLabel = status ? decisionToKo(status) : '결정'
      return {
        message: `${actor} 님이 리뷰를 ${decisionLabel}했습니다${titleSuffix}`,
        detail: readString(payload, 'comment'),
      }
    }

    case 'reaction_added': {
      const emoji = readString(payload, 'emoji')
      const emojiLabel = emoji ? glyphFor(emoji) : '반응'
      return { message: `${actor} 님이 ${emojiLabel} 반응을 남겼습니다${titleSuffix}` }
    }

    case 'read_ack_reminder':
      return { message: `${actor} 님이 읽음 확인을 요청했습니다${titleSuffix}` }

    case 'reminder':
      return {
        message: `리마인더${titleSuffix}`,
        detail: readString(payload, 'message') ?? undefined,
      }

    case 'subscription_digest': {
      const count = readNumber(payload, 'item_count')
      const suffix = count != null ? ` ${count}건` : ''
      return { message: `구독 다이제스트${suffix}` }
    }

    case 'subscription_event':
      return { message: `구독한 문서에 새 활동이 있습니다${titleSuffix}` }

    case 'retention_warning':
      return {
        message: `보존 정책 알림${titleSuffix}`,
        detail: readString(payload, 'policy_name'),
      }

    case 'automation_blast':
      return {
        message:
          readString(payload, 'message') ??
          (((payload['payload'] as Record<string, unknown> | undefined) &&
            readString(payload['payload'] as Record<string, unknown>, 'message')) ||
            '자동화 알림'),
      }

    default:
      // 알 수 없는 kind 도 잃지 말고 보여준다.
      return { message: `새 알림${titleSuffix}` }
  }
}

function decisionToKo(status: string): string {
  if (status === 'approved') return '승인'
  if (status === 'rejected') return '반려'
  if (status === 'changes_requested') return '수정 요청'
  return status
}

function glyphFor(code: string): string {
  const map: Record<string, string> = {
    'thumbs-up': '👍',
    heart: '❤️',
    thinking: '🤔',
    pray: '🙏',
    tada: '🎉',
  }
  return map[code] ?? code
}

/** Convert a server row into the shape `notificationsStore.push()` consumes. */
export function serverItemToStoreItem(
  row: NotificationServerItem,
): StoreItemFromServer {
  const payload =
    row.payload && typeof row.payload === 'object' ? row.payload : {}
  const { message, detail } = buildMessage(row.kind, payload)
  const createdAt = parseTimestamp(row.created_at) ?? Date.now()
  return {
    id: row.id,
    message,
    detail,
    slug: docSlug(payload),
    category: categoryForKind(row.kind),
    createdAt,
    read: row.read_at != null,
  }
}

function parseTimestamp(raw: string | null): number | undefined {
  if (!raw) return undefined
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : undefined
}
