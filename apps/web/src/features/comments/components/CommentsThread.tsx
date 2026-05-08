/**
 * Comments rail — linear thread per document, grouped by anchor.
 *
 * Rendered inside `<RightRail>` when the user toggles "💬 댓글". Soft-deleted
 * comments are hidden from non-admins; admins still see them with a strike-
 * through to allow restoration.
 */
import { useMemo, useState } from 'react'
import { useAuthStore } from '@/features/auth/store'
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  usePatchComment,
} from '../hooks/useComments'
import type { Comment } from '../api'

interface CommentsThreadProps {
  slug: string
  /** When set, scopes the input form to that anchor; otherwise the form
   *  attaches to the whole document. */
  scopedAnchor?: { kind: 'section' | 'block'; id: string } | null
}

interface ThreadNode extends Comment {
  children: ThreadNode[]
}

function buildTree(items: Comment[]): ThreadNode[] {
  const byId = new Map<string, ThreadNode>()
  for (const c of items) byId.set(c.id, { ...c, children: [] })
  const roots: ThreadNode[] = []
  for (const c of items) {
    const node = byId.get(c.id)!
    if (c.parent_id && byId.has(c.parent_id)) {
      byId.get(c.parent_id)!.children.push(node)
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

  const tree = useMemo(() => buildTree(visible), [visible])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    await create.mutateAsync({
      anchor_kind: scopedAnchor?.kind ?? 'document',
      anchor_id: scopedAnchor?.id ?? null,
      body_md: body.trim(),
      parent_id: replyTo,
    })
    setBody('')
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
        <textarea
          aria-label="댓글 입력"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={
            scopedAnchor
              ? `이 ${scopedAnchor.kind === 'section' ? '섹션' : '블록'}에 댓글…`
              : '댓글을 입력하세요…'
          }
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none"
        />
        <div className="flex justify-end">
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
  node: ThreadNode
  slug: string
  currentUserId: string | null
  isAdmin: boolean
  onReply: (id: string) => void
  depth: number
}

function CommentRow({
  node,
  slug,
  currentUserId,
  isAdmin,
  onReply,
  depth,
}: CommentRowProps) {
  const patch = usePatchComment(slug)
  const remove = useDeleteComment(slug)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.body_md)

  const isAuthor = currentUserId !== null && currentUserId === node.author_id
  const canMutate = isAuthor || isAdmin
  const isDeleted = node.status === 'deleted'

  return (
    <li
      data-testid="comment-row"
      style={{ marginLeft: depth > 0 ? Math.min(depth, 4) * 12 : 0 }}
      className={`rounded border border-gray-200 bg-white p-2 ${
        isDeleted ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span className="font-medium text-smsg-900">
          {node.author_name ?? node.author_email ?? '(unknown)'}
        </span>
        <time dateTime={node.created_at ?? undefined}>
          {node.created_at ? new Date(node.created_at).toLocaleString() : ''}
        </time>
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
        <p
          className={`mt-1 whitespace-pre-wrap text-sm ${
            isDeleted ? 'italic line-through text-gray-400' : 'text-gray-800'
          }`}
        >
          {isDeleted ? '(삭제됨)' : node.body_md}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        {!isDeleted && (
          <button
            type="button"
            onClick={() => onReply(node.id)}
            className="text-link hover:underline"
          >
            답글
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
      {node.children.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {node.children.map((child) => (
            <CommentRow
              key={child.id}
              node={child}
              slug={slug}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onReply={onReply}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
