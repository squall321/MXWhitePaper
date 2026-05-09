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
  ALL_RETENTION_ACTIONS,
  ALL_RETENTION_TRIGGER_FIELDS,
  type CreateRetentionPolicyIn,
  type RetentionAction,
  type RetentionPolicy,
  type RetentionRun,
  type RetentionScopeFilter,
  type RetentionTriggerField,
  createRetentionPolicy,
  deleteRetentionPolicy,
  dryRunRetentionPolicy,
  listRetentionPolicies,
  listRetentionRuns,
  patchRetentionPolicy,
  runRetentionPolicy,
} from '@/features/retention/api'

const ACTION_LABELS: Record<RetentionAction, string> = {
  archive: '자동 보관',
  notify_owner: '소유자 알림',
  transition: '상태 전이',
}

const TRIGGER_FIELD_LABELS: Record<RetentionTriggerField, string> = {
  updated_at: '마지막 수정',
  last_read_at: '마지막 열람',
  created_at: '생성',
}

const STATUS_OPTIONS = [
  '',
  'draft',
  'in_review',
  'approved',
  'published',
  'archived',
] as const

/**
 * `/admin/retention` — time-based retention policies.
 *
 * Admin-only. Lists policies, lets the operator add/edit/delete, fire a
 * dry-run preview, run-now, and inspect the last 20 run-log entries per
 * policy. Complements the event-driven AutomationRules page.
 */
export function RetentionPoliciesPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [logPolicyId, setLogPolicyId] = useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['retention', 'policies'],
    queryFn: listRetentionPolicies,
  })

  const items = useMemo(() => data ?? [], [data])

  const onCreated = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['retention', 'policies'] })
  }, [qc])

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-8"
      data-testid="retention-policies-page"
    >
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">문서 보존 정책</h1>
          <p className="mt-1 text-sm text-gray-600">
            오래된 문서를 자동으로 보관/전이/알림 처리합니다. 시간 기반 (1시간 ticker).
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setCreateOpen(true)}
          data-testid="retention-add-button"
        >
          + 새 정책
        </Button>
      </header>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="보존 정책을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <ul
            className="divide-y divide-gray-100 text-sm"
            data-testid="retention-policies-list"
          >
            {items.map((p) => (
              <PolicyRow
                key={p.id}
                policy={p}
                onShowLog={() => setLogPolicyId(p.id)}
              />
            ))}
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-gray-500">
                등록된 보존 정책이 없습니다 — 우측 상단의 “새 정책” 으로 추가하세요.
              </li>
            )}
          </ul>
        </Card>
      )}

      <CreatePolicyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          onCreated()
        }}
      />

      <RunLogModal
        policyId={logPolicyId}
        onClose={() => setLogPolicyId(null)}
      />
    </div>
  )
}

// ── Row ─────────────────────────────────────────────────────────────────

