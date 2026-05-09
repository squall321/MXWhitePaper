import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import {
  ALL_SSO_DEFAULT_ROLES,
  ALL_SSO_KINDS,
  type CreateSsoProviderIn,
  type SsoDefaultRole,
  type SsoKind,
  type SsoProvider,
  createSsoProvider,
  deleteSsoProvider,
  listSsoProviders,
  patchSsoProvider,
} from '@/features/sso/api'

const KIND_LABELS: Record<SsoKind, string> = {
  saml: 'SAML 2.0',
  oidc: 'OIDC',
}

const ROLE_LABELS: Record<SsoDefaultRole, string> = {
  reader: 'reader',
  editor: 'editor',
  owner: 'owner',
  admin: 'admin',
}

interface KvPair {
  k: string
  v: string
}

function pairsToObject(pairs: KvPair[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { k, v } of pairs) {
    const trimmed = k.trim()
    if (trimmed) out[trimmed] = v
  }
  return out
}

function objectToPairs(obj: Record<string, string>): KvPair[] {
  return Object.entries(obj || {}).map(([k, v]) => ({ k, v: String(v) }))
}

/**
 * `/admin/sso` — admin-only CRUD over SAML / OIDC providers.
 *
 * Real handshake is not implemented yet — this page lands the data model,
 * the discover endpoint, and the email-domain auto-routing wiring on the
 * login page. Users who try to log in with SSO will see a "곧 출시됩니다"
 * toast (the BE returns 501 SSO_NOT_IMPLEMENTED).
 */
export function SsoProvidersPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['sso-providers', 'list'],
    queryFn: listSsoProviders,
  })

  const items = useMemo(() => data ?? [], [data])

  const onChanged = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['sso-providers', 'list'] })
  }, [qc])

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-8"
      data-testid="sso-providers-page"
    >
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">SSO 제공자</h1>
          <p className="mt-1 text-sm text-gray-600">
            SAML 2.0 / OIDC IdP 설정. 이메일 도메인을 매칭하면 로그인 화면에서
            자동으로 SSO 버튼이 노출됩니다. 실제 흐름은 다음 사이클에서 활성화됩니다.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setCreateOpen(true)}
          data-testid="sso-add-button"
        >
          + 새 제공자
        </Button>
      </header>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="SSO 제공자를 불러올 수 없습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <ul
            className="divide-y divide-gray-100 text-sm"
            data-testid="sso-providers-list"
          >
            {items.map((p) => (
              <ProviderRow
                key={p.id}
                provider={p}
                onChanged={onChanged}
              />
            ))}
            {items.length === 0 && (
              <li className="px-4 py-6 text-center text-gray-500">
                등록된 SSO 제공자가 없습니다.
              </li>
            )}
          </ul>
        </Card>
      )}

      <CreateProviderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          onChanged()
        }}
      />
    </div>
  )
}

