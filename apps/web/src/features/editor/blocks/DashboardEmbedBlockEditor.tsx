import { useState } from 'react'
import type { DashboardEmbedBlock, Slug } from '@/types/document'
import { Button, Field, IconButton, Input, Select } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { DashboardEmbedBlockView } from '@/components/blocks/DashboardEmbedBlock'

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

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
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
    </div>
  )
}
