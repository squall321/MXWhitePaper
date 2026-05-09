import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import {
  createApiToken,
  expiresInToISO,
  listApiTokens,
  revokeApiToken,
  rotateApiToken,
  type ApiTokenRow,
  type ApiTokenWithSecret,
  type TokenScope,
} from '@/features/api-tokens/api'

const ALL_SCOPES: TokenScope[] = ['read', 'write', 'admin']

const SCOPE_LABEL: Record<TokenScope, string> = {
  read: '읽기',
  write: '쓰기',
  admin: '관리자',
}

// 0024 — scope vocabulary now enforced server-side. The form copy below mirrors
// the rule table in `apps/api/app/services/api_token_scopes.py`.
const SCOPE_HELP: Record<TokenScope, string> = {
  read: '읽기 (read) — GET/HEAD on most endpoints',
  write: '쓰기 (write) — read + POST/PUT/PATCH/DELETE on non-admin endpoints',
  admin: '관리자 (admin) — read + write + /admin/* endpoints',
}

type ExpiresChoice = '1m' | '3m' | '1y' | 'never'

const EXPIRES_LABEL: Record<ExpiresChoice, string> = {
  '1m': '1개월',
  '3m': '3개월',
  '1y': '1년',
  never: '무기한',
}

/**
 * `/me/api-tokens` — 본인 personal access token 관리 페이지.
 *
 * BE 계약: full token 은 *생성/회전 직후 1회* 만 응답에 포함된다. 이후 모든
 * read 응답에서는 prefix 만 보이므로 모달에서 사용자가 즉시 복사할 수 있게
 * 강조해서 노출한다.
 */
