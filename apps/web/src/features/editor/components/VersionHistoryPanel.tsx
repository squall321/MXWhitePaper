import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Slug } from '@/types/document'
import {
  getVersion,
  isPreconditionFailed,
  listVersions,
  restoreVersion,
  type VersionDetail,
  type VersionRow,
} from '../api'
import { useEditorStore } from '../state'

interface VersionHistoryPanelProps {
  slug: Slug
  /** When non-null shown as the active panel selection. */
}

/**
 * Side panel listing all versions newest-first. Clicking a row loads the
 * full version detail into the right preview pane; the 복원 button posts
 * /versions/:n/restore.
 */
export function VersionHistoryPanel({ slug }: VersionHistoryPanelProps) {
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const qc = useQueryClient()

  const list = useQuery<VersionRow[]>({
    queryKey: ['document-versions', slug],
    queryFn: () => listVersions(slug),
    staleTime: 30_000,
  })

  const [selected, setSelected] = useState<number | null>(null)
  const detail = useQuery<VersionDetail | null>({
    queryKey: ['document-version-detail', slug, selected],
    queryFn: () => (selected != null ? getVersion(slug, selected) : Promise.resolve(null)),
    enabled: selected != null,
  })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRestore = useCallback(async () => {
    if (selected == null || !etag) return
    setBusy(true)
    setError(null)
    try {
      const r = await restoreVersion(slug, selected, etag, `v${selected} 복원`)
      applySnapshot(r.document, r.etag)
      await qc.invalidateQueries({ queryKey: ['document', slug] })
      await qc.invalidateQueries({ queryKey: ['document-versions', slug] })
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
      else setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [slug, selected, etag, applySnapshot, qc, setConflict])

  return (
    <div className="space-y-3 px-2 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">버전 이력</h3>
      {list.isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {list.isError && <p className="text-sm text-red-600">버전 목록 로드 실패</p>}
      {list.data && list.data.length === 0 && (
        <p className="text-sm text-gray-500">버전이 없습니다.</p>
      )}
      <ul className="space-y-1">
        {list.data?.map((v) => (
          <li key={v.version}>
            <button
              type="button"
              onClick={() => setSelected(v.version)}
              data-active={selected === v.version ? '' : undefined}
              className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-smsg-100 ${
                selected === v.version ? 'bg-smsg-100 font-medium' : ''
              }`}
            >
              <span className="mr-2 font-mono text-xs text-smsg-500">v{v.version}</span>
              <span className="text-xs text-gray-600">
                {(v.edited_at ?? v.created_at)?.slice(0, 16) ?? ''}
                {(v.edited_by_name ?? v.author) ? ` · ${v.edited_by_name ?? v.author}` : ''}
              </span>
              {v.change_log && (
                <span className="block truncate text-xs text-gray-500">{v.change_log}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {selected != null && (
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">미리보기 v{selected}</span>
            <button
              type="button"
              onClick={() => void onRestore()}
              disabled={busy}
              className="rounded bg-smsg-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-smsg-900 disabled:opacity-50"
            >
              복원
            </button>
          </div>
          {detail.isPending && <p className="text-xs text-gray-500">로딩…</p>}
          {detail.data && (
            <pre className="max-h-72 overflow-auto rounded bg-gray-50 p-2 font-mono text-[10px]">
              {JSON.stringify(detail.data.content, null, 2)}
            </pre>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
