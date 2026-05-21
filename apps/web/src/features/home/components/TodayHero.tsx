import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { KnowledgeGraph } from '@/features/graph/components/KnowledgeGraph'
import { fetchHomeToday } from '@/features/home/api'
import { useT } from '@/lib/i18n'

export function TodayHeroSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid animate-pulse grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 lg:grid-cols-[3fr_2fr] dark:border-gray-700 dark:bg-gray-900"
    >
      {/* 좌: 그래프 placeholder */}
      <div className="min-h-[280px] rounded-lg bg-gray-200 dark:bg-gray-800" />

      {/* 우: 카드 placeholder */}
      <aside className="flex flex-col gap-3">
        <div className="h-4 w-20 rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-6 w-3/4 rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-4 w-full rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-800" />
        <div className="mt-2 h-4 w-40 rounded bg-gray-200 dark:bg-gray-800" />
        <div className="mt-auto flex gap-2">
          <div className="h-7 w-24 rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-7 w-20 rounded bg-gray-200 dark:bg-gray-800" />
        </div>
      </aside>
    </div>
  )
}

const TODAY_EDGE_KINDS = new Set<'wiki' | 'doc_tag' | 'tag_cooc'>(['wiki', 'doc_tag'])

export function TodayHero() {
  const t = useT()
  const navigate = useNavigate()
  const { data, isPending, isError } = useQuery({
    queryKey: ['home-today'],
    queryFn: fetchHomeToday,
    staleTime: 5 * 60_000,
  })

  if (isPending) return <TodayHeroSkeleton />
  if (isError || !data) return null

  const { doc, neighbors, graph } = data

  return (
    <section
      aria-label={t('home.today.sectionLabel')}
      className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gradient-to-br from-smsg-50 to-white p-4 lg:grid-cols-[3fr_2fr] dark:border-gray-700 dark:from-gray-900 dark:to-gray-950"
    >
      {/* 좌: 그래프 */}
      <div className="min-h-[280px] overflow-hidden rounded-lg border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
        <KnowledgeGraph
          nodes={graph.nodes}
          edges={graph.edges}
          rootSlug={doc.slug}
          edgeKinds={TODAY_EDGE_KINDS}
          height={280}
          onPickNode={(s) => navigate(`/docs/${encodeURIComponent(s)}`)}
        />
      </div>

      {/* 우: 큐레이션 카드 */}
      <aside className="flex flex-col gap-3">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-smsg-700 dark:text-smsg-300">
            📌 {t('home.today.label')}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-smsg-900 dark:text-gray-100">
            <Link to={`/docs/${encodeURIComponent(doc.slug)}`} className="hover:underline">
              {doc.title}
            </Link>
          </h2>
          {doc.excerpt && (
            <p className="mt-1 line-clamp-3 text-sm text-gray-600 dark:text-gray-300">
              {doc.excerpt}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            ⇐ {t('home.today.indegree', { count: doc.indegree })}
          </p>
        </header>

        <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            🔗 {t('home.today.neighbors')}
          </p>
          <ul className="space-y-1">
            {neighbors.slice(0, 5).map((n) => (
              <li key={n.slug}>
                {n.kind === 'wiki' ? (
                  <Link
                    to={`/docs/${encodeURIComponent(n.slug)}`}
                    className="block truncate text-sm text-link hover:underline"
                  >
                    📄 {n.title}
                  </Link>
                ) : (
                  <span className="block truncate text-sm text-gray-600 dark:text-gray-400">
                    🏷 {n.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto flex items-center gap-2 text-xs">
          <Link
            to={`/graph/${encodeURIComponent(doc.slug)}?depth=2`}
            className="rounded border border-smsg-300 bg-smsg-50 px-2 py-1 text-smsg-700 hover:bg-smsg-100 dark:border-smsg-700 dark:bg-smsg-900 dark:text-smsg-100"
          >
            🌐 {t('home.today.exploreGraph')}
          </Link>
          <Link
            to={`/docs/${encodeURIComponent(doc.slug)}`}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            📄 {t('home.today.openDoc')}
          </Link>
        </div>
      </aside>
    </section>
  )
}
