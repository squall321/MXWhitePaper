import { useState } from 'react'
import type { DashboardEmbedBlock, Slug } from '@/types/document'
import { Button, Field, IconButton, Input, Select } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { DashboardEmbedBlockView } from '@/components/blocks/DashboardEmbedBlock'
import { BlockHelpDrawer } from '@/features/editor/components/BlockHelpDrawer'

const PROVIDERS: DashboardEmbedBlock['provider'][] = ['grafana', 'tableau', 'superset']

interface Props {
  slug: Slug
  block: DashboardEmbedBlock
}

type ParamRow = { key: string; value: string }

function paramsToRows(params: unknown): ParamRow[] {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return []
  return Object.entries(params as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: value == null ? '' : String(value),
  }))
}

function rowsToParams(rows: ParamRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (!r.key.trim()) continue
    out[r.key] = r.value
  }
  return out
}

/**
 * Edit-mode for `dashboard-embed` — provider select, panel id, key/value
 * params editor + a sandboxed live preview that mirrors read mode.
 */
export function DashboardEmbedBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<DashboardEmbedBlock>(block)
  const [rows, setRows] = useState<ParamRow[]>(() => paramsToRows(block.params))
  const [error, setError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const push = async (next: DashboardEmbedBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '대시보드 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
      else setError((err as Error).message)
    }
  }

  const commitRows = (next: ParamRow[]) => {
    setRows(next)
    void push({ ...local, params: rowsToParams(next) })
  }

  const isEmpty = !local.panelId.trim()

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      {isEmpty && (
        <div
          data-testid="dashboard-embed-empty-state"
          className="rounded-md border border-dashed border-smsg-300 bg-white p-4 text-center dark:bg-gray-900"
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            이 블록은 <strong>외부 대시보드 패널</strong>(Grafana / Tableau / Superset)을 임베드합니다.
          </p>
          <div className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button
              size="sm"
              type="button"
              onClick={() => setLocal({ ...local, panelId: '' })}
            >
              URL 입력
            </Button>
            <button
              type="button"
              className="text-xs text-link hover:underline"
              onClick={() => setHelpOpen(true)}
            >
              도움말 보기
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="제공자">
          <Select
            value={local.provider}
            onChange={(e) =>
              void push({ ...local, provider: e.target.value as DashboardEmbedBlock['provider'] })
            }
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Field label="Panel ID">
          <Input
            value={local.panelId}
            onChange={(e) => setLocal({ ...local, panelId: e.target.value })}
            onBlur={() => void push(local)}
            placeholder="dashboard-uid/panel-id"
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-gray-700">파라미터</p>
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={r.key}
              onChange={(e) => {
                const copy = rows.slice()
                copy[i] = { ...r, key: e.target.value }
                setRows(copy)
              }}
              onBlur={() => commitRows(rows)}
              placeholder="key"
              aria-label={`param ${i} key`}
              className="flex-1"
            />
            <Input
              value={r.value}
              onChange={(e) => {
                const copy = rows.slice()
                copy[i] = { ...r, value: e.target.value }
                setRows(copy)
              }}
              onBlur={() => commitRows(rows)}
              placeholder="value"
              aria-label={`param ${i} value`}
              className="flex-1"
            />
            <IconButton
              aria-label={`param ${i} remove`}
              onClick={() => commitRows(rows.filter((_, j) => j !== i))}
            >
              ×
            </IconButton>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => setRows([...rows, { key: '', value: '' }])}
        >
          + 파라미터
        </Button>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          미리보기
        </p>
        <DashboardEmbedBlockView block={local} />
      </div>
      <BlockHelpDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={{
          title: '대시보드 임베드 블록',
          description: [
            'Grafana / Tableau / Superset 등 외부 대시보드 패널을 iframe 으로 임베드합니다.',
            '`panelId` 는 보통 `dashboard-uid/panel-id` 형식이며, 추가 파라미터(예: `from=now-24h`) 는 key/value 로 입력하세요.',
          ],
          examples: [
            {
              title: '예시',
              body: 'provider: grafana\npanelId: ops-dashboard/cpu\nparams:\n  from: now-24h\n  to: now',
            },
          ],
        }}
      />
    </div>
  )
}
