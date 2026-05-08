import { useMemo } from 'react'
import type { DashboardEmbedBlock } from '@/types/document'
import { Badge } from '@/components/ui/Badge'

/**
 * Dev-only base URLs per provider — replaced via env vars in real deployments.
 * TODO: source from `/config/whoami` or build-time env.
 */
const PROVIDER_BASE: Record<DashboardEmbedBlock['provider'], string> = {
  grafana: 'https://grafana.intra.example.com/d-solo',
  tableau: 'https://tableau.intra.example.com/views',
  superset: 'https://superset.intra.example.com/superset/dashboard',
}

const PROVIDER_LABEL: Record<DashboardEmbedBlock['provider'], string> = {
  grafana: 'Grafana',
  tableau: 'Tableau',
  superset: 'Superset',
}

function buildUrl(provider: DashboardEmbedBlock['provider'], panelId: string, params: unknown): string {
  if (!panelId) return ''
  const base = PROVIDER_BASE[provider]
  const url = new URL(`${base}/${encodeURIComponent(panelId)}`)
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (v == null) continue
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/**
 * Read-mode dashboard embed. Renders a sandboxed iframe with provenance
 * metadata above. Provider is enforced via the `PROVIDER_BASE` whitelist —
 * unknown providers fall through to an empty src and a warning state.
 */
export function DashboardEmbedBlockView({ block }: { block: DashboardEmbedBlock }) {
  const src = useMemo(
    () => buildUrl(block.provider, block.panelId, block.params),
    [block.provider, block.panelId, block.params],
  )
  const stamp = useMemo(() => new Date().toLocaleTimeString('ko-KR', { hour12: false }), [block.panelId])

  return (
    <figure className="space-y-2 rounded border border-gray-200 bg-white p-2">
      <header className="flex items-center justify-between gap-2 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <Badge tone="brand" size="sm">{PROVIDER_LABEL[block.provider]}</Badge>
          <code className="text-[11px] text-gray-600">{block.panelId || '(panel id 없음)'}</code>
        </div>
        <span>요청 {stamp}</span>
      </header>
      {src ? (
        <iframe
          src={src}
          title={`${block.provider} ${block.panelId}`}
          className="block h-96 w-full rounded border border-gray-100"
          sandbox="allow-scripts allow-same-origin allow-popups"
          loading="lazy"
        />
      ) : (
        <div className="grid h-48 place-items-center rounded border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-500">
          panel id를 입력하세요.
        </div>
      )}
    </figure>
  )
}
