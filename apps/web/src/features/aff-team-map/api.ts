// 포털 소속 → 팀 대응표(관리자) API — 처음 들어온 SSO 사용자의 팀을 정한다(docs/llm-wiki C5)
/**
 * `apps/api/app/routers/auth_sso.py` 의 `/admin/aff-team-map` 와 1:1.
 * 소속 id 에 한글이 올 수 있어 경로에 넣을 때 encodeURIComponent 한다.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface AffTeamMapping {
  affiliation: string
  team_id: string
  team_slug: string
  team_name: string
  updated_at?: string
}

export interface TeamOption {
  id: string
  slug: string
  name: string
}

export async function listAffTeamMap(): Promise<AffTeamMapping[]> {
  const res = await apiClient.get<ApiEnvelope<AffTeamMapping[]>>('/admin/aff-team-map')
  return unwrap(res) ?? []
}

export async function putAffTeamMap(affiliation: string, teamId: string): Promise<AffTeamMapping> {
  const res = await apiClient.put<ApiEnvelope<AffTeamMapping>>(
    `/admin/aff-team-map/${encodeURIComponent(affiliation)}`,
    { team_id: teamId },
  )
  return unwrap(res)
}

export async function deleteAffTeamMap(affiliation: string): Promise<void> {
  await apiClient.delete(`/admin/aff-team-map/${encodeURIComponent(affiliation)}`)
}

export async function listTeams(): Promise<TeamOption[]> {
  const res = await apiClient.get<ApiEnvelope<TeamOption[]>>('/teams')
  return unwrap(res) ?? []
}
