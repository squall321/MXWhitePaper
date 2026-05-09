import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import {
  ALL_WEBHOOK_EVENTS,
  createWebhook,
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  patchWebhook,
  testWebhook,
  type Webhook,
  type WebhookDelivery,
  type WebhookEventKind,
  type WebhookScope,
} from '@/features/webhooks/api'

const EVENT_LABELS: Record<WebhookEventKind, string> = {
  doc_created: '문서 생성',
  doc_edited: '문서 편집',
  doc_published: '문서 공개',
  comment_added: '댓글 작성',
  review_decided: '리뷰 결정',
}

/**
 * `/admin/webhooks` — outgoing webhook 관리.
 *
 * 일반 사용자는 자기 소유의 user-scoped 훅 + 활성화된 org 훅을 본다.
 * admin 은 전체 조직 훅까지 본다 + org-scoped 훅을 만들 수 있다.
 *
 * `secret` 은 *생성 직후 모달* 에서만 평문으로 노출된다 — 모달을 닫으면
 * 다시 볼 수 없으므로 복사 버튼을 함께 제공한다.
 */
export function WebhooksSettingsPage() {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const isAdmin = role === 'admin'
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [secretReveal, setSecretReveal] = useState<{ id: string; secret: string } | null>(
    null,
  )
  const [logHookId, setLogHookId] = useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['webhooks'],
    queryFn: listWebhooks,
  })

  const items = useMemo(() => data ?? [], [data])

  const onCreated = useCallback(
    (h: Webhook) => {
      // BE returned the secret in plaintext exactly once on create.
      setSecretReveal({ id: h.id, secret: h.secret })
      void qc.invalidateQueries({ queryKey: ['webhooks'] })
    },
    [qc],
  )

  return (
    <div className="mx-auto max-w-5xl px-6 py-8" data-testid="webhooks-settings-page">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">웹훅 (Webhooks)</h1>
          <p className="mt-1 text-sm text-gray-600">
            문서 편집·공개·댓글·리뷰 결정 이벤트를 외부 도구(Slack/Discord/Teams/...) 로
            푸시합니다. 본문은 HMAC-SHA256 으로 서명되어 X-MXWP-Signature 헤더에 들어가요.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setCreateOpen(true)}
          data-testid="webhook-add-button"
        >
          + 새 웹훅
        </Button>
      </header>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="웹훅 목록을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <ul
            className="divide-y divide-gray-100 text-sm"
            data-testid="webhooks-list"
          >
            {items.map((h) => (
              <WebhookRow
                key={h.id}
                hook={h}
                isAdmin={isAdmin}
                ownIt={h.owner_user_id === user?.id}
                onShowDeliveries={() => setLogHookId(h.id)}
              />
            ))}
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-gray-500">
                등록된 웹훅이 없습니다 — 우측 상단의 “새 웹훅” 으로 추가하세요.
              </li>
            )}
          </ul>
        </Card>
      )}

      <CreateWebhookModal
        open={createOpen}
        isAdmin={isAdmin}
        onClose={() => setCreateOpen(false)}
        onCreated={(h) => {
          setCreateOpen(false)
          onCreated(h)
        }}
      />

      <SecretRevealModal
        secret={secretReveal?.secret ?? null}
        onClose={() => setSecretReveal(null)}
      />

      <DeliveriesModal
        hookId={logHookId}
        onClose={() => setLogHookId(null)}
      />
    </div>
  )
}

// ── Row ────────────────────────────────────────────────────────────────

