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
  type AutomationActionKind,
} from '@/features/automation/api'
import {
  ALL_FAIL_STRATEGIES,
  type FailStrategy,
  type StepInput,
  type WorkflowChain,
  type WorkflowChainRun,
  createWorkflowChain,
  deleteWorkflowChain,
  listWorkflowChainRuns,
  listWorkflowChains,
  patchWorkflowChain,
  runWorkflowChainNow,
} from '@/features/workflow-chains/api'

const ACTION_LABELS: Record<AutomationActionKind | 'trigger_chain', string> = {
  webhook: '웹훅 호출',
  notification_blast: '전체 알림',
  add_tag: '태그 추가',
  remove_tag: '태그 제거',
  transition: '상태 전이',
  email_subscribers: '구독자 이메일',
  trigger_chain: '체인 실행',
}

const FAIL_LABELS: Record<FailStrategy, string> = {
  halt: '중단',
  continue: '계속',
  rollback: '되돌리기',
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

interface DraftStep {
  ordering: number
  action_kind: string
  payload_pairs: KvPair[]
  delay_seconds: number
  fail_strategy: FailStrategy
}

function emptyStep(ordering: number): DraftStep {
  return {
    ordering,
    action_kind: 'webhook',
    payload_pairs: [{ k: 'url', v: '' }],
    delay_seconds: 0,
    fail_strategy: 'halt',
  }
}

function draftToInput(d: DraftStep): StepInput {
  return {
    ordering: d.ordering,
    action_kind: d.action_kind,
    action_payload: pairsToObject(d.payload_pairs),
    delay_seconds: d.delay_seconds,
    fail_strategy: d.fail_strategy,
  }
}

/**
 * `/admin/workflow-chains` — multi-step automation chains.
 *
 * Admin-only. Lists chains + step count + last run, lets the operator
 * add/edit/delete, fire immediate runs, and inspect run history.
 */
export function WorkflowChainsPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [logChainId, setLogChainId] = useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['workflow-chains', 'list'],
    queryFn: listWorkflowChains,
  })

  const items = useMemo(() => data ?? [], [data])

  const onCreated = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['workflow-chains', 'list'] })
  }, [qc])

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-8"
      data-testid="workflow-chains-page"
    >
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">워크플로우 체인</h1>
          <p className="mt-1 text-sm text-gray-600">
            여러 자동화 액션을 순서대로 묶어 실행합니다. 각 단계는 지연 + 실패 전략을 가집니다.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setCreateOpen(true)}
          data-testid="workflow-chain-add-button"
        >
          + 새 체인
        </Button>
      </header>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="체인을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <ul
            className="divide-y divide-gray-100 text-sm"
            data-testid="workflow-chains-list"
          >
            {items.map((chain) => (
              <ChainRow
                key={chain.id}
                chain={chain}
                onShowLog={() => setLogChainId(chain.id)}
              />
            ))}
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-gray-500">
                등록된 체인이 없습니다 — 우측 상단의 “새 체인” 으로 추가하세요.
              </li>
            )}
          </ul>
        </Card>
      )}

      <CreateChainModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          onCreated()
        }}
      />

      <RunLogModal chainId={logChainId} onClose={() => setLogChainId(null)} />
    </div>
  )
}

// ── Row ─────────────────────────────────────────────────────────────────

