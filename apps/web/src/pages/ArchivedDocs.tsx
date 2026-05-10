/**
 * `/admin/archive` — admin tool to inspect, restore, or permanently delete
 * archived documents (cycle 8). Backed by `/admin/archived-docs[/restore|/purge]`.
 *
 *   - Filter: 보관일 (since_days), 작성자, 부서(team_id).
 *   - Multi-select rows → 일괄 복원 / 일괄 삭제.
 *   - Permanent delete is gated by the BE 7-day safety check; the FE simply
 *     surfaces the resulting 422 with a clear toast.
 *   - Pagination: 50 rows/page (offset-based).
 */
import { useCallback, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import {
  type ArchivedDoc,
  type ArchivedDocsListParams,
  listArchivedDocs,
  purgeArchivedDocs,
  restoreArchivedDocs,
} from '@/features/admin/api'

const PAGE_SIZE = 50

export function ArchivedDocsPage() {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''

  const [sinceDays, setSinceDays] = useState<string>('')
  const [author, setAuthor] = useState('')
  const [teamId, setTeamId] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmPurge, setConfirmPurge] = useState(false)
  // Admin opt-in to bypass the 7-day grace window. Reset whenever the
  // confirm dialog opens so the dangerous default is always "off".
  const [forcePurge, setForcePurge] = useState(false)

  const params: ArchivedDocsListParams = useMemo(
    () => ({
      since_days: sinceDays ? Number(sinceDays) : undefined,
      author: author || undefined,
      team_id: teamId || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [sinceDays, author, teamId, offset],
  )

  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'archived-docs', params],
    queryFn: () => listArchivedDocs(params),
    enabled: role === 'admin',
  })

  const items = data?.items ?? []
  const total = data?.meta.total ?? 0

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  const toggleAll = () =>
    setSelected((prev) => {
      if (items.every((it) => prev.has(it.slug))) {
        const next = new Set(prev)
        for (const it of items) next.delete(it.slug)
        return next
      }
      const next = new Set(prev)
      for (const it of items) next.add(it.slug)
      return next
    })

  const onRestore = useCallback(
    async (slugs: string[]) => {
      if (slugs.length === 0) return
      try {
        const res = await restoreArchivedDocs(slugs)
        toast.success(`${res.restored.length}건 복원 완료`)
        setSelected(new Set())
        await qc.invalidateQueries({ queryKey: ['admin', 'archived-docs'] })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '복원 실패')
      }
    },
    [qc],
  )

  const onPurge = useCallback(
    async (slugs: string[], force = false) => {
      if (slugs.length === 0) return
      try {
        const res = await purgeArchivedDocs(slugs, force)
        toast.success(`${res.purged.length}건 영구 삭제 완료`)
        setSelected(new Set())
        setConfirmPurge(false)
        setForcePurge(false)
        await qc.invalidateQueries({ queryKey: ['admin', 'archived-docs'] })
      } catch (err) {
        const msg = err instanceof Error ? err.message : '영구 삭제 실패'
        toast.error(msg)
        setConfirmPurge(false)
        setForcePurge(false)
      }
    },
    [qc],
  )

  const openConfirmPurge = useCallback(() => {
    setForcePurge(false)
    setConfirmPurge(true)
  }, [])

  if (!user) return null
  if (role !== 'admin') return <Navigate to="/" replace />

  return (
    <div
      className="mx-auto max-w-6xl px-6 py-8"
      data-testid="archived-docs-page"
    >
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-smsg-900">보관 문서 관리</h1>
        <p className="mt-1 text-sm text-gray-600">
          보관 처리된 문서를 검색하고, 복원하거나 영구 삭제합니다. 기본적으로 보관 후 7일이 지난 문서만 영구 삭제할 수 있으며, 필요한 경우 다이얼로그에서 즉시 삭제 옵션을 켜서 7일 제한을 우회할 수 있습니다.
        </p>
      </header>

      <Card className="mb-4" padded="md">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              className="block text-xs text-gray-600"
              htmlFor="archived-since-days"
            >
              보관일 (N일 이내)
            </label>
            <Input
              id="archived-since-days"
              type="number"
              min={1}
              max={3650}
              value={sinceDays}
              onChange={(e) => {
                setSinceDays(e.target.value)
                setOffset(0)
              }}
              placeholder="예: 30"
              data-testid="archived-since-days"
              aria-label="보관일"
            />
          </div>
          <div>
            <label
              className="block text-xs text-gray-600"
              htmlFor="archived-author"
            >
              작성자 (이름/이메일)
            </label>
            <Input
              id="archived-author"
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value)
                setOffset(0)
              }}
              placeholder="홍길동"
              data-testid="archived-author"
              aria-label="작성자"
            />
          </div>
          <div>
            <label
              className="block text-xs text-gray-600"
              htmlFor="archived-team-id"
            >
              부서 (team UUID)
            </label>
            <Input
              id="archived-team-id"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value)
                setOffset(0)
              }}
              placeholder="UUID"
              data-testid="archived-team-id"
              aria-label="부서"
            />
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void refetch()}
              data-testid="archived-refresh"
            >
              새로고침
            </Button>
          </div>
        </div>
      </Card>

      {selected.size > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-smsg-200 bg-smsg-50 px-3 py-2 text-sm"
          data-testid="archived-bulk-bar"
        >
          <span className="font-medium text-smsg-900">
            {selected.size}건 선택됨
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void onRestore(Array.from(selected))}
              data-testid="archived-bulk-restore"
            >
              일괄 복원
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={openConfirmPurge}
              data-testid="archived-bulk-purge"
            >
              일괄 영구 삭제
            </Button>
          </div>
        </div>
      )}

      {isPending && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-gray-500"
        >
          불러오는 중…
        </p>
      )}
      {isError && (
        <ErrorState
          title="보관 문서를 불러오지 못했습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="archived-docs-table"
            >
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={
                        items.length > 0 &&
                        items.every((it) => selected.has(it.slug))
                      }
                      onChange={toggleAll}
                      aria-label="전체 선택"
                      data-testid="archived-select-all"
                    />
                  </th>
                  <th className="px-3 py-2">슬러그</th>
                  <th className="px-3 py-2">제목</th>
                  <th className="px-3 py-2">보관일</th>
                  <th className="px-3 py-2">마지막 편집</th>
                  <th className="px-3 py-2">작성자</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((it) => (
                  <ArchivedRow
                    key={it.slug}
                    doc={it}
                    selected={selected.has(it.slug)}
                    onToggle={() => toggle(it.slug)}
                    onRestore={() => void onRestore([it.slug])}
                    onPurge={() => {
                      setSelected(new Set([it.slug]))
                      openConfirmPurge()
                    }}
                  />
                ))}
                {items.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-gray-500"
                      colSpan={7}
                    >
                      보관된 문서가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data && total > PAGE_SIZE && (
        <nav
          className="mt-3 flex items-center justify-between text-xs text-gray-600"
          aria-label="페이지네이션"
        >
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              data-testid="archived-prev"
            >
              이전
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              data-testid="archived-next"
            >
              다음
            </Button>
          </div>
        </nav>
      )}

      <Modal
        open={confirmPurge}
        onClose={() => {
          setConfirmPurge(false)
          setForcePurge(false)
        }}
        title="영구 삭제 확인"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setConfirmPurge(false)
                setForcePurge(false)
              }}
              data-testid="archived-purge-cancel"
            >
              취소
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void onPurge(Array.from(selected), forcePurge)}
              data-testid="archived-purge-confirm"
            >
              영구 삭제
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4 text-sm">
          <p className="font-medium text-red-700">
            ⚠️ 이 작업은 되돌릴 수 없습니다.
          </p>
          <p className="mt-2 text-gray-700">
            선택한 {selected.size}건의 문서가 데이터베이스에서 영구 삭제됩니다.
            기본적으로 보관된 지 7일이 지나지 않은 문서는 자동으로 거부됩니다.
          </p>
          <label
            className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800"
            data-testid="archived-purge-force-label"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={forcePurge}
              onChange={(e) => setForcePurge(e.target.checked)}
              data-testid="archived-purge-force"
              aria-label="7일 제한 우회 (즉시 삭제)"
            />
            <span>
              <span className="font-medium">7일 제한 우회 (즉시 삭제)</span>
              <span className="ml-1 text-xs text-red-700">
                — 방금 보관한 문서까지 곧바로 영구 삭제합니다. 신중히 선택하세요.
              </span>
            </span>
          </label>
        </div>
      </Modal>
    </div>
  )
}

function ArchivedRow({
  doc,
  selected,
  onToggle,
  onRestore,
  onPurge,
}: {
  doc: ArchivedDoc
  selected: boolean
  onToggle: () => void
  onRestore: () => void
  onPurge: () => void
}) {
  return (
    <tr data-testid={`archived-row-${doc.slug}`}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`${doc.slug} 선택`}
          data-testid={`archived-select-${doc.slug}`}
        />
      </td>
      <td className="px-3 py-2 font-mono text-xs text-smsg-700">
        /{doc.slug}
      </td>
      <td className="px-3 py-2 font-medium text-smsg-900">{doc.title}</td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {doc.archived_at
          ? new Date(doc.archived_at).toLocaleString()
          : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {doc.last_edited_at
          ? new Date(doc.last_edited_at).toLocaleString()
          : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-gray-700">
        {doc.owner_name ?? doc.owner_email ?? '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={onRestore}
            data-testid={`archived-row-restore-${doc.slug}`}
          >
            복원
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={onPurge}
            data-testid={`archived-row-purge-${doc.slug}`}
          >
            영구 삭제
          </Button>
        </div>
      </td>
    </tr>
  )
}
