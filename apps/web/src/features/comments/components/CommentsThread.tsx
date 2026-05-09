/**
 * Threaded comments rail — depth cap 3 + @-mentions + resolve.
 *
 * The component prefers the BE-built `tree` (already capped at depth 3) but
 * falls back to a client-side build for old responses. Soft-deleted comments
 * are hidden from non-admins; admins still see them with strike-through.
 *
 * Resolve is a thread-level action: clicking on any comment in a thread
 * toggles the root comment's status to 'resolved', and the BE recursively
 * marks the entire thread.
 */
import { Fragment, useMemo, useState } from 'react'
import { useAuthStore } from '@/features/auth/store'
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  usePatchComment,
  useResolveThread,
} from '../hooks/useComments'
import type { Comment, CommentNode } from '../api'
import { MentionInput } from './MentionInput'

interface CommentsThreadProps {
  slug: string
  /** When set, scopes the input form to that anchor; otherwise the form
   *  attaches to the whole document. */
  scopedAnchor?: { kind: 'section' | 'block'; id: string } | null
}

const MAX_DEPTH = 3

function buildTreeClient(items: Comment[]): CommentNode[] {
  const byId = new Map<string, CommentNode>()
  for (const c of items) byId.set(c.id, { ...c, replies: [] })
  const roots: CommentNode[] = []
  for (const c of items) {
    const node = byId.get(c.id)!
    if (c.parent_id && byId.has(c.parent_id)) {
      byId.get(c.parent_id)!.replies.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

export function CommentsThread({ slug, scopedAnchor }: CommentsThreadProps) {
  const { data, isPending, isError, error } = useComments(slug)
  const create = useCreateComment(slug)
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [body, setBody] = useState('')
  const [mentionUserIds, setMentionUserIds] = useState<string[]>([])
  const [replyTo, setReplyTo] = useState<string | null>(null)

  const items = useMemo(() => {
    const all = data?.items ?? []
    if (!scopedAnchor) return all
    return all.filter(
      (c) => c.anchor_kind === scopedAnchor.kind && c.anchor_id === scopedAnchor.id,
    )
  }, [data, scopedAnchor])

  const visible = useMemo(
    () => (isAdmin ? items : items.filter((c) => c.status !== 'deleted')),
    [items, isAdmin],
  )

  // Prefer BE tree (already capped); fall back to client build for older
  // responses. Filter the BE tree to the same scoped anchor when set.
  const tree = useMemo<CommentNode[]>(() => {
    const beTree = data?.tree
    if (Array.isArray(beTree)) {
      const filtered = scopedAnchor
        ? beTree.filter(
            (n) =>
              n.anchor_kind === scopedAnchor.kind && n.anchor_id === scopedAnchor.id,
          )
        : beTree
      // Hide deleted root threads for non-admins (replies follow root).
      return isAdmin ? filtered : filtered.filter((n) => n.status !== 'deleted')
    }
    return buildTreeClient(visible)
  }, [data, scopedAnchor, visible, isAdmin])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    await create.mutateAsync({
      anchor_kind: scopedAnchor?.kind ?? 'document',
      anchor_id: scopedAnchor?.id ?? null,
      body_md: body.trim(),
      parent_id: replyTo,
      mention_user_ids: mentionUserIds,
    })
    setBody('')
    setMentionUserIds([])
    setReplyTo(null)
  }

  const totalCount = visible.length

  return (
    <section
      aria-label="댓글"
      data-testid="comments-thread"
      className="mt-6 px-3"
    >
      <header className="flex items-center justify-between pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          댓글
        </h3>
        <span
          data-testid="comments-count"
          className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600"
        >
          {totalCount}
        </span>
      </header>

      {isPending ? (
        <p className="text-xs text-gray-400">불러오는 중…</p>
      ) : isError ? (
        <p className="text-xs text-red-600">{(error as Error).message}</p>
      ) : tree.length === 0 ? (
        <p className="text-xs text-gray-400">아직 댓글이 없습니다.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {tree.map((node) => (
            <CommentRow
              key={node.id}
              node={node}
              slug={slug}
              currentUserId={user?.id ?? null}
              isAdmin={isAdmin}
              onReply={(id) => setReplyTo(id)}
              depth={0}
              rootId={node.id}
              rootStatus={node.status}
            />
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="mt-3 space-y-1.5">
        {replyTo && (
          <p className="text-[11px] text-gray-500">
            답글 작성 중 ·{' '}
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="text-link hover:underline"
            >
              취소
            </button>
          </p>
        )}
        <MentionInput
          aria-label="댓글 입력"
          value={body}
          onChange={(v, ids) => {
            setBody(v)
            setMentionUserIds(ids)
          }}
          mentionUserIds={mentionUserIds}
          rows={3}
          placeholder={
            scopedAnchor
              ? `이 ${scopedAnchor.kind === 'section' ? '섹션' : '블록'}에 댓글… (@로 멘션)`
              : '댓글을 입력하세요… (@로 멘션)'
          }
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none"
        />
        <div className="flex items-center justify-between">
          {mentionUserIds.length > 0 ? (
            <p className="text-[11px] text-gray-500">
              멘션 {mentionUserIds.length}명
            </p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={create.isPending || !body.trim()}
            className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-50"
          >
            {create.isPending ? '작성 중…' : '작성'}
          </button>
        </div>
      </form>
    </section>
  )
}

interface CommentRowProps {
  node: CommentNode
  slug: string
  currentUserId: string | null
  isAdmin: boolean
  onReply: (id: string) => void
  depth: number
  rootId: string
  rootStatus: string
}

function CommentRow({
  node,
  slug,
  currentUserId,
  isAdmin,
  onReply,
  depth,
  rootId,
  rootStatus,
}: CommentRowProps) {
  const patch = usePatchComment(slug)
  const remove = useDeleteComment(slug)
  const resolve = useResolveThread(slug)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.body_md)

  const isAuthor = currentUserId !== null && currentUserId === node.author_id
  const canMutate = isAuthor || isAdmin
  const isDeleted = node.status === 'deleted'
  const isResolved = rootStatus === 'resolved'
  const showResolveButton = depth === 0

  return (
    <li
      data-testid="comment-row"
      data-depth={depth}
      data-resolved={isResolved ? 'true' : undefined}
      style={{ marginLeft: depth > 0 ? Math.min(depth, MAX_DEPTH - 1) * 12 : 0 }}
      className={`rounded border bg-white p-2 ${
        isResolved ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200'
      } ${isDeleted ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span className="font-medium text-smsg-900">
          {node.author_name ?? node.author_email ?? '(unknown)'}
        </span>
        <span className="flex items-center gap-1.5">
          {isResolved && depth === 0 && (
            <span className="rounded-full bg-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
              해결됨
            </span>
          )}
          <time dateTime={node.created_at ?? undefined}>
            {node.created_at ? new Date(node.created_at).toLocaleString() : ''}
          </time>
        </span>
      </div>
      {editing ? (
        <div className="mt-1 space-y-1">
          <textarea
            aria-label="댓글 수정"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setDraft(node.body_md)
              }}
              className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              disabled={patch.isPending || !draft.trim()}
              onClick={async () => {
                await patch.mutateAsync({ id: node.id, body: { body_md: draft.trim() } })
                setEditing(false)
              }}
              className="rounded bg-smsg-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-smsg-900 disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      ) : (
        <CommentBody body={node.body_md} isDeleted={isDeleted} />
      )}
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        {!isDeleted && depth < MAX_DEPTH - 1 && (
          <button
            type="button"
            data-testid="comment-reply"
            onClick={() => onReply(node.id)}
            className="text-link hover:underline"
          >
            답글
          </button>
        )}
        {showResolveButton && !isDeleted && (
          <button
            type="button"
            data-testid="comment-resolve"
            disabled={resolve.isPending}
            onClick={() =>
              void resolve.mutateAsync({ id: rootId, resolved: !isResolved })
            }
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
              isResolved
                ? 'border-emerald-400 bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {isResolved ? '재오픈' : '해결'}
          </button>
        )}
        {canMutate && !isDeleted && !editing && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-gray-500 hover:underline"
            >
              수정
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('댓글을 삭제하시겠습니까?')) {
                  void remove.mutateAsync(node.id)
                }
              }}
              className="text-red-600 hover:underline"
            >
              삭제
            </button>
          </>
        )}
      </div>
      {node.replies && node.replies.length > 0 && depth + 1 < MAX_DEPTH && (
        <ul className="mt-2 space-y-1.5">
          {node.replies.map((child) => (
            <CommentRow
              key={child.id}
              node={child}
              slug={slug}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onReply={onReply}
              depth={depth + 1}
              rootId={rootId}
              rootStatus={rootStatus}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Render comment body with @-mentions as colored chips. */
function CommentBody({ body, isDeleted }: { body: string; isDeleted: boolean }) {
  if (isDeleted) {
    return (
      <p className="mt-1 italic line-through text-gray-400">(삭제됨)</p>
    )
  }
  // Split on `@<token>` where token is non-space/non-@.
  const parts = body.split(/(@[^\s@]+)/g)
  return (
    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
      {parts.map((p, i) => {
        if (p.startsWith('@') && p.length > 1) {
          return (
            <span
              key={i}
              data-testid="mention-chip"
              className="mx-0.5 rounded-full bg-smsg-100 px-1.5 py-0.5 text-[12px] font-medium text-smsg-900"
            >
              {p}
            </span>
          )
        }
        return <Fragment key={i}>{p}</Fragment>
      })}
    </p>
  )
}
