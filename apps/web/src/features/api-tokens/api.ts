/**
 * Personal API Tokens API client (Cycle 0023).
 *
 * Mirrors `apps/api/app/routers/api_tokens.py`. Domain types only — envelope
 * unwrap is handled here so callers get plain objects.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type TokenScope = 'read' | 'write' | 'admin'

/** What `/me/api-tokens` returns per row (no plaintext token). */
export interface ApiTokenRow {
  id: string
  user_id: string
  name: string
  token_prefix: string
  scopes: TokenScope[]
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string | null
  masked_token: string
}

/** Returned by POST /me/api-tokens and POST /me/api-tokens/:id/rotate. */
export interface ApiTokenWithSecret extends ApiTokenRow {
  /** Plaintext token — visible exactly once. */
  token: string
  /** Set on rotate responses; the id of the row that was just revoked. */
  replaced_id?: string
}

export interface CreateTokenBody {
  name: string
  scopes?: TokenScope[]
  /** ISO-8601 timestamp; null/omit means no expiry. */
  expires_at?: string | null
}

export async function listApiTokens(): Promise<ApiTokenRow[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: ApiTokenRow[] }>>(
    '/me/api-tokens',
  )
  return unwrap(res).items
}

export async function createApiToken(
  body: CreateTokenBody,
): Promise<ApiTokenWithSecret> {
  const res = await apiClient.post<ApiEnvelope<ApiTokenWithSecret>>(
    '/me/api-tokens',
    body,
  )
  return unwrap(res)
}

export async function revokeApiToken(id: string): Promise<void> {
  await apiClient.delete(`/me/api-tokens/${encodeURIComponent(id)}`)
}

export async function rotateApiToken(id: string): Promise<ApiTokenWithSecret> {
  const res = await apiClient.post<ApiEnvelope<ApiTokenWithSecret>>(
    `/me/api-tokens/${encodeURIComponent(id)}/rotate`,
  )
  return unwrap(res)
}

/** Map an `expires_in` UI choice to a concrete ISO-8601 (or null = forever). */
export function expiresInToISO(
  choice: '1m' | '3m' | '1y' | 'never',
  now: Date = new Date(),
): string | null {
  if (choice === 'never') return null
  const out = new Date(now)
  if (choice === '1m') out.setMonth(out.getMonth() + 1)
  else if (choice === '3m') out.setMonth(out.getMonth() + 3)
  else if (choice === '1y') out.setFullYear(out.getFullYear() + 1)
  return out.toISOString()
}
