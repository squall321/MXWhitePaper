import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DataSourceBlock, Slug } from '@/types/document'
import { Field, Input, Select } from '@/components/ui'
import { listWidgets, type WidgetRegistryEntry } from '@/features/search/api'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { DataSourceBlockView } from '@/components/blocks/DataSourceBlock'

const RENDER_OPTIONS: DataSourceBlock['render'][] = ['table', 'chart', 'kpi-cards']
const RENDER_LABEL: Record<DataSourceBlock['render'], string> = {
  table: '표',
  chart: '차트',
  'kpi-cards': 'KPI 카드',
}

interface Props {
  slug: Slug
  block: DataSourceBlock
}

/** Try to extract a hint endpoint from a registry entry. */
function pickEndpoint(w: WidgetRegistryEntry): string {
  // The registry entry's `type` is the canonical id (e.g. `kpi.finance-daily`)
  // — convert dotted form to a path.
  if (!w.type) return ''
  return `/widgets/${w.type.replace(/\./g, '/')}`
}

/**
 * `data-source` block editor — pick a widget from the registry, tweak the
 * refresh interval, and live-preview the same `DataSourceBlockView`.
 */
export function DataSourceBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<DataSourceBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [paramsText, setParamsText] = useState(() =>
    JSON.stringify(block.params ?? {}, null, 2),
  )
  const [paramsErr, setParamsErr] = useState<string | null>(null)

  const registry = useQuery({
    queryKey: ['widgets-registry'],
    queryFn: listWidgets,
    staleTime: 60_000,
  })

  const push = async (next: DataSourceBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '데이터 소스 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
      else setError((err as Error).message)
    }
  }

  const onPickRegistry = (typeId: string) => {
    const item = registry.data?.find((w) => w.type === typeId)
    if (!item) return
    const next: DataSourceBlock = {
      ...local,
      endpoint: pickEndpoint(item),
      params: {},
    }
    setParamsText('{}')
    setParamsErr(null)
    void push(next)
  }

  const onParamsBlur = () => {
    try {
      const parsed = paramsText.trim() ? JSON.parse(paramsText) : {}
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setParamsErr(null)
        void push({ ...local, params: parsed })
      } else {
        setParamsErr('JSON 객체여야 합니다.')
      }
    } catch (err) {
      setParamsErr((err as Error).message)
    }
  }

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="위젯 레지스트리" hint={registry.isLoading ? '불러오는 중…' : undefined}>
          <Select
            value=""
            onChange={(e) => onPickRegistry(e.target.value)}
            disabled={registry.isLoading}
          >
            <option value="">위젯 선택…</option>
            {(registry.data ?? []).map((w) => (
              <option key={w.type} value={w.type}>
                {w.name} ({w.type})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="렌더 모드">
          <Select
            value={local.render}
            onChange={(e) =>
              void push({ ...local, render: e.target.value as DataSourceBlock['render'] })
            }
          >
            {RENDER_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {RENDER_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Endpoint" className="md:col-span-2">
          <Input
            value={local.endpoint}
            onChange={(e) => setLocal({ ...local, endpoint: e.target.value })}
            onBlur={() => void push(local)}
            placeholder="/widgets/kpi/finance-daily"
          />
        </Field>
        <Field
          label={`갱신 주기: ${local.refreshInterval ?? 60}s`}
          hint="30초 ~ 3600초"
          className="md:col-span-2"
        >
          <input
            type="range"
            min={30}
            max={3600}
            step={30}
            value={local.refreshInterval ?? 60}
            onChange={(e) =>
              setLocal({ ...local, refreshInterval: Number(e.target.value) })
            }
            onMouseUp={() => void push(local)}
            onTouchEnd={() => void push(local)}
            className="w-full"
          />
        </Field>
        <Field label="파라미터 (JSON)" error={paramsErr ?? undefined} className="md:col-span-2">
          <textarea
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            onBlur={onParamsBlur}
            rows={3}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
          />
        </Field>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          미리보기
        </p>
        <DataSourceBlockView block={local} />
      </div>
    </div>
  )
}
