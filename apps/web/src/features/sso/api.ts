/**
 * SSO providers API client (Cycle 19 scaffolding).
 *
 * Mirrors `apps/api/app/routers/sso.py`. Admin CRUD + the public
 * email-domain `discover` lookup used on the login page.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type SsoKind = 'saml' | 'oidc'
export const ALL_SSO_KINDS: SsoKind[] = ['saml', 'oidc']

export type SsoDefaultRole = 'reader' | 'editor' | 'owner' | 'admin'
export const ALL_SSO_DEFAULT_ROLES: SsoDefaultRole[] = [
  'reader',
  'editor',
  'owner',
  'admin',
]

export interface SsoProvider {
  id: string
  name: string
  kind: SsoKind
  enabled: boolean
  saml_metadata_url: string | null
  saml_entity_id: string | null
  saml_acs_url: string | null
  saml_x509_cert: string | null
  oidc_issuer: string | null
  oidc_client_id: string | null
  oidc_client_secret_set: boolean
  oidc_client_secret: string | null
  oidc_scopes: string[]
  email_domain: string | null
  attribute_mapping: Record<string, string>
  default_role: SsoDefaultRole
  created_at: string | null
  updated_at: string | null
}

export interface CreateSsoProviderIn {
  name: string
  kind: SsoKind
  enabled?: boolean
  saml_metadata_url?: string | null
  saml_entity_id?: string | null
  saml_acs_url?: string | null
  saml_x509_cert?: string | null
  oidc_issuer?: string | null
  oidc_client_id?: string | null
  oidc_client_secret?: string | null
  oidc_scopes?: string[]
  email_domain?: string | null
  attribute_mapping?: Record<string, string>
  default_role?: SsoDefaultRole
}

export interface PatchSsoProviderIn {
  name?: string
  kind?: SsoKind
  enabled?: boolean
  saml_metadata_url?: string | null
  saml_entity_id?: string | null
  saml_acs_url?: string | null
  saml_x509_cert?: string | null
  oidc_issuer?: string | null
  oidc_client_id?: string | null
  oidc_client_secret?: string | null
  oidc_scopes?: string[]
  email_domain?: string | null
  attribute_mapping?: Record<string, string>
  default_role?: SsoDefaultRole
}

export async function listSsoProviders(): Promise<SsoProvider[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: SsoProvider[] }>>(
    '/admin/sso/providers',
  )
  return unwrap(res).items ?? []
}

export async function getSsoProvider(id: string): Promise<SsoProvider> {
  const res = await apiClient.get<ApiEnvelope<SsoProvider>>(
    `/admin/sso/providers/${encodeURIComponent(id)}`,
  )
  return unwrap(res)
}

export async function createSsoProvider(
  body: CreateSsoProviderIn,
): Promise<SsoProvider> {
  const res = await apiClient.post<ApiEnvelope<SsoProvider>>(
    '/admin/sso/providers',
    body,
  )
  return unwrap(res)
}

export async function patchSsoProvider(
  id: string,
  body: PatchSsoProviderIn,
): Promise<SsoProvider> {
  const res = await apiClient.patch<ApiEnvelope<SsoProvider>>(
    `/admin/sso/providers/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteSsoProvider(id: string): Promise<void> {
  await apiClient.delete(`/admin/sso/providers/${encodeURIComponent(id)}`)
}

export interface SsoDiscoverResult {
  provider_id: string
  kind: SsoKind
  name: string
  login_url: string
}

/**
 * Resolve `email` → matching enabled provider. Throws when there is no
 * match (404 from BE) — the login page calls this on email blur and
 * silently swallows 404 to keep the password field visible.
 */
export async function discoverSsoProvider(
  email: string,
): Promise<SsoDiscoverResult> {
  const res = await apiClient.get<ApiEnvelope<SsoDiscoverResult>>(
    '/auth/sso/discover',
    { params: { email } },
  )
  return unwrap(res)
}
