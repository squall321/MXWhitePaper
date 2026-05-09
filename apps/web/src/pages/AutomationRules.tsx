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
  ALL_AUTOMATION_ACTIONS,
  ALL_AUTOMATION_TRIGGERS,
  COMMON_CRON_TIMEZONES,
  type AutomationActionKind,
  type AutomationRule,
  type AutomationRunLog,
  type AutomationTriggerKind,
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  listAutomationRuns,
  patchAutomationRule,
  testAutomationRule,
} from '@/features/automation/api'
import { nextRun, parseCron, relativeTimeKo } from '@/features/automation/cron'

const TRIGGER_LABELS: Record<AutomationTriggerKind, string> = {
  doc_published: '문서 공개',
  doc_archived: '문서 보관',
  review_decided: '리뷰 결정',
  status_transition: '상태 전이',
  comment_added: '댓글 작성',
  tag_added: '태그 추가',
  cron: '예약 (cron)',
}

interface CronPreset {
  label: string
  expr: string
}

const CRON_PRESETS: CronPreset[] = [
  { label: '매분', expr: '* * * * *' },
  { label: '매시간', expr: '0 * * * *' },
  { label: '매일 자정', expr: '0 0 * * *' },
  { label: '매일 오전 9시', expr: '0 9 * * *' },
  { label: '매주 월요일 9시', expr: '0 9 * * 1' },
  { label: '매월 1일 9시', expr: '0 9 1 * *' },
]

const ACTION_LABELS: Record<AutomationActionKind, string> = {
  webhook: '웹훅 호출',
  notification_blast: '전체 알림',
  add_tag: '태그 추가',
  remove_tag: '태그 제거',
  transition: '상태 전이',
  email_subscribers: '구독자 이메일',
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

function objectToPairs(obj: Record<string, unknown>): KvPair[] {
  return Object.entries(obj || {}).map(([k, v]) => ({
    k,
    v: typeof v === 'string' ? v : JSON.stringify(v),
  }))
}

/**
 * `/admin/automation` — workflow automation rules.
 *
 * Admin-only. Lists rules, lets the operator add/edit/delete, fire a
 * dry-run test, and inspect the last 50 run-log entries per rule.
 */
export function AutomationRulesPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [logRuleId, setLogRuleId] = useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['automation', 'rules'],
    queryFn: listAutomationRules,
  })

  const items = useMemo(() => data ?? [], [data])

  const onCreated = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['automation', 'rules'] })
  }, [qc])

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-8"
      data-testid="automation-rules-page"
    >
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">
            워크플로우 자동화
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            트리거(이벤트) × 액션(웹훅/알림/태그/전이/이메일) 을 조합해 자동 처리 규칙을 만듭니다.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setCreateOpen(true)}
          data-testid="automation-add-button"
        >
          + 새 규칙
        </Button>
      </header>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="자동화 규칙을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <ul
            className="divide-y divide-gray-100 text-sm"
            data-testid="automation-rules-list"
          >
            {items.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onShowLog={() => setLogRuleId(rule.id)}
              />
            ))}
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-gray-500">
                등록된 자동화 규칙이 없습니다 — 우측 상단의 “새 규칙” 으로 추가하세요.
              </li>
            )}
          </ul>
        </Card>
      )}

      <CreateRuleModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          onCreated()
        }}
      />

      <RunLogModal ruleId={logRuleId} onClose={() => setLogRuleId(null)} />
    </div>
  )
}

