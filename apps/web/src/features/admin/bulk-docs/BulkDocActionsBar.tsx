import { useState } from 'react'
import { Button, Modal } from '@/components/ui'
import { toast } from '@/components/ui/Toast'
import { toApiError } from '@/lib/api/envelope'
import { TagAutocomplete } from '@/features/tags/TagAutocomplete'
import { useOrgTree } from '@/features/org/hooks/useOrgTree'
import type { OrgPart } from '@/features/org/types'
import { useBulkDocStore } from './bulkDocStore'
import { postBulkDocs, type BulkDocOp, type BulkDocsResult } from './api'

/**
 * BulkDocActionsBar — floating bottom-center bar that surfaces bulk admin
 * actions whenever `bulkDocStore.size() > 0`. Loose-coupled: list pages just
 * import this and render it once at the page root; it reads selection from
 * the store.
 *
 * Buttons: 이동 / 태그 추가 / 태그 제거 / 상태 변경 / 삭제. Each opens a
 * small picker modal which calls POST /admin/bulk-docs with the appropriate
 * `op` + `payload`.
 */
type Action = 'move-part' | 'add-tag' | 'remove-tag' | 'transition' | 'delete'

export function BulkDocActionsBar() {
  const selected = useBulkDocStore((s) => s.selected)
  const clear = useBulkDocStore((s) => s.clear)
  const [active, setActive] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const count = selected.size
  if (count === 0) return null

  async function run(op: BulkDocOp, payload: Record<string, string>) {
    setBusy(true)
    try {
      const slugs = Array.from(selected)
      const res: BulkDocsResult = await postBulkDocs({
        slugs,
        op,
        payload,
      })
      if (res.failed === 0) {
        toast.success(`${res.ok}건 처리 완료`)
      } else {
        toast.error(`${res.failed}건 실패 / ${res.ok}건 성공`)
      }
      clear()
      setActive(null)
    } catch (err) {
      toast.error(`일괄 작업 실패: ${toApiError(err).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        data-testid="bulk-doc-actions-bar"
        className="fixed bottom-4 left-1/2 z-popover -translate-x-1/2 transform rounded-full border border-gray-200 bg-white px-3 py-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        role="toolbar"
        aria-label="다중 문서 작업"
      >
        <div className="flex items-center gap-2">
          <span className="px-2 text-sm font-medium text-smsg-900 dark:text-gray-100">
            {count}개 선택됨
          </span>
          <span className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActive('move-part')}
            data-testid="bulk-doc-action-move"
          >
            이동
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActive('add-tag')}
            data-testid="bulk-doc-action-add-tag"
          >
            태그 추가
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActive('remove-tag')}
            data-testid="bulk-doc-action-remove-tag"
          >
            태그 제거
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActive('transition')}
            data-testid="bulk-doc-action-transition"
          >
            상태 변경
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setActive('delete')}
            data-testid="bulk-doc-action-delete"
          >
            삭제
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => clear()}
            data-testid="bulk-doc-action-cancel"
          >
            취소
          </Button>
        </div>
      </div>

      {active === 'move-part' && (
        <MovePartModal
          busy={busy}
          onCancel={() => setActive(null)}
          onSubmit={(part_id) => run('move-part', { part_id })}
        />
      )}
      {(active === 'add-tag' || active === 'remove-tag') && (
        <TagPickerModal
          op={active}
          busy={busy}
          onCancel={() => setActive(null)}
          onSubmit={(tag) => run(active, { tag })}
        />
      )}
      {active === 'transition' && (
        <TransitionPickerModal
          busy={busy}
          onCancel={() => setActive(null)}
          onSubmit={(status) => run('transition', { status })}
        />
      )}
      {active === 'delete' && (
        <DeleteConfirmModal
          count={count}
          busy={busy}
          onCancel={() => setActive(null)}
          onSubmit={() => run('delete', {})}
        />
      )}
    </>
  )
}

// ── pickers ─────────────────────────────────────────────────────────────

function MovePartModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (partId: string) => void
}) {
  const { data, isPending, isError } = useOrgTree()
  const [picked, setPicked] = useState<OrgPart | null>(null)
  return (
    <Modal
      open
      onClose={onCancel}
      title="부서로 이동"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button
            onClick={() => picked && onSubmit(picked.id)}
            disabled={!picked || busy}
            data-testid="bulk-doc-move-confirm"
          >
            이동
          </Button>
        </div>
      }
    >
      <div className="px-5 py-4 text-sm">
        {isPending && <p className="text-gray-500">조직 트리 로드 중…</p>}
        {isError && (
          <p className="text-red-600">조직 트리를 불러오지 못했습니다.</p>
        )}
        {!isPending && !isError && (
          <ul className="max-h-80 space-y-1 overflow-auto">
            {(data ?? []).flatMap((div) =>
              div.teams.flatMap((team) =>
                team.groups.flatMap((group) =>
                  group.parts.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(p)}
                        data-testid={`bulk-doc-move-part-${p.slug}`}
                        className={
                          'w-full rounded px-2 py-1 text-left text-sm hover:bg-smsg-50 dark:hover:bg-gray-800 ' +
                          (picked?.id === p.id
                            ? 'bg-smsg-100 font-semibold text-smsg-900 dark:bg-smsg-900/40 dark:text-smsg-100'
                            : 'text-gray-700 dark:text-gray-200')
                        }
                      >
                        <span className="text-xs text-gray-400">
                          {div.name} › {team.name} › {group.name} ›{' '}
                        </span>
                        {p.name}
                      </button>
                    </li>
                  )),
                ),
              ),
            )}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function TagPickerModal({
  op,
  busy,
  onCancel,
  onSubmit,
}: {
  op: 'add-tag' | 'remove-tag'
  busy: boolean
  onCancel: () => void
  onSubmit: (tag: string) => void
}) {
  const [tags, setTags] = useState<string[]>([])
  const tag = tags[0] ?? ''
  return (
    <Modal
      open
      onClose={onCancel}
      title={op === 'add-tag' ? '태그 추가' : '태그 제거'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button
            onClick={() => tag && onSubmit(tag)}
            disabled={!tag || busy}
            data-testid="bulk-doc-tag-confirm"
          >
            적용
          </Button>
        </div>
      }
    >
      <div className="space-y-2 px-5 py-4 text-sm">
        <p className="text-gray-600 dark:text-gray-300">
          선택한 모든 문서에 적용할 태그를 입력하세요. (한 번에 한 개)
        </p>
        <TagAutocomplete
          value={tags.slice(0, 1)}
          onChange={(next) => setTags(next.slice(-1))}
          placeholder="태그 입력 후 Enter"
          data-testid="bulk-doc-tag-input"
        />
      </div>
    </Modal>
  )
}

const STATUS_OPTIONS: { value: 'draft' | 'in_review' | 'approved' | 'published' | 'archived'; label: string }[] = [
  { value: 'draft', label: '초안' },
  { value: 'in_review', label: '검토중' },
  { value: 'approved', label: '승인됨' },
  { value: 'published', label: '발행됨' },
  { value: 'archived', label: '보관됨' },
]

function TransitionPickerModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (status: string) => void
}) {
  const [status, setStatus] = useState<string>('')
  return (
    <Modal
      open
      onClose={onCancel}
      title="상태 변경"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button
            onClick={() => status && onSubmit(status)}
            disabled={!status || busy}
            data-testid="bulk-doc-transition-confirm"
          >
            변경
          </Button>
        </div>
      }
    >
      <fieldset className="px-5 py-4 text-sm">
        <legend className="sr-only">목표 상태</legend>
        <ul className="space-y-1">
          {STATUS_OPTIONS.map((opt) => (
            <li key={opt.value}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-smsg-50 dark:hover:bg-gray-800">
                <input
                  type="radio"
                  name="bulk-doc-status"
                  value={opt.value}
                  checked={status === opt.value}
                  onChange={() => setStatus(opt.value)}
                  data-testid={`bulk-doc-transition-${opt.value}`}
                />
                <span>{opt.label}</span>
                <span className="ml-2 font-mono text-xs text-gray-400">
                  {opt.value}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </Modal>
  )
}

function DeleteConfirmModal({
  count,
  busy,
  onCancel,
  onSubmit,
}: {
  count: number
  busy: boolean
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="문서 일괄 삭제"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button
            variant="danger"
            onClick={onSubmit}
            disabled={busy}
            data-testid="bulk-doc-delete-confirm"
          >
            삭제
          </Button>
        </div>
      }
    >
      <p className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">
        선택한 <strong>{count}</strong>개 문서를 보관(archived) 상태로 전환합니다.
        이 작업은 별도 복구 기능을 통해서만 되돌릴 수 있습니다.
      </p>
    </Modal>
  )
}