function WebhookRow({
  hook,
  isAdmin,
  ownIt,
  onShowDeliveries,
}: {
  hook: Webhook
  isAdmin: boolean
  ownIt: boolean
  onShowDeliveries: () => void
}) {
  const qc = useQueryClient()
  const canEdit = isAdmin || ownIt

  const toggleEnabled = useMutation({
    mutationFn: () => patchWebhook(hook.id, { enabled: !hook.enabled }),
    onSuccess: () => {
      toast.success(hook.enabled ? '비활성화됨' : '활성화됨')
      void qc.invalidateQueries({ queryKey: ['webhooks'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const remove = useMutation({
    mutationFn: () => deleteWebhook(hook.id),
    onSuccess: () => {
      toast.success('삭제됨')
      void qc.invalidateQueries({ queryKey: ['webhooks'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const fireTest = useMutation({
    mutationFn: () => testWebhook(hook.id),
    onSuccess: (r) => {
      toast.success(`테스트 발송 — ${r.last_status} (${r.http_status ?? 'no-resp'})`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  return (
    <li className="px-4 py-3" data-testid={`webhook-row-${hook.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={hook.enabled ? 'success' : 'neutral'}>
              {hook.enabled ? '활성' : '비활성'}
            </Badge>
            <Badge tone="brand">{hook.scope}</Badge>
            {hook.last_status && (
              <Badge
                tone={
                  hook.last_status === 'ok'
                    ? 'success'
                    : hook.last_status === '4xx'
                      ? 'warn'
                      : 'error'
                }
              >
                {hook.last_status}
              </Badge>
            )}
            <code className="truncate text-xs text-gray-700">{hook.url}</code>
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-600">
            {hook.events.map((e) => (
              <span
                key={e}
                className="rounded bg-gray-100 px-2 py-0.5 text-gray-700"
              >
                {EVENT_LABELS[e] ?? e}
              </span>
            ))}
            {hook.filter_part_ids.length > 0 && (
              <span className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-800">
                part 필터 {hook.filter_part_ids.length}개
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            등록 {hook.created_at ? new Date(hook.created_at).toLocaleString() : '—'}
            {hook.last_attempted_at && (
              <>
                {' · '}마지막 전송 {new Date(hook.last_attempted_at).toLocaleString()}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fireTest.mutate()}
            disabled={fireTest.isPending}
            data-testid={`webhook-test-${hook.id}`}
          >
            테스트 발송
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onShowDeliveries}
            data-testid={`webhook-log-${hook.id}`}
          >
            전송 로그
          </Button>
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => toggleEnabled.mutate()}
                disabled={toggleEnabled.isPending}
                data-testid={`webhook-toggle-${hook.id}`}
              >
                {hook.enabled ? '비활성화' : '활성화'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (window.confirm('정말 삭제하시겠습니까?')) remove.mutate()
                }}
                disabled={remove.isPending}
                data-testid={`webhook-delete-${hook.id}`}
              >
                삭제
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}

// ── Create modal ───────────────────────────────────────────────────────

function CreateWebhookModal({
  open,
  isAdmin,
  onClose,
  onCreated,
}: {
  open: boolean
  isAdmin: boolean
  onClose: () => void
  onCreated: (h: Webhook) => void
}) {
  const [url, setUrl] = useState('')
  const [scope, setScope] = useState<WebhookScope>('user')
  const [events, setEvents] = useState<WebhookEventKind[]>(['doc_edited'])
  const [partIds, setPartIds] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setUrl('')
    setScope('user')
    setEvents(['doc_edited'])
    setPartIds('')
  }

  const onSubmit = async () => {
    if (!url.trim()) {
      toast.error('URL 을 입력하세요')
      return
    }
    if (events.length === 0) {
      toast.error('이벤트를 1개 이상 선택하세요')
      return
    }
    setSubmitting(true)
    try {
      const filter = partIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const body = {
        url: url.trim(),
        scope,
        events,
        filter_part_ids: filter,
      }
      const created = await createWebhook(body)
      reset()
      onCreated(created)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '등록 실패')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleEvent = (e: WebhookEventKind) => {
    setEvents((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e],
    )
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="새 웹훅 등록"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button
            variant="primary"
            onClick={() => void onSubmit()}
            disabled={submitting}
            data-testid="webhook-create-submit"
          >
            {submitting ? '등록 중…' : '등록'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4 text-sm">
        <div>
          <label className="block text-xs text-gray-600">URL</label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/..."
            data-testid="webhook-create-url"
          />
        </div>
        {isAdmin && (
          <div>
            <label className="block text-xs text-gray-600">스코프</label>
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as WebhookScope)}
              data-testid="webhook-create-scope"
            >
              <option value="user">user (내 계정 전용)</option>
              <option value="org">org (조직 전체 — admin)</option>
            </Select>
          </div>
        )}
        <div>
          <span className="block text-xs text-gray-600">이벤트</span>
          <div
            className="mt-1 flex flex-wrap gap-2"
            data-testid="webhook-create-events"
          >
            {ALL_WEBHOOK_EVENTS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => toggleEvent(e)}
                className={
                  'rounded-full border px-3 py-1 text-xs transition-colors ' +
                  (events.includes(e)
                    ? 'border-smsg-700 bg-smsg-700 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50')
                }
                data-testid={`webhook-event-${e}`}
              >
                {EVENT_LABELS[e]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600">
            part 필터 (선택, 쉼표 구분 UUID)
          </label>
          <Input
            value={partIds}
            onChange={(e) => setPartIds(e.target.value)}
            placeholder="(비워두면 모든 part)"
            data-testid="webhook-create-parts"
          />
        </div>
      </div>
    </Modal>
  )
}

// ── Secret reveal modal ────────────────────────────────────────────────

function SecretRevealModal({
  secret,
  onClose,
}: {
  secret: string | null
  onClose: () => void
}) {
  const onCopy = () => {
    if (!secret) return
    void navigator.clipboard?.writeText(secret).then(
      () => toast.success('복사됨'),
      () => toast.error('복사 실패'),
    )
  }
  return (
    <Modal
      open={secret !== null}
      onClose={onClose}
      title="비밀키 (한 번만 표시됩니다)"
      size="md"
      staticBackdrop
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCopy} data-testid="webhook-secret-copy">
            복사
          </Button>
          <Button variant="primary" onClick={onClose}>
            확인
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4 text-sm">
        <p className="text-gray-700">
          이 비밀키는 HMAC 서명에 사용됩니다. <strong>지금 복사하세요</strong> — 모달을 닫으면 더 이상 평문으로 볼 수 없습니다.
        </p>
        <code
          className="block break-all rounded bg-gray-50 p-3 text-xs"
          data-testid="webhook-secret-value"
        >
          {secret ?? ''}
        </code>
      </div>
    </Modal>
  )
}

// ── Deliveries modal ───────────────────────────────────────────────────

function DeliveriesModal({
  hookId,
  onClose,
}: {
  hookId: string | null
  onClose: () => void
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['webhooks', hookId, 'deliveries'],
    queryFn: () => listDeliveries(hookId!),
    enabled: hookId !== null,
  })

  return (
    <Modal
      open={hookId !== null}
      onClose={onClose}
      title="최근 전송 로그 (20건)"
      size="lg"
    >
      <div className="px-5 py-4 text-sm" data-testid="webhook-deliveries-modal">
        {isPending && <p className="text-gray-500">불러오는 중…</p>}
        {isError && (
          <p className="text-red-600">
            {error instanceof Error ? error.message : '오류'}
          </p>
        )}
        {data && data.length === 0 && (
          <p className="text-gray-500">아직 전송 기록이 없습니다.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {data.map((d: WebhookDelivery) => (
              <li key={d.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="brand">{d.event_kind}</Badge>
                  <span className="text-gray-700">
                    HTTP {d.http_status ?? '—'}
                  </span>
                  {d.retry_count > 0 && (
                    <span className="text-yellow-700">retry #{d.retry_count}</span>
                  )}
                  <span className="ml-auto text-gray-500">
                    {d.attempted_at
                      ? new Date(d.attempted_at).toLocaleString()
                      : '—'}
                  </span>
                </div>
                {d.response_body && (
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">
                    {d.response_body}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
