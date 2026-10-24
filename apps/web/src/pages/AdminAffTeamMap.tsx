// 관리자 화면 — 포털 소속 id 별로 처음 들어온 SSO 사용자를 넣을 팀을 정하는 대응표(docs/llm-wiki C5)
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { toast } from '@/components/ui/Toast'
import {
  deleteAffTeamMap,
  listAffTeamMap,
  listTeams,
  putAffTeamMap,
} from '@/features/aff-team-map/api'

const MAP_KEY = ['admin', 'aff-team-map'] as const

/**
 * `/admin/aff-team-map` — 포털 진입 토큰의 `affiliation` 으로 첫 팀을 정한다. 대응이 없으면 지금처럼 첫 팀에 들고,
 * 이미 있는 사용자의 팀은 바꾸지 않는다. 게이트웨이로 먼저 온 사람은 소속을 모른 채 만들어져 이 표를 쓰지 않는다.
 */
export function AdminAffTeamMapPage() {
  const qc = useQueryClient()
  const map = useQuery({ queryKey: MAP_KEY, queryFn: listAffTeamMap })
  const teams = useQuery({ queryKey: ['teams', 'all'], queryFn: listTeams, staleTime: 60_000 })
  const [affiliation, setAffiliation] = useState('')
  const [teamId, setTeamId] = useState('')

  const save = useMutation({
    mutationFn: () => putAffTeamMap(affiliation.trim(), teamId),
    onSuccess: (row) => {
      toast.success(`${row.affiliation} → ${row.team_name}`)
      setAffiliation('')
      void qc.invalidateQueries({ queryKey: MAP_KEY })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '저장 실패'),
  })
  const remove = useMutation({
    mutationFn: (aff: string) => deleteAffTeamMap(aff),
    onSuccess: () => void qc.invalidateQueries({ queryKey: MAP_KEY }),
    onError: (err) => toast.error(err instanceof Error ? err.message : '삭제 실패'),
  })

  const canSave = affiliation.trim() !== '' && teamId !== '' && !save.isPending

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="aff-team-map-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-smsg-900">소속 → 팀</h1>
        <p className="mt-1 text-sm text-gray-600">
          포털 소속 id 별로, 처음 들어온 SSO 사용자를 넣을 팀을 정합니다. 대응이 없으면 첫 팀에 들고, 이미 있는
          사용자의 팀은 바꾸지 않습니다.
        </p>
      </header>

      <Card padded="lg" className="mb-6">
        <form
          className="flex flex-wrap items-end gap-3"
          data-testid="aff-team-map-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave) save.mutate()
          }}
        >
          <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-gray-600">
            소속 id
            <input
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
              placeholder="포털 소속 id"
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
              data-testid="aff-input"
            />
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-gray-600">
            팀
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
              data-testid="team-select"
            >
              <option value="">팀 고르기</option>
              {(teams.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.slug})
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={!canSave} loading={save.isPending} data-testid="aff-submit">
            추가 · 바꾸기
          </Button>
        </form>
      </Card>

      {map.isPending && (
        <p className="text-sm text-gray-500" data-testid="aff-team-map-loading">
          불러오는 중…
        </p>
      )}
      {map.isError && (
        <ErrorState
          title="소속 → 팀 대응표를 불러올 수 없습니다"
          description={map.error instanceof Error ? map.error.message : '오류'}
          onRetry={() => void map.refetch()}
        />
      )}
      {map.data && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="aff-team-map-table">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2">소속 id</th>
                  <th className="px-3 py-2">팀</th>
                  <th className="px-3 py-2 text-right">동작</th>
                </tr>
              </thead>
              <tbody>
                {map.data.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                      대응이 없습니다 — 모두 첫 팀에 듭니다.
                    </td>
                  </tr>
                )}
                {map.data.map((m) => (
                  <tr
                    key={m.affiliation}
                    className="border-t border-gray-100 dark:border-gray-800"
                    data-testid={`aff-row-${m.affiliation}`}
                  >
                    <td className="px-3 py-2 font-medium text-smsg-900 dark:text-gray-100">{m.affiliation}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                      {m.team_name} <span className="text-gray-500">({m.team_slug})</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 dark:text-red-400"
                        onClick={() => remove.mutate(m.affiliation)}
                        loading={remove.isPending && remove.variables === m.affiliation}
                        data-testid={`aff-delete-${m.affiliation}`}
                      >
                        삭제
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