function PolicyRow({
  policy,
  onShowLog,
}: {
  policy: RetentionPolicy
  onShowLog: () => void
}) {
  const qc = useQueryClient()

  const toggleEnabled = useMutation({
    mutationFn: () =>
      patchRetentionPolicy(policy.id, { enabled: !policy.enabled }),
    onSuccess: () => {
      toast.success(policy.enabled ? '비활성화됨' : '활성화됨')
      void qc.invalidateQueries({ queryKey: ['retention', 'policies'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const remove = useMutation({
    mutationFn: () => deleteRetentionPolicy(policy.id),
    onSuccess: () => {
      toast.success('삭제됨')
      void qc.invalidateQueries({ queryKey: ['retention', 'policies'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const dryRun = useMutation({
    mutationFn: () => dryRunRetentionPolicy(policy.id),
    onSuccess: (r) => {
      toast.success(`드라이런 — ${r.affected_doc_count}건 매칭`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const runNow = useMutation({
    mutationFn: () => runRetentionPolicy(policy.id),
    onSuccess: (r) => {
      toast.success(
        `즉시 실행 — ${r.status} (${r.affected_doc_count}건)${
          r.error_message ? ` (${r.error_message})` : ''
        }`,
      )
      void qc.invalidateQueries({ queryKey: ['retention', 'policies'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const sf = policy.scope_filter || {}
  const filterChips = [
    sf.status && `status=${sf.status}`,
    sf.tag && `tag=${sf.tag}`,
    sf.part_id && `part=${sf.part_id.slice(0, 8)}…`,
    sf.owner_id && `owner=${sf.owner_id.slice(0, 8)}…`,
  ].filter(Boolean) as string[]

  return (
    <li className="px-4 py-3" data-testid={`retention-row-${policy.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={policy.enabled ? 'success' : 'neutral'}>
              {policy.enabled ? '활성' : '비활성'}
            </Badge>
            <span className="font-medium text-smsg-900">{policy.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-700">
            <Badge tone="brand">
              {TRIGGER_FIELD_LABELS[policy.trigger_field] ??
                policy.trigger_field}{' '}
              ≥ {policy.trigger_age_days}일
            </Badge>
            <span className="text-gray-400">→</span>
            <Badge tone="brand">
              {ACTION_LABELS[policy.action] ?? policy.action}
            </Badge>
            {filterChips.map((c) => (
              <span
                key={c}
                className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-800"
              >
                {c}
              </span>
            ))}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            실행 {policy.run_count ?? 0}회
            {policy.last_run_at
              ? ` · 마지막 ${new Date(policy.last_run_at).toLocaleString()}`
              : ''}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => dryRun.mutate()}
            disabled={dryRun.isPending}
            data-testid={`retention-dryrun-${policy.id}`}
          >
            드라이런
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            data-testid={`retention-run-${policy.id}`}
          >
            즉시 실행
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onShowLog}
            data-testid={`retention-log-${policy.id}`}
          >
            실행 로그
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleEnabled.mutate()}
            disabled={toggleEnabled.isPending}
            data-testid={`retention-toggle-${policy.id}`}
          >
            {policy.enabled ? '비활성화' : '활성화'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (window.confirm('정말 삭제하시겠습니까?')) remove.mutate()
            }}
            disabled={remove.isPending}
            data-testid={`retention-delete-${policy.id}`}
          >
            삭제
          </Button>
        </div>
      </div>
    </li>
  )
}

// ── Create modal ────────────────────────────────────────────────────────

function CreatePolicyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [action, setAction] = useState<RetentionAction>('archive')
  const [triggerField, setTriggerField] =
    useState<RetentionTriggerField>('updated_at')
  const [ageDays, setAgeDays] = useState('90')
  const [scopePart, setScopePart] = useState('')
  const [scopeTag, setScopeTag] = useState('')
  const [scopeStatus, setScopeStatus] = useState('')
  const [scopeOwner, setScopeOwner] = useState('')
  const [targetStatus, setTargetStatus] = useState('archived')
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName('')
    setAction('archive')
    setTriggerField('updated_at')
    setAgeDays('90')
    setScopePart('')
    setScopeTag('')
    setScopeStatus('')
    setScopeOwner('')
    setTargetStatus('archived')
  }

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error('이름을 입력하세요')
      return
    }
    const ageNum = Number.parseInt(ageDays, 10)
    if (!Number.isFinite(ageNum) || ageNum <= 0) {
      toast.error('trigger_age_days 는 양의 정수여야 합니다')
      return
    }
    const scope: RetentionScopeFilter = {}
    if (scopePart.trim()) scope.part_id = scopePart.trim()
    if (scopeTag.trim()) scope.tag = scopeTag.trim()
    if (scopeStatus.trim()) scope.status = scopeStatus.trim()
    if (scopeOwner.trim()) scope.owner_id = scopeOwner.trim()

    const payload: CreateRetentionPolicyIn = {
      name: name.trim(),
      scope_filter: scope,
      action,
      action_payload:
        action === 'transition' ? { target_status: targetStatus } : {},
      trigger_age_days: ageNum,
      trigger_field: triggerField,
      enabled: true,
    }
    setSubmitting(true)
    try {
      await createRetentionPolicy(payload)
      toast.success('등록됨')
      reset()
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '등록 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="새 보존 정책"
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
            data-testid="retention-create-submit"
          >
            {submitting ? '등록 중…' : '등록'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4 text-sm">
        <div>
          <label className="block text-xs text-gray-600">이름</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 60일 미수정 초안 자동 보관"
            data-testid="retention-create-name"
          />
        </div>

        <fieldset className="rounded border border-gray-200 px-3 py-2">
          <legend className="px-1 text-xs text-gray-500">트리거</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-600">기준 필드</label>
              <Select
                value={triggerField}
                onChange={(e) =>
                  setTriggerField(e.target.value as RetentionTriggerField)
                }
                data-testid="retention-create-trigger-field"
              >
                {ALL_RETENTION_TRIGGER_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {TRIGGER_FIELD_LABELS[f]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-gray-600">
                age (일)
              </label>
              <Input
                type="number"
                min={1}
                value={ageDays}
                onChange={(e) => setAgeDays(e.target.value)}
                data-testid="retention-create-age-days"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded border border-gray-200 px-3 py-2">
          <legend className="px-1 text-xs text-gray-500">
            scope_filter (선택, 모두 비워도 됨)
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-600">part_id</label>
              <Input
                value={scopePart}
                onChange={(e) => setScopePart(e.target.value)}
                placeholder="UUID"
                data-testid="retention-create-scope-part"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">tag</label>
              <Input
                value={scopeTag}
                onChange={(e) => setScopeTag(e.target.value)}
                placeholder="예: legacy"
                data-testid="retention-create-scope-tag"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">status</label>
              <Select
                value={scopeStatus}
                onChange={(e) => setScopeStatus(e.target.value)}
                data-testid="retention-create-scope-status"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s || 'any'} value={s}>
                    {s || '(any)'}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-gray-600">owner_id</label>
              <Input
                value={scopeOwner}
                onChange={(e) => setScopeOwner(e.target.value)}
                placeholder="UUID"
                data-testid="retention-create-scope-owner"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded border border-gray-200 px-3 py-2">
          <legend className="px-1 text-xs text-gray-500">액션</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-600">종류</label>
              <Select
                value={action}
                onChange={(e) => setAction(e.target.value as RetentionAction)}
                data-testid="retention-create-action"
              >
                {ALL_RETENTION_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
              </Select>
            </div>
            {action === 'transition' && (
              <div>
                <label className="block text-xs text-gray-600">
                  target_status
                </label>
                <Select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value)}
                  data-testid="retention-create-target-status"
                >
                  {STATUS_OPTIONS.filter((s) => s).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {action === 'archive' &&
              'status 를 archived 로 전환 + audit_logs 기록.'}
            {action === 'notify_owner' &&
              'documents.owner_id 에게 retention_warning 알림을 INSERT.'}
            {action === 'transition' &&
              'status 를 target_status 로 전환 + audit_logs 기록.'}
          </p>
        </fieldset>
      </div>
    </Modal>
  )
}

// ── Run-log modal ───────────────────────────────────────────────────────

function RunLogModal({
  policyId,
  onClose,
}: {
  policyId: string | null
  onClose: () => void
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['retention', 'runs', policyId],
    queryFn: () => listRetentionRuns(policyId!, 20),
    enabled: policyId !== null,
  })

  return (
    <Modal
      open={policyId !== null}
      onClose={onClose}
      title="실행 로그 (최근 20건)"
      size="lg"
    >
      <div className="px-5 py-4 text-sm" data-testid="retention-runs-modal">
        {isPending && <p className="text-gray-500">불러오는 중…</p>}
        {isError && (
          <p className="text-red-600">
            {error instanceof Error ? error.message : '오류'}
          </p>
        )}
        {data && data.length === 0 && (
          <p className="text-gray-500">아직 실행 기록이 없습니다.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {data.map((r: RetentionRun) => (
              <li key={r.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge
                    tone={
                      r.status === 'ok'
                        ? 'success'
                        : r.status === 'dry_run'
                          ? 'warn'
                          : 'error'
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="font-medium">
                    {r.affected_doc_count}건 매칭
                  </span>
                  <span className="ml-auto text-gray-500">
                    {r.run_at ? new Date(r.run_at).toLocaleString() : '—'}
                  </span>
                </div>
                {r.error_message && (
                  <p className="mt-1 text-xs text-red-700">
                    {r.error_message}
                  </p>
                )}
                {r.doc_slugs && r.doc_slugs.length > 0 && (
                  <p className="mt-1 text-xs text-gray-600">
                    {r.doc_slugs.slice(0, 10).join(', ')}
                    {r.doc_slugs.length > 10
                      ? ` (+${r.doc_slugs.length - 10})`
                      : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
