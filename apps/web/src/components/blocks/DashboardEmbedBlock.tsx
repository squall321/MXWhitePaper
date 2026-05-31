import { useMemo } from 'react'
import type { DashboardEmbedBlock } from '@/types/document'
import { Badge } from '@/components/ui/Badge'
import { useT } from '@/lib/i18n'

/**
 * Build-time provider base URLs. Source of truth is the `VITE_DASHBOARD_*_BASE`
 * env vars (see `.env.example`) so deployments can swap intra hosts without
 * code changes. Empty value → render the "URL 미설정" placeholder.
 *
 * Read lazily (via getter) so unit tests can `vi.stubEnv()` between imports
 * without re-evaluating the module.
 */
export const PROVIDER_BASE: Record<DashboardEmbedBlock['provider'], string> = {
  get grafana() {
    return (import.meta.env.VITE_DASHBOARD_GRAFANA_BASE as string | undefined) ?? ''
  },
  get tableau() {
    return (import.meta.env.VITE_DASHBOARD_TABLEAU_BASE as string | undefined) ?? ''
  },
  get superset() {
    return (import.meta.env.VITE_DASHBOARD_SUPERSET_BASE as string | undefined) ?? ''
  },
} as Record<DashboardEmbedBlock['provider'], string>

const PROVIDER_LABEL: Record<DashboardEmbedBlock['provider'], string> = {
  grafana: 'Grafana',
  tableau: 'Tableau',
  superset: 'Superset',
}

/**
 * Pure URL builder — exported for unit tests. Accepts an explicit provider
 * map so tests can vary `PROVIDER_BASE` without round-tripping through env.
 */
export function buildDashboardUrl(
  provider: DashboardEmbedBlock['provider'],
  panelId: string,
  params: unknown,
  bases: Record<DashboardEmbedBlock['provider'], string> = PROVIDER_BASE,
): string {
  if (!panelId) return ''
  const base = bases[provider]
  if (!base) return ''
  try {
    const url = new URL(`${base}/${encodeURIComponent(panelId)}`)
    if (params && typeof params === 'object' && !Array.isArray(params)) {
      for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
        if (v == null) continue
        url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  } catch {
    return ''
  }
}

function buildUrl(provider: DashboardEmbedBlock['provider'], panelId: string, params: unknown): string {
  return buildDashboardUrl(provider, panelId, params)
}

/**
 * Read-mode dashboard embed. Renders a sandboxed iframe with provenance
 * metadata above. Provider is enforced via the `PROVIDER_BASE` whitelist —
 * unknown providers fall through to an empty src and a warning state.
 */
export function DashboardEmbedBlockView({ block }: { block: DashboardEmbedBlock }) {
  const t = useT()
  const provider = block?.provider
  const panelId = block?.panelId ?? ''
  const params = block?.params
  const src = useMemo(() => buildUrl(provider, panelId, params), [provider, panelId, params])
  const stamp = useMemo(
    () => new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    [panelId],
  )

  const isKnownProvider = Boolean(provider && PROVIDER_LABEL[provider])
  const isProviderConfigured = Boolean(provider && PROVIDER_BASE[provider])
  const providerLabel = isKnownProvider ? PROVIDER_LABEL[provider] : t('block.dashboardEmbed.unknownProvider')

  return (
    <figure className="space-y-2 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
      <header className="flex items-center justify-between gap-2 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <Badge tone="brand" size="sm">{providerLabel}</Badge>
          <code className="text-[11px] text-gray-600">{panelId || t('block.dashboardEmbed.panelIdMissing')}</code>
        </div>
        <span>{t('block.dashboardEmbed.requestedAt', { stamp })}</span>
      </header>
      {!isKnownProvider ? (
        <div className="grid h-48 place-items-center rounded border border-dashed border-amber-300 bg-amber-50 text-xs text-amber-800">
          {t('block.dashboardEmbed.unsupportedProvider')}
        </div>
      ) : !isProviderConfigured ? (
        <div
          data-dashboard-no-base
          className="grid h-48 place-items-center rounded border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-500 dark:border-gray-600 dark:bg-gray-800"
        >
          {t('block.dashboardEmbed.urlNotConfigured', { provider: provider.toUpperCase() })}
        </div>
      ) : src ? (
        <iframe
          src={src}
          title={`${provider} ${panelId}`}
          className="block h-96 w-full rounded border border-gray-100"
          sandbox="allow-scripts allow-same-origin allow-popups"
          loading="lazy"
        />
      ) : (
        <div className="grid h-48 place-items-center rounded border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-500 dark:border-gray-600 dark:bg-gray-800">
          panel id를 입력하세요.
        </div>
      )}
    </figure>
  )
}
