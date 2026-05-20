import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { SUPER_DOMAINS } from '@mx/shared/super-domains'
import { fetchHomeHero } from '@/features/home/api'
import { fetchGraph } from '@/features/graph/api'
import { useT } from '@/lib/i18n'
import { Sparkline } from './Sparkline'

interface DomainTilesProps {
  variant?: 'full' | 'compact'
}

export function DomainTiles({ variant = 'full' }: DomainTilesProps = {}) {
  const t = useT()
  const { data } = useQuery({
    queryKey: ['home-hero'],
    queryFn: fetchHomeHero,
    staleTime: 5 * 60_000,
  })
  const qc = useQueryClient()

  // Prefetch the domain graph on hover/focus so navigation feels instant.
  // react-query's staleTime acts as a 60 s debounce — duplicate hover events
  // within that window are no-ops.
  const prefetchGraph = (domainId: string) => {
    void qc.prefetchQuery({
      queryKey: ['graph', { domain: domainId }],
      queryFn: () => fetchGraph({ domain: domainId, include_tags: true }),
      staleTime: 60_000,
    })
  }

  if (!data?.domains?.length) return null

  if (variant === 'compact') {
    return (
      <section aria-label={t('home.domain.sectionLabel')}>
        <div className="flex flex-wrap items-center gap-2">
          {data.domains.map((d) => {
            const meta = SUPER_DOMAINS.find((s) => s.id === d.id)
            if (!meta) return null
            const delta = d.doc_count - d.doc_count_7d_ago
            return (
              <Link
                key={d.id}
                to={`/graph?domain=${d.id}`}
                onMouseEnter={() => prefetchGraph(d.id)}
                onFocus={() => prefetchGraph(d.id)}
                className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs hover:border-smsg-300 hover:no-underline hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-smsg-300/50"
              >
                <span aria-hidden="true">{meta.emoji}</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {t(`home.domain.${d.id}`)}
                </span>
                <span className="text-gray-500 dark:text-gray-400">{d.doc_count}</span>
                {delta > 0 && (
                  <span
                    className="font-medium text-green-600 dark:text-green-400"
                    aria-label={t('home.trend.deltaLabel', { delta })}
                  >
                    ↗+{delta}
                  </span>
                )}
                <Sparkline
                  data={d.trend_7d}
                  width={40}
                  height={16}
                  ariaLabel={t('home.trend.sparkLabel', { count: d.doc_count })}
                />
              </Link>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <section aria-label={t('home.domain.sectionLabel')}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {data.domains.map((d) => {
          const meta = SUPER_DOMAINS.find((s) => s.id === d.id)
          if (!meta) return null
          const delta = d.doc_count - d.doc_count_7d_ago
          return (
            <Link
              key={d.id}
              to={`/graph?domain=${d.id}`}
              onMouseEnter={() => prefetchGraph(d.id)}
              onFocus={() => prefetchGraph(d.id)}
              className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md hover:no-underline dark:border-gray-800 dark:bg-gray-900"
            >
              <header className="flex items-center justify-between">
                <span className="text-2xl leading-none" aria-hidden="true">
                  {meta.emoji}
                </span>
                {delta > 0 && (
                  <span
                    className="text-xs font-medium text-green-600 dark:text-green-400"
                    aria-label={t('home.trend.deltaLabel', { delta })}
                  >
                    ↗ +{delta}
                  </span>
                )}
              </header>
              <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t(`home.domain.${d.id}`)}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {d.doc_count} docs
              </p>
              <Sparkline
                data={d.trend_7d}
                width={80}
                height={20}
                ariaLabel={t('home.trend.sparkLabel', { count: d.doc_count })}
              />
              <ul className="mt-2 space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
                {d.top_docs.map((doc) => (
                  <li key={doc.slug} className="truncate">
                    <Link
                      to={`/docs/${encodeURIComponent(doc.slug)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Link>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        {t('home.hero.scopeHint')}
      </p>
    </section>
  )
}