// ── Row ─────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  onShowLog,
}: {
  rule: AutomationRule
  onShowLog: () => void
}) {
  const qc = useQueryClient()

  const toggleEnabled = useMutation({
    mutationFn: () => patchAutomationRule(rule.id, { enabled: !rule.enabled }),
    onSuccess: () => {
      toast.success(rule.enabled ? '비활성화됨' : '활성화됨')
      void qc.invalidateQueries({ queryKey: ['automation', 'rules'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const remove = useMutation({
    mutationFn: () => deleteAutomationRule(rule.id),
    onSuccess: () => {
      toast.success('삭제됨')
      void qc.invalidateQueries({ queryKey: ['automation', 'rules'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const fireTest = useMutation({
    mutationFn: () => testAutomationRule(rule.id, { dry_run: true }),
    onSuccess: (r) => {
      toast.success(
        `테스트 실행 — ${r.status}${r.error_message ? ` (${r.error_message})` : ''}`,
      )
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  return (
    <li className="px-4 py-3" data-testid={`automation-row-${rule.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={rule.enabled ? 'success' : 'neutral'}>
              {rule.enabled ? '활성' : '비활성'}
            </Badge>
            <span className="font-medium text-smsg-900">{rule.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-700">
            <Badge tone="brand">
              {TRIGGER_LABELS[rule.trigger_kind] ?? rule.trigger_kind}
            </Badge>
            <span className="text-gray-400">→</span>
            <Badge tone="brand">
              {ACTION_LABELS[rule.action_kind] ?? rule.action_kind}
            </Badge>
            {Object.keys(rule.trigger_filter || {}).length > 0 && (
              <span className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-800">
                필터 {Object.keys(rule.trigger_filter).length}개
              </span>
            )}
            {rule.trigger_kind === 'cron' && rule.cron_expression && (
              <span
                className="rounded bg-blue-100 px-2 py-0.5 font-mono text-blue-800"
                data-testid={`automation-row-cron-${rule.id}`}
              >
                {rule.cron_expression}
                {rule.cron_timezone && rule.cron_timezone !== 'UTC'
                  ? ` (${rule.cron_timezone})`
                  : ''}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            발화 {rule.fire_count}회
            {rule.last_fired_at
              ? ` · 마지막 ${new Date(rule.last_fired_at).toLocaleString()}`
              : ''}
            {rule.trigger_kind === 'cron' && rule.next_cron_run_at
              ? ` · 다음 ${new Date(rule.next_cron_run_at).toLocaleString()}`
              : ''}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fireTest.mutate()}
            disabled={fireTest.isPending}
            data-testid={`automation-test-${rule.id}`}
          >
            테스트 실행
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onShowLog}
            data-testid={`automation-log-${rule.id}`}
          >
            실행 로그
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleEnabled.mutate()}
            disabled={toggleEnabled.isPending}
            data-testid={`automation-toggle-${rule.id}`}
          >
            {rule.enabled ? '비활성화' : '활성화'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (window.confirm('정말 삭제하시겠습니까?')) remove.mutate()
            }}
            disabled={remove.isPending}
            data-testid={`automation-delete-${rule.id}`}
          >
            삭제
          </Button>
        </div>
      </div>
    </li>
  )
}

// ── Create modal ────────────────────────────────────────────────────────

function CreateRuleModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<AutomationTriggerKind>('doc_published')
  const [filterPairs, setFilterPairs] = useState<KvPair[]>([])
  const [action, setAction] = useState<AutomationActionKind>('webhook')
  const [actionPairs, setActionPairs] = useState<KvPair[]>([
    { k: 'url', v: '' },
  ])
  const [cronExpr, setCronExpr] = useState('0 9 * * 1')
  const [cronTz, setCronTz] = useState<string>('UTC')
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName('')
    setTrigger('doc_published')
    setFilterPairs([])
    setAction('webhook')
    setActionPairs([{ k: 'url', v: '' }])
    setCronExpr('0 9 * * 1')
    setCronTz('UTC')
  }

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error('이름을 입력하세요')
      return
    }
    if (trigger === 'cron') {
      try {
        parseCron(cronExpr)
      } catch (e) {
        toast.error(`cron 식이 올바르지 않습니다: ${e instanceof Error ? e.message : ''}`)
        return
      }
    }
    setSubmitting(true)
    try {
      await createAutomationRule({
        name: name.trim(),
        trigger_kind: trigger,
        trigger_filter: pairsToObject(filterPairs),
        action_kind: action,
        action_payload: pairsToObject(actionPairs),
        enabled: true,
        ...(trigger === 'cron'
          ? { cron_expression: cronExpr.trim(), cron_timezone: cronTz }
          : {}),
      })
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
      title="새 자동화 규칙"
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
            data-testid="automation-create-submit"
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
            placeholder="예: 문서 공개 시 슬랙 알림"
            data-testid="automation-create-name"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">트리거</label>
          <Select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as AutomationTriggerKind)}
            data-testid="automation-create-trigger"
          >
            {ALL_AUTOMATION_TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        {trigger === 'cron' ? (
          <CronEditor
            expr={cronExpr}
            setExpr={setCronExpr}
            tz={cronTz}
            setTz={setCronTz}
          />
        ) : (
          <KvEditor
            label="트리거 필터 (선택, 키=값 동등 매칭)"
            pairs={filterPairs}
            setPairs={setFilterPairs}
            testId="automation-filter"
          />
        )}
        <div>
          <label className="block text-xs text-gray-600">액션</label>
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value as AutomationActionKind)}
            data-testid="automation-create-action"
          >
            {ALL_AUTOMATION_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-gray-500">
            {action === 'webhook' &&
              'action_payload: { url, secret? } — 원격 엔드포인트로 POST'}
            {action === 'notification_blast' &&
              'action_payload: { kind, message_template } — 활성 사용자 전체에 알림'}
            {(action === 'add_tag' || action === 'remove_tag') &&
              'action_payload: { tag } — 트리거 문서의 metadata.tags 변경'}
            {action === 'transition' &&
              'action_payload: { status: draft|in_review|approved|published|archived }'}
            {action === 'email_subscribers' &&
              'action_payload: { subject?, body? } — 구독자 전원에게 이메일'}
          </p>
        </div>
        <KvEditor
          label="액션 페이로드"
          pairs={actionPairs}
          setPairs={setActionPairs}
          testId="automation-action-payload"
        />
      </div>
    </Modal>
  )
}

function KvEditor({
  label,
  pairs,
  setPairs,
  testId,
}: {
  label: string
  pairs: KvPair[]
  setPairs: (pairs: KvPair[]) => void
  testId: string
}) {
  const update = (i: number, patch: Partial<KvPair>) => {
    const out = pairs.slice()
    const cur = out[i] ?? { k: '', v: '' }
    out[i] = { k: cur.k, v: cur.v, ...patch }
    setPairs(out)
  }
  const remove = (i: number) => {
    const out = pairs.slice()
    out.splice(i, 1)
    setPairs(out)
  }
  const add = () => setPairs([...pairs, { k: '', v: '' }])
  return (
    <div data-testid={`${testId}-editor`}>
      <span className="block text-xs text-gray-600">{label}</span>
      <div className="mt-1 space-y-1">
        {pairs.map((p, i) => (
          <div key={i} className="flex gap-1">
            <Input
              value={p.k}
              onChange={(e) => update(i, { k: e.target.value })}
              placeholder="key"
              data-testid={`${testId}-key-${i}`}
            />
            <Input
              value={p.v}
              onChange={(e) => update(i, { v: e.target.value })}
              placeholder="value"
              data-testid={`${testId}-value-${i}`}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove(i)}
              data-testid={`${testId}-remove-${i}`}
            >
              삭제
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={add}
          data-testid={`${testId}-add`}
        >
          + 항목 추가
        </Button>
      </div>
    </div>
  )
}

// ── Cron editor ─────────────────────────────────────────────────────────

function CronEditor({
  expr,
  setExpr,
  tz,
  setTz,
}: {
  expr: string
  setExpr: (e: string) => void
  tz: string
  setTz: (t: string) => void
}) {
  // Live-validate + compute next firing for the helper line. The FE
  // ``parseCron`` mirror is timezone-agnostic; the preview text echoes
  // the chosen tz so admins know what they're seeing.
  const preview = useMemo(() => {
    try {
      const parsed = parseCron(expr)
      const now = new Date()
      const nxt = nextRun(parsed, now)
      return {
        ok: true as const,
        when: nxt,
        rel: relativeTimeKo(now, nxt),
      }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : '' }
    }
  }, [expr])

  return (
    <div data-testid="automation-cron-editor">
      <label className="block text-xs text-gray-600">cron 표현식</label>
      <Input
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        placeholder="예: 0 9 * * 1 — 매주 월요일 오전 9시"
        data-testid="automation-cron-input"
      />
      <div className="mt-1 flex flex-wrap gap-1">
        {CRON_PRESETS.map((p) => (
          <button
            key={p.expr}
            type="button"
            onClick={() => setExpr(p.expr)}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
            data-testid={`automation-cron-preset-${p.expr.replace(/\s+/g, '_')}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="mt-2 block text-xs text-gray-600">시간대</label>
      <Select
        value={tz}
        onChange={(e) => setTz(e.target.value)}
        data-testid="automation-cron-timezone"
      >
        {COMMON_CRON_TIMEZONES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <p
        className={`mt-1 text-xs ${preview.ok ? 'text-gray-600' : 'text-red-600'}`}
        data-testid="automation-cron-preview"
      >
        {preview.ok
          ? `다음 실행: ${preview.when.toLocaleString()} (${preview.rel}, ${tz})`
          : `오류: ${preview.error}`}
      </p>
      <p className="mt-1 text-[11px] text-gray-500">
        형식: 분 시 일 월 요일 — 5칸. *, , (목록), - (범위), / (간격), ? 지원. 선택한 시간대 기준.
      </p>
    </div>
  )
}

// ── Run-log modal ───────────────────────────────────────────────────────

function RunLogModal({
  ruleId,
  onClose,
}: {
  ruleId: string | null
  onClose: () => void
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['automation', 'runs', ruleId],
    queryFn: () => listAutomationRuns(ruleId!, 50),
    enabled: ruleId !== null,
  })

  return (
    <Modal
      open={ruleId !== null}
      onClose={onClose}
      title="실행 로그 (최근 50건)"
      size="lg"
    >
      <div className="px-5 py-4 text-sm" data-testid="automation-runs-modal">
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
            {data.map((r: AutomationRunLog) => (
              <li key={r.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge
                    tone={
                      r.status === 'ok'
                        ? 'success'
                        : r.status === 'skipped'
                          ? 'warn'
                          : 'error'
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="ml-auto text-gray-500">
                    {r.triggered_at
                      ? new Date(r.triggered_at).toLocaleString()
                      : '—'}
                  </span>
                </div>
                {r.error_message && (
                  <p className="mt-1 text-xs text-red-700">
                    {r.error_message}
                  </p>
                )}
                {r.trigger_payload && (
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">
                    {JSON.stringify(r.trigger_payload, null, 2)}
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
