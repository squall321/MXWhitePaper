/**
 * Typed admin wrappers around the org CRUD endpoints. Mirrors the BE
 * routes in `apps/api/app/routers/orgs.py`.
 *
 * All write methods require an `admin` JWT — the apiClient interceptor
 * injects the bearer token automatically.
 */
import { apiClient } from '@/lib/api/client'
import { unwrapListMaybe, type ApiEnvelope } from '@/lib/api/envelope'

// ── Division ──────────────────────────────────────────────────────────
export interface CreateDivisionInput {
  slug: string
  name: string
  description?: string | null
}
export interface UpdateDivisionInput {
  name?: string
  description?: string | null
}

export async function createDivision(input: CreateDivisionInput): Promise<void> {
  await apiClient.post<ApiEnvelope<unknown>>('/divisions', input)
}
export async function updateDivision(slug: string, input: UpdateDivisionInput): Promise<void> {
  await apiClient.put<ApiEnvelope<unknown>>(`/divisions/${slug}`, input)
}
export async function deleteDivision(slug: string): Promise<void> {
  await apiClient.delete(`/divisions/${slug}`)
}

// ── Team ──────────────────────────────────────────────────────────────
export interface CreateTeamInput {
  division_slug: string
  slug: string
  name: string
}
export interface UpdateTeamInput {
  name?: string
}

export async function createTeam(input: CreateTeamInput): Promise<void> {
  await apiClient.post<ApiEnvelope<unknown>>('/teams', input)
}
export async function updateTeam(
  division: string,
  slug: string,
  input: UpdateTeamInput,
): Promise<void> {
  await apiClient.put<ApiEnvelope<unknown>>(`/teams/${slug}`, input, {
    params: { division },
  })
}
export async function deleteTeam(division: string, slug: string): Promise<void> {
  await apiClient.delete(`/teams/${slug}`, { params: { division } })
}

// ── Group ─────────────────────────────────────────────────────────────
export interface CreateGroupInput {
  division_slug: string
  team_slug: string
  slug: string
  name: string
}
export interface UpdateGroupInput {
  name?: string
}

export async function createGroup(input: CreateGroupInput): Promise<void> {
  await apiClient.post<ApiEnvelope<unknown>>('/groups', input)
}
export async function updateGroup(
  division: string,
  team: string,
  slug: string,
  input: UpdateGroupInput,
): Promise<void> {
  await apiClient.put<ApiEnvelope<unknown>>(`/groups/${slug}`, input, {
    params: { division, team },
  })
}
export async function deleteGroup(
  division: string,
  team: string,
  slug: string,
): Promise<void> {
  await apiClient.delete(`/groups/${slug}`, { params: { division, team } })
}

// ── Part ──────────────────────────────────────────────────────────────
export interface CreatePartInput {
  division_slug: string
  team_slug: string
  group_slug: string
  slug: string
  name: string
}
export interface UpdatePartInput {
  name?: string
  /** Move to a different group — all three target slugs are required together. */
  target_division_slug?: string
  target_team_slug?: string
  target_group_slug?: string
  target_slug?: string
}

export async function createPart(input: CreatePartInput): Promise<void> {
  await apiClient.post<ApiEnvelope<unknown>>('/parts', input)
}
export async function updatePart(
  division: string,
  team: string,
  group: string,
  slug: string,
  input: UpdatePartInput,
): Promise<void> {
  await apiClient.put<ApiEnvelope<unknown>>(`/parts/${slug}`, input, {
    params: { division, team, group },
  })
}
export async function deletePart(
  division: string,
  team: string,
  group: string,
  slug: string,
): Promise<void> {
  await apiClient.delete(`/parts/${slug}`, { params: { division, team, group } })
}

// ── Helpers ───────────────────────────────────────────────────────────
/**
 * Count published documents currently linked to the given part. Used to
 * surface a delete-confirmation warning ("이 파트의 문서 N건은 미배치
 * 상태가 됩니다").
 */
export async function countDocsInPart(partSlug: string): Promise<number> {
  const items = await unwrapListMaybe<unknown>(
    apiClient.get('/documents', {
      params: { part_slug: partSlug, limit: 200 },
    }),
  )
  return items.length
}
