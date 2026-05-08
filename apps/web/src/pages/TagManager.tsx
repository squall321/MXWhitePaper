import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import { listTags, renameTag, deleteTag, type TagSuggestion } from '@/features/tags/api'

/**
 * `/admin/tags` — 태그 일괄 관리.
 *
 * - 모든 태그 + 사용 횟수 조회
 * - 인라인 rename / delete (확인 모달)
 * - 다중 선택 후 "통합" → 정규 이름으로 모두 rename
 */
export function TagManagerPage() {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<{ from: string; value: string } | null>(null)
  const [deleting, setDeleting] = useState<TagSuggestion | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mergeOpen, setMergeOpen] = useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['tags', 'all'],
    queryFn: () => listTags({ limit: 500 }),
    staleTime: 30_000,
  })

  const filtered = useMemo(() => {
    const all = Array.isArray(data) ? data : []
    if (!filter.trim()) return all
    const q = filter.trim().toLowerCase()
    return all.filter((t) => t.name.toLowerCase().includes(q))
  }, [data, filter])

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['tags'] })
  }, [qc])

  if (!user) return null
  if (role !== 'admin' && role !== 'owner' && role !== 'editor') {
    return <Navigate to="/" replace />
  }

  const canDelete = role === 'admin'

  const toggleSelected = (name: string) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8" data-testid="tag-manager-page">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">태그 관리</h1>
          <p className="mt-1 text-sm text-gray-600">
            모든 문서의 metadata.tags 를 일괄 rename / delete / 통합 할 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="태그 검색"
            data-testid="tag-manager-filter"
            className="w-48"
          />
          {selected.size >= 2 && (
            <Button
              variant="primary"
              onClick={() => setMergeOpen(true)}
              data-testid="tag-manager-merge-btn"
            >
              통합 ({selected.size})
            </Button>
          )}
        </div>
      </header>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="태그를 불러오지 못했습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="tag-manager-table">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-12 px-3 py-2"></th>
                  <th className="px-3 py-2">태그</th>
                  <th className="px-3 py-2">사용 문서 수</th>
                  <th className="px-3 py-2 text-right">동작</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                      태그가 없습니다.
                    </td>
                  </tr>
                )}
                {filtered.map((t) => (
                  <tr
                    key={t.name}
                    className="border-t border-gray-100"
                    data-testid={`tag-row-${t.name}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`태그 ${t.name} 선택`}
                        checked={selected.has(t.name)}
                        onChange={() => toggleSelected(t.name)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-smsg-900">
                      <Link
                        to={`/tags/${encodeURIComponent(t.name)}`}
                        className="text-link hover:underline"
                      >
                        #{t.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{t.count}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing({ from: t.name, value: t.name })}
                      >
                        이름 수정
                      </Button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50"
                          onClick={() => setDeleting(t)}
                        >
                          삭제
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <RenameModal
          from={editing.from}
          initialValue={editing.value}
          onClose={() => setEditing(null)}
          onSuccess={(affected) => {
            setEditing(null)
            toast.success(`${affected}개 문서의 태그가 갱신되었습니다.`)
            refresh()
          }}
        />
      )}

      {deleting && (
        <DeleteModal
          tag={deleting}
          onClose={() => setDeleting(null)}
          onSuccess={(affected) => {
            setDeleting(null)
            toast.success(`${affected}개 문서에서 태그가 제거되었습니다.`)
            refresh()
          }}
        />
      )}

      {mergeOpen && (
        <MergeModal
          tags={Array.from(selected)}
          onClose={() => setMergeOpen(false)}
          onSuccess={(total) => {
            setMergeOpen(false)
            setSelected(new Set())
            toast.success(`${total}개 문서가 통합되었습니다.`)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function RenameModal({
  from,
  initialValue,
  onClose,
  onSuccess,
}: {
  from: string
  initialValue: string
  onClose: () => void
  onSuccess: (affected: number) => void
}) {
  const [val, setVal] = useState(initialValue)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const to = val.trim()
    if (!to) {
      toast.warn('새 이름을 입력하세요.')
      return
    }
    if (to === from) {
      onClose()
      return
    }
    setBusy(true)
    try {
      const affected = await renameTag(from, to)
      onSuccess(affected)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '태그 변경 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="태그 이름 변경"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="tag-rename-submit">
            저장
          </Button>
        </div>
      }
    >
      <p className="text-xs text-gray-500">
        기존: <span className="font-medium">#{from}</span>
      </p>
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="새 태그 이름"
        autoFocus
        data-testid="tag-rename-input"
      />
    </Modal>
  )
}

function DeleteModal({
  tag,
  onClose,
  onSuccess,
}: {
  tag: TagSuggestion
  onClose: () => void
  onSuccess: (affected: number) => void
}) {
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const affected = await deleteTag(tag.name)
      onSuccess(affected)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '태그 삭제 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="태그 삭제"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="danger" onClick={submit} loading={busy} data-testid="tag-delete-submit">
            삭제
          </Button>
        </div>
      }
    >
      <p className="text-sm text-gray-700">
        <span className="font-semibold">#{tag.name}</span> 태그를 모든 문서({tag.count})에서 제거합니다. 계속하시겠습니까?
      </p>
    </Modal>
  )
}

function MergeModal({
  tags,
  onClose,
  onSuccess,
}: {
  tags: string[]
  onClose: () => void
  onSuccess: (total: number) => void
}) {
  const [canonical, setCanonical] = useState(tags[0] ?? '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!canonical.trim()) {
      toast.warn('정규 이름을 선택하세요.')
      return
    }
    setBusy(true)
    try {
      let total = 0
      for (const t of tags) {
        if (t === canonical) continue
        const affected = await renameTag(t, canonical)
        total += affected
      }
      onSuccess(total)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '통합 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="태그 통합"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="tag-merge-submit">
            통합
          </Button>
        </div>
      }
    >
      <p className="text-sm text-gray-700">
        선택한 태그들을 하나의 정규 이름으로 모읍니다.
      </p>
      <ul className="my-2 flex flex-wrap gap-1">
        {tags.map((t) => (
          <li
            key={t}
            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
          >
            #{t}
          </li>
        ))}
      </ul>
      <label className="block text-xs text-gray-600">정규 이름</label>
      <select
        value={canonical}
        onChange={(e) => setCanonical(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
        data-testid="tag-merge-canonical"
      >
        {tags.map((t) => (
          <option key={t} value={t}>
            #{t}
          </option>
        ))}
      </select>
    </Modal>
  )
}