function ChainRow({
  chain,
  onShowLog,
}: {
  chain: WorkflowChain
  onShowLog: () => void
}) {
  const qc = useQueryClient()

  const toggleEnabled = useMutation({
    mutationFn: () =>
      patchWorkflowChain(chain.id, { enabled: !chain.enabled }),
    onSuccess: () => {
      toast.success(chain.enabled ? '비활성화됨' : '활성화됨')
      void qc.invalidateQueries({ queryKey: ['workflow-chains', 'list'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const remove = useMutation({
    mutationFn: () => deleteWorkflowChain(chain.id),
    onSuccess: () => {
      toast.success('삭제됨')
      void qc.invalidateQueries({ queryKey: ['workflow-chains', 'list'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  const runNow = useMutation({
    mutationFn: () => runWorkflowChainNow(chain.id, {}),
    onSuccess: (r) => {
      toast.success(
        `즉시 실행 — ${r.status} (성공 ${r.steps_completed}, 실패 ${r.steps_failed})`,
      )
      void qc.invalidateQueries({ queryKey: ['workflow-chains', 'list'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '실패'),
  })

  return (
    <li className="px-4 py-3" data-testid={`workflow-chain-row-${chain.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={chain.enabled ? 'success' : 'neutral'}>
              {chain.enabled ? '활성' : '비활성'}
            </Badge>
            <span className="font-medium text-smsg-900">{chain.name}</span>
          </div>
          {chain.description && (
            <p className="mt-1 text-xs text-gray-600">{chain.description}</p>
          )}
          <div className="mt-1 text-xs text-gray-500">
            단계 {chain.step_count ?? 0}개
            {chain.last_run_at
              ? ` · 마지막 실행 ${new Date(chain.last_run_at).toLocaleString()}`
              : ' · 실행 기록 없음'}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            data-testid={`workflow-chain-run-${chain.id}`}
          >
            즉시 실행
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onShowLog}
            data-testid={`workflow-chain-log-${chain.id}`}
          >
            실행 로그
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleEnabled.mutate()}
            disabled={toggleEnabled.isPending}
            data-testid={`workflow-chain-toggle-${chain.id}`}
          >
            {chain.enabled ? '비활성화' : '활성화'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (window.confirm('정말 삭제하시겠습니까?')) remove.mutate()
            }}
            disabled={remove.isPending}
            data-testid={`workflow-chain-delete-${chain.id}`}
          >
            삭제
          </Button>
        </div>
      </div>
    </li>
  )
}

// ── Create modal ────────────────────────────────────────────────────────

function CreateChainModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<DraftStep[]>([emptyStep(0)])
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName('')
    setDescription('')
    setSteps([emptyStep(0)])
  }

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error('이름을 입력하세요')
      return
    }
    if (steps.length === 0) {
      toast.error('최소 하나의 단계를 추가하세요')
      return
    }
    setSubmitting(true)
    try {
      await createWorkflowChain({
        name: name.trim(),
        description: description.trim() || null,
        enabled: true,
        steps: steps.map((s, i) => ({
          ...draftToInput(s),
          ordering: i,
        })),
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

  const moveUp = (i: number) => {
    if (i <= 0) return
    const out = steps.slice()
    const [item] = out.splice(i, 1)
    if (item) out.splice(i - 1, 0, item)
    setSteps(out)
  }
  const moveDown = (i: number) => {
    if (i >= steps.length - 1) return
    const out = steps.slice()
    const [item] = out.splice(i, 1)
    if (item) out.splice(i + 1, 0, item)
    setSteps(out)
  }
  const removeStep = (i: number) => {
    const out = steps.slice()
    out.splice(i, 1)
    setSteps(out)
  }
  const addStep = () => {
    setSteps([...steps, emptyStep(steps.length)])
  }
  const updateStep = (i: number, patch: Partial<DraftStep>) => {
    const out = steps.slice()
    const cur = out[i]
    if (!cur) return
    out[i] = { ...cur, ...patch }
    setSteps(out)
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="새 워크플로우 체인"
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
            data-testid="workflow-chain-create-submit"
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
            placeholder="예: 공개 시 슬랙 + 태그 + 이메일"
            data-testid="workflow-chain-create-name"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">설명 (선택)</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="이 체인이 어떤 일을 하는지 간단히"
            data-testid="workflow-chain-create-description"
          />
        </div>
        <div data-testid="workflow-chain-steps-builder">
          <label className="block text-xs font-medium text-gray-700">
            단계 ({steps.length}개)
          </label>
          <ul className="mt-1 space-y-2">
            {steps.map((s, i) => (
              <li
                key={i}
                className="rounded border border-gray-200 bg-gray-50 p-2"
                data-testid={`workflow-chain-step-${i}`}
              >
                <div className="flex items-center gap-1 text-xs">
                  <span className="font-medium text-gray-700">#{i + 1}</span>
                  <Select
                    value={s.action_kind}
                    onChange={(e) =>
                      updateStep(i, { action_kind: e.target.value })
                    }
                    data-testid={`workflow-chain-step-${i}-kind`}
                  >
                    {[...ALL_AUTOMATION_ACTIONS, 'trigger_chain'].map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a as keyof typeof ACTION_LABELS] ?? a}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={s.fail_strategy}
                    onChange={(e) =>
                      updateStep(i, {
                        fail_strategy: e.target.value as FailStrategy,
                      })
                    }
                    data-testid={`workflow-chain-step-${i}-fail`}
                  >
                    {ALL_FAIL_STRATEGIES.map((f) => (
                      <option key={f} value={f}>
                        실패: {FAIL_LABELS[f]}
                      </option>
                    ))}
                  </Select>
                  <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-600">
                    지연 (s)
                    <Input
                      type="number"
                      min={0}
                      max={300}
                      value={String(s.delay_seconds)}
                      onChange={(e) =>
                        updateStep(i, {
                          delay_seconds: Math.max(
                            0,
                            Math.min(300, Number(e.target.value) || 0),
                          ),
                        })
                      }
                      data-testid={`workflow-chain-step-${i}-delay`}
                      className="w-16"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moveUp(i)}
                    data-testid={`workflow-chain-step-${i}-up`}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moveDown(i)}
                    data-testid={`workflow-chain-step-${i}-down`}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeStep(i)}
                    data-testid={`workflow-chain-step-${i}-remove`}
                  >
                    삭제
                  </Button>
                </div>
                <KvEditor
                  label="action_payload"
                  pairs={s.payload_pairs}
                  setPairs={(pairs) => updateStep(i, { payload_pairs: pairs })}
                  testId={`workflow-chain-step-${i}-payload`}
                />
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            onClick={addStep}
            data-testid="workflow-chain-step-add"
          >
            + 단계 추가
          </Button>
        </div>
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
    <div className="mt-1" data-testid={`${testId}-editor`}>
      <span className="block text-[11px] text-gray-600">{label}</span>
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
          + 항목
        </Button>
      </div>
    </div>
  )
}

// ── Run-log modal ───────────────────────────────────────────────────────

function RunLogModal({
  chainId,
  onClose,
}: {
  chainId: string | null
  onClose: () => void
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['workflow-chains', 'runs', chainId],
    queryFn: () => listWorkflowChainRuns(chainId!, 50),
    enabled: chainId !== null,
  })

  return (
    <Modal
      open={chainId !== null}
      onClose={onClose}
      title="실행 로그 (최근 50건)"
      size="lg"
    >
      <div className="px-5 py-4 text-sm" data-testid="workflow-chains-runs-modal">
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
            {data.map((r: WorkflowChainRun) => (
              <li key={r.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge
                    tone={
                      r.status === 'ok'
                        ? 'success'
                        : r.status === 'rolled_back'
                          ? 'warn'
                          : r.status === 'running'
                            ? 'brand'
                            : 'error'
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="text-gray-700">
                    성공 {r.steps_completed} · 실패 {r.steps_failed}
                  </span>
                  <span className="ml-auto text-gray-500">
                    {r.triggered_at
                      ? new Date(r.triggered_at).toLocaleString()
                      : '—'}
                  </span>
                </div>
                {r.error_message && (
                  <p className="mt-1 text-xs text-red-700">{r.error_message}</p>
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
