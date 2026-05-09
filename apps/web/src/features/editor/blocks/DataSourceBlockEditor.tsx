import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DataSourceBlock, Slug } from '@/types/document'
import { Button, Field, Input, Select } from '@/components/ui'
import { listWidgets, type WidgetRegistryEntry } from '@/features/search/api'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { DataSourceBlockView } from '@/components/blocks/DataSourceBlock'
import { BlockHelpDrawer } from '@/features/editor/components/BlockHelpDrawer'
import { useT } from '@/lib/i18n'

const RENDER_OPTIONS: DataSourceBlock['render'][] = ['table', 'chart', 'kpi-cards']
/** i18n key for each render mode label. */
const RENDER_LABEL_KEY: Record<DataSourceBlock['render'], string> = {
  table: 'editor.dataSource.renderTable',
  chart: 'editor.dataSource.renderChart',
  'kpi-cards': 'editor.dataSource.renderKpi',
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
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<DataSourceBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [paramsText, setParamsText] = useState(() =>
    JSON.stringify(block.params ?? {}, null, 2),
  )
  const [paramsErr, setParamsErr] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const registry = useQuery({
    queryKey: ['widgets-registry'],
    queryFn: listWidgets,
    staleTime: 60_000,
  })

  const push = async (next: DataSourceBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, t('editor.dataSource.changeLog'))
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError(t('editor.common.conflict'))
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
        setParamsErr(t('editor.dataSource.paramsObjectRequired'))
      }
    } catch (err) {
      setParamsErr((err as Error).message)
    }
  }

  const isEmpty = !local.endpoint.trim()

  // Quick "샘플" — pick the first registry entry as a one-click starter so
  // users get a working dashboard without reading the docs first.
  const sampleEntry = registry.data?.[0]
  const onUseSample = () => {
    if (sampleEntry) onPickRegistry(sampleEntry.type)
  }

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      {isEmpty && (
        <div
          data-testid="data-source-empty-state"
          className="rounded-md border border-dashed border-smsg-300 bg-white p-4 text-center dark:bg-gray-900"
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('editor.dataSource.empty')}
          </p>
          <div className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button size="sm" type="button" onClick={onUseSample} disabled={!sampleEntry}>
              {sampleEntry
                ? t('editor.dataSource.useSample', { name: sampleEntry.name })
                : t('editor.dataSource.connect')}
            </Button>
            <button
              type="button"
              className="text-xs text-link hover:underline"
              onClick={() => setHelpOpen(true)}
            >
              {t('common.helpMore')}
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label={t('editor.dataSource.registry')}
          hint={registry.isLoading ? t('editor.dataSource.loading') : undefined}
        >
          <Select
            value=""
            onChange={(e) => onPickRegistry(e.target.value)}
            disabled={registry.isLoading}
            aria-label={t('editor.dataSource.registry')}
          >
            <option value="">{t('editor.dataSource.pickWidget')}</option>
            {(registry.data ?? []).map((w) => (
              <option key={w.type} value={w.type}>
                {w.name} ({w.type})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('editor.dataSource.renderMode')}>
          <Select
            value={local.render}
            onChange={(e) =>
              void push({ ...local, render: e.target.value as DataSourceBlock['render'] })
            }
            aria-label={t('editor.dataSource.renderMode')}
          >
            {RENDER_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t(RENDER_LABEL_KEY[m])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('editor.dataSource.endpoint')} className="md:col-span-2">
          <Input
            value={local.endpoint}
            onChange={(e) => setLocal({ ...local, endpoint: e.target.value })}
            onBlur={() => void push(local)}
            placeholder="/widgets/kpi/finance-daily"
            aria-label={t('editor.dataSource.endpoint')}
          />
        </Field>
        <Field
          label={t('editor.dataSource.refreshLabel', { n: local.refreshInterval ?? 60 })}
          hint={t('editor.dataSource.refreshHint')}
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
        <Field label={t('editor.dataSource.params')} error={paramsErr ?? undefined} className="md:col-span-2">
          <textarea
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            onBlur={onParamsBlur}
            rows={3}
            aria-label={t('editor.dataSource.params')}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
          />
        </Field>
      </div>

      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {t('editor.dataSource.preview')}
        </p>
        <DataSourceBlockView block={local} />
      </div>
      <BlockHelpDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={{
          title: '데이터 소스 블록',
          description: [
            '`endpoint` 로 가리키는 위젯 API 의 응답을 자동 폴링해 표/차트/KPI 카드 중 하나로 렌더링합니다.',
            '`refreshInterval` (초 단위, 30~3600) 로 갱신 주기를 조절하세요. 위젯 레지스트리에서 사전에 등록된 항목만 선택할 수 있습니다.',
          ],
          examples: [
            {
              title: '예시',
              body: 'endpoint: /widgets/kpi/finance-daily\nrender: kpi-cards\nrefreshInterval: 60',
            },
          ],
        }}
      />
    </div>
  )
}
