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

/**
 * Absolute API base URL for the mxwp-mcp client (Claude Desktop / Code).
 *
 * The MCP `api_client` appends full paths like `/api/v1/documents`, so
 * `MXWP_API_URL` must be the origin **without** the `/api/v1` suffix — for a
 * portal sub-path deployment that means origin + BASE_URL with the trailing
 * slash trimmed (`https://host/mx-white-paper`). An out-of-browser process
 * has no page origin, hence the fully-qualified URL.
 *
 * `VITE_API_URL` override: the in-app client uses it as a `/api/v1` base, so
 * we strip a trailing `/api/v1` (and any trailing slash) to get the bare
 * origin the MCP server expects.
 */
export function mcpApiBaseUrl(): string {
  const override = import.meta.env.VITE_API_URL as string | undefined
  if (override && /^https?:\/\//i.test(override)) {
    return override.replace(/\/?(api\/v1)?\/?$/i, '')
  }
  const base = import.meta.env.BASE_URL || '/'
  // origin + sub-path, no trailing slash; api_client adds `/api/v1/...`.
  return `${window.location.origin}${base}`.replace(/\/$/, '')
}

/**
 * Ready-to-paste Claude Desktop `mcpServers` config block for the mxwp-mcp
 * binary, wired to this deployment's API and the freshly-minted token.
 * The binary path is left as a placeholder the user must edit — we cannot
 * know where they unpacked the toolkit.
 */
export function buildMcpDesktopConfig(token: string): string {
  const config = {
    mcpServers: {
      'mxwp-rag': {
        command: '/absolute/path/to/llm-docx-toolkit/bin/mxwp-mcp',
        env: {
          MXWP_API_URL: mcpApiBaseUrl(),
          MXWP_API_TOKEN: token,
        },
      },
    },
  }
  return JSON.stringify(config, null, 2)
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