export function ApiTokensPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [reveal, setReveal] = useState<ApiTokenWithSecret | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: listApiTokens,
  })

  const items = useMemo(() => data ?? [], [data])

  const onCreated = (t: ApiTokenWithSecret) => {
    setCreateOpen(false)
    setReveal(t)
    void qc.invalidateQueries({ queryKey: ['api-tokens'] })
  }

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-8"
      data-testid="api-tokens-page"
    >
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">개인 API 토큰</h1>
          <p className="mt-1 text-sm text-gray-600">
            스크립트/CI 에서 본인을 대신해 API 를 호출할 때 사용하세요.
            토큰은 비밀번호처럼 다뤄야 하며, 노출되었다면 즉시 폐기 또는
            회전하세요.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setCreateOpen(true)}
          data-testid="api-token-add"
        >
          + 새 토큰
        </Button>
      </header>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="토큰 목록을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          {items.length === 0 ? (
            <p
              className="px-4 py-8 text-center text-sm text-gray-500"
              data-testid="api-tokens-empty"
            >
              아직 발급된 토큰이 없어요. “새 토큰” 버튼으로 발급해 보세요.
            </p>
          ) : (
            <ul
              className="divide-y divide-gray-100 text-sm"
              data-testid="api-tokens-list"
            >
              {items.map((t) => (
                <TokenRow key={t.id} row={t} onRotated={onCreated} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <CreateTokenModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
      />

      <RevealTokenModal token={reveal} onClose={() => setReveal(null)} />
    </div>
  )
}

// ── Row ─────────────────────────────────────────────────────────────────

function TokenRow({
  row,
  onRotated,
}: {
  row: ApiTokenRow
  onRotated: (t: ApiTokenWithSecret) => void
}) {
  const qc = useQueryClient()
  const isRevoked = !!row.revoked_at
  const isExpired =
    !!row.expires_at && new Date(row.expires_at).getTime() < Date.now()
  const status: 'active' | 'revoked' | 'expired' = isRevoked
    ? 'revoked'
    : isExpired
      ? 'expired'
      : 'active'

  const remove = useMutation({
    mutationFn: () => revokeApiToken(row.id),
    onSuccess: () => {
      toast.success('토큰을 폐기했어요')
      void qc.invalidateQueries({ queryKey: ['api-tokens'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const rotate = useMutation({
    mutationFn: () => rotateApiToken(row.id),
    onSuccess: (t) => {
      toast.success('토큰을 회전했어요')
      onRotated(t)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  return (
    <li
      className="px-4 py-3"
      data-testid={`api-token-row-${row.id}`}
      data-status={status}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-smsg-900">{row.name}</span>
            <Badge
              tone={
                status === 'active'
                  ? 'success'
                  : status === 'expired'
                    ? 'warn'
                    : 'neutral'
              }
            >
              {status === 'active'
                ? '활성'
                : status === 'expired'
                  ? '만료'
                  : '폐기됨'}
            </Badge>
            {row.scopes.map((s) => (
              <Badge key={s} tone="brand" size="sm">
                {SCOPE_LABEL[s] ?? s}
              </Badge>
            ))}
            <code className="text-xs text-gray-700">{row.masked_token}</code>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            발급 {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
            {row.last_used_at && (
              <> · 마지막 사용 {new Date(row.last_used_at).toLocaleString()}</>
            )}
            {row.expires_at && (
              <> · 만료 {new Date(row.expires_at).toLocaleString()}</>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          {!isRevoked && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    '회전하면 기존 토큰은 즉시 무효화됩니다. 계속할까요?',
                  )
                ) {
                  rotate.mutate()
                }
              }}
              disabled={rotate.isPending}
              data-testid={`api-token-rotate-${row.id}`}
            >
              회전
            </Button>
          )}
          {!isRevoked && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm('이 토큰을 폐기할까요? 되돌릴 수 없어요.')) {
                  remove.mutate()
                }
              }}
              disabled={remove.isPending}
              data-testid={`api-token-revoke-${row.id}`}
            >
              취소
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

// ── Create modal ────────────────────────────────────────────────────────

function CreateTokenModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (t: ApiTokenWithSecret) => void
}) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<TokenScope[]>(['read'])
  const [expires, setExpires] = useState<ExpiresChoice>('3m')

  const create = useMutation({
    mutationFn: () =>
      createApiToken({
        name: name.trim(),
        scopes,
        expires_at: expiresInToISO(expires),
      }),
    onSuccess: (t) => {
      toast.success('토큰을 발급했어요')
      // reset form
      setName('')
      setScopes(['read'])
      setExpires('3m')
      onCreated(t)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const toggleScope = (s: TokenScope) => {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    )
  }

  const canSubmit = name.trim().length > 0 && scopes.length > 0 && !create.isPending

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="새 API 토큰"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            onClick={() => create.mutate()}
            disabled={!canSubmit}
            data-testid="api-token-create-submit"
          >
            발급
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) create.mutate()
        }}
      >
        <label className="block">
          <span className="block text-xs font-semibold text-gray-700">
            이름
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: ci-deploy-bot"
            data-testid="api-token-name"
            autoFocus
          />
        </label>

        <div>
          <span className="block text-xs font-semibold text-gray-700">
            권한 (scope)
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {ALL_SCOPES.map((s) => {
              const on = scopes.includes(s)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  data-testid={`api-token-scope-${s}`}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    on
                      ? 'border-smsg-700 bg-smsg-700 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-smsg-400'
                  }`}
                >
                  {SCOPE_LABEL[s]}
                </button>
              )
            })}
          </div>
          <ul
            className="mt-2 space-y-1 text-xs text-gray-500"
            data-testid="api-token-scope-help"
          >
            {ALL_SCOPES.map((s) => (
              <li key={s}>{SCOPE_HELP[s]}</li>
            ))}
          </ul>
        </div>

        <label className="block">
          <span className="block text-xs font-semibold text-gray-700">
            만료
          </span>
          <Select
            value={expires}
            onChange={(e) => setExpires(e.target.value as ExpiresChoice)}
            data-testid="api-token-expires"
          >
            {(Object.keys(EXPIRES_LABEL) as ExpiresChoice[]).map((c) => (
              <option key={c} value={c}>
                {EXPIRES_LABEL[c]}
              </option>
            ))}
          </Select>
        </label>
      </form>
    </Modal>
  )
}

// ── Reveal modal ────────────────────────────────────────────────────────

function RevealTokenModal({
  token,
  onClose,
}: {
  token: ApiTokenWithSecret | null
  onClose: () => void
}) {
  const open = !!token
  const onCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token.token)
      toast.success('클립보드에 복사했어요')
    } catch {
      toast.error('복사에 실패했어요 — 수동으로 선택해 주세요')
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="새 토큰을 안전하게 보관하세요"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="primary" onClick={onClose}>
            확인했어요
          </Button>
        </div>
      }
    >
      {token && (
        <div className="space-y-3 text-sm">
          <p
            className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="api-token-reveal-warning"
          >
            이 토큰은 이 한 번만 보입니다. 다시 표시할 수 없으니 지금 복사해서
            안전한 곳에 보관하세요.
          </p>
          <textarea
            readOnly
            value={token.token}
            data-testid="api-token-reveal-textarea"
            className="h-24 w-full resize-none rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>이름: {token.name}</span>
            <Button variant="secondary" size="sm" onClick={onCopy}>
              복사
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