function ProviderRow({
  provider,
  onChanged,
}: {
  provider: SsoProvider
  onChanged: () => void
}) {
  const toggleMut = useMutation({
    mutationFn: () =>
      patchSsoProvider(provider.id, { enabled: !provider.enabled }),
    onSuccess: () => {
      toast.success(provider.enabled ? '비활성화됨' : '활성화됨')
      onChanged()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteSsoProvider(provider.id),
    onSuccess: () => {
      toast.success('삭제됨')
      onChanged()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    },
  })

  return (
    <li
      className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
      data-testid={`sso-row-${provider.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-smsg-900">{provider.name}</span>
          <Badge size="sm" tone={provider.kind === 'saml' ? 'info' : 'brand'}>
            {KIND_LABELS[provider.kind]}
          </Badge>
          {provider.enabled ? (
            <Badge size="sm" tone="success">활성</Badge>
          ) : (
            <Badge size="sm" tone="muted">비활성</Badge>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {provider.email_domain
            ? <>도메인: <code>@{provider.email_domain}</code></>
            : '도메인 미설정'}
          {' · '}
          기본 role: <code>{provider.default_role}</code>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={() => toggleMut.mutate()}
            data-testid={`sso-row-enabled-${provider.id}`}
            aria-label="활성"
          />
          활성
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.confirm(`'${provider.name}' 을(를) 삭제할까요?`)) {
              deleteMut.mutate()
            }
          }}
          data-testid={`sso-row-delete-${provider.id}`}
        >
          삭제
        </Button>
      </div>
    </li>
  )
}

function CreateProviderModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SsoKind>('saml')
  const [enabled, setEnabled] = useState(false)
  const [emailDomain, setEmailDomain] = useState('')
  const [defaultRole, setDefaultRole] = useState<SsoDefaultRole>('reader')
  // SAML
  const [samlMetadataUrl, setSamlMetadataUrl] = useState('')
  const [samlEntityId, setSamlEntityId] = useState('')
  const [samlAcsUrl, setSamlAcsUrl] = useState('')
  // OIDC
  const [oidcIssuer, setOidcIssuer] = useState('')
  const [oidcClientId, setOidcClientId] = useState('')
  const [oidcClientSecret, setOidcClientSecret] = useState('')
  // attribute mapping
  const [attrPairs, setAttrPairs] = useState<KvPair[]>(
    objectToPairs({ email: 'mail', name: 'displayName' }),
  )
  const [attrJsonRaw, setAttrJsonRaw] = useState<string>('')
  const [attrJsonError, setAttrJsonError] = useState<string | null>(null)

  function reset() {
    setName('')
    setKind('saml')
    setEnabled(false)
    setEmailDomain('')
    setDefaultRole('reader')
    setSamlMetadataUrl('')
    setSamlEntityId('')
    setSamlAcsUrl('')
    setOidcIssuer('')
    setOidcClientId('')
    setOidcClientSecret('')
    setAttrPairs(objectToPairs({ email: 'mail', name: 'displayName' }))
    setAttrJsonRaw('')
    setAttrJsonError(null)
  }

  const createMut = useMutation({
    mutationFn: (body: CreateSsoProviderIn) => createSsoProvider(body),
    onSuccess: () => {
      toast.success('SSO 제공자가 생성되었습니다')
      reset()
      onCreated()
    },
    onError: (err) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      const msg = e.response?.data?.error?.message
      toast.error(msg ?? (err instanceof Error ? err.message : '생성 실패'))
    },
  })

  function resolveAttributeMapping(): Record<string, string> | null {
    // Prefer raw JSON if user typed something there.
    const raw = attrJsonRaw.trim()
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const out: Record<string, string> = {}
          for (const [k, v] of Object.entries(parsed)) {
            out[k] = String(v)
          }
          setAttrJsonError(null)
          return out
        }
        setAttrJsonError('객체 형태(JSON object)여야 합니다')
        return null
      } catch (err) {
        setAttrJsonError(err instanceof Error ? err.message : '잘못된 JSON')
        return null
      }
    }
    setAttrJsonError(null)
    return pairsToObject(attrPairs)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const mapping = resolveAttributeMapping()
    if (mapping === null) return
    const body: CreateSsoProviderIn = {
      name: name.trim(),
      kind,
      enabled,
      email_domain: emailDomain.trim() || null,
      default_role: defaultRole,
      attribute_mapping: mapping,
    }
    if (kind === 'saml') {
      body.saml_metadata_url = samlMetadataUrl.trim() || null
      body.saml_entity_id = samlEntityId.trim() || null
      body.saml_acs_url = samlAcsUrl.trim() || null
    } else {
      body.oidc_issuer = oidcIssuer.trim() || null
      body.oidc_client_id = oidcClientId.trim() || null
      body.oidc_client_secret = oidcClientSecret || null
    }
    createMut.mutate(body)
  }

  return (
    <Modal open={open} onClose={onClose} title="새 SSO 제공자" size="lg">
      <form
        onSubmit={onSubmit}
        className="space-y-4 text-sm"
        data-testid="sso-create-form"
      >
        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-gray-700">유형</legend>
          <div className="flex gap-3">
            {ALL_SSO_KINDS.map((k) => (
              <label key={k} className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="sso-kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  data-testid={`sso-kind-${k}`}
                />
                {KIND_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="block text-xs text-gray-600" htmlFor="sso-create-name">
            이름
          </label>
          <Input
            id="sso-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Samsung SSO"
            data-testid="sso-create-name"
            required
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600" htmlFor="sso-create-domain">
            이메일 도메인 (선택) — 일치하는 도메인 사용자는 자동으로 이 IdP 로 라우팅됩니다
          </label>
          <Input
            id="sso-create-domain"
            value={emailDomain}
            onChange={(e) => setEmailDomain(e.target.value)}
            placeholder="samsung.com"
            data-testid="sso-create-domain"
          />
        </div>

        {kind === 'saml' ? (
          <div className="space-y-3 rounded border border-gray-200 p-3">
            <div>
              <label className="block text-xs text-gray-600" htmlFor="sso-saml-metadata">
                Metadata URL
              </label>
              <Input
                id="sso-saml-metadata"
                value={samlMetadataUrl}
                onChange={(e) => setSamlMetadataUrl(e.target.value)}
                placeholder="https://idp.example/metadata"
                data-testid="sso-saml-metadata"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600" htmlFor="sso-saml-entity">
                Entity ID
              </label>
              <Input
                id="sso-saml-entity"
                value={samlEntityId}
                onChange={(e) => setSamlEntityId(e.target.value)}
                data-testid="sso-saml-entity"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600" htmlFor="sso-saml-acs">
                ACS URL
              </label>
              <Input
                id="sso-saml-acs"
                value={samlAcsUrl}
                onChange={(e) => setSamlAcsUrl(e.target.value)}
                data-testid="sso-saml-acs"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded border border-gray-200 p-3">
            <div>
              <label className="block text-xs text-gray-600" htmlFor="sso-oidc-issuer">
                Issuer
              </label>
              <Input
                id="sso-oidc-issuer"
                value={oidcIssuer}
                onChange={(e) => setOidcIssuer(e.target.value)}
                placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
                data-testid="sso-oidc-issuer"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600" htmlFor="sso-oidc-client-id">
                Client ID
              </label>
              <Input
                id="sso-oidc-client-id"
                value={oidcClientId}
                onChange={(e) => setOidcClientId(e.target.value)}
                data-testid="sso-oidc-client-id"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600" htmlFor="sso-oidc-client-secret">
                Client Secret
              </label>
              <Input
                id="sso-oidc-client-secret"
                value={oidcClientSecret}
                type="password"
                onChange={(e) => setOidcClientSecret(e.target.value)}
                data-testid="sso-oidc-client-secret"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-600" htmlFor="sso-default-role">
            기본 role (JIT 가입 시 적용)
          </label>
          <Select
            id="sso-default-role"
            value={defaultRole}
            onChange={(e) => setDefaultRole(e.target.value as SsoDefaultRole)}
            data-testid="sso-default-role"
          >
            {ALL_SSO_DEFAULT_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </Select>
        </div>

        <div>
          <label
            className="block text-xs text-gray-600"
            htmlFor="sso-attribute-mapping"
          >
            attribute mapping (JSON)
          </label>
          <textarea
            id="sso-attribute-mapping"
            value={attrJsonRaw}
            onChange={(e) => setAttrJsonRaw(e.target.value)}
            placeholder='{"email":"mail","name":"displayName","team":"department"}'
            rows={3}
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs"
            data-testid="sso-attribute-mapping"
          />
          {attrJsonError && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              {attrJsonError}
            </p>
          )}
          <p className="mt-1 text-[11px] text-gray-500">
            비워두면 기본값 (email, name) 이 적용됩니다.
          </p>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="sso-create-enabled"
          />
          <span className="text-sm">활성화</span>
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            type="submit"
            variant="primary"
            data-testid="sso-create-submit"
            disabled={createMut.isPending}
          >
            {createMut.isPending ? '저장 중…' : '저장'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
