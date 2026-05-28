import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useGlossarySearch } from '@/features/glossary/useGlossarySearch'
import type { GlossaryDomain, GlossaryTerm } from '@/features/glossary/api'
import { ProposeTermModal } from '@/features/glossary/components/ProposeTermModal'

/**
 * `/glossary` — 분야별 용어집 검색/탐색 페이지 (Sprint C-1).
 *
 * - 좌측 (sm+) 사이드바: 분야 트리. 모바일은 상단 chip 행 + `.scroll-fade-x`.
 * - 메인: 검색 입력 + 카드 list + 페이지네이션.
 * - 결과 0개: "[용어 제안하기]" placeholder (Sprint C-2 의 propose modal 자리).
 */
export function GlossaryPage() {
  const [q, setQ] = useState('')
  const [domain, setDomain] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const size = 20
  const [searchParams, setSearchParams] = useSearchParams()
  const [proposeOpen, setProposeOpen] = useState(
    () => searchParams.get('propose') === '1',
  )

  // URL ?propose=1 진입점 동기화 — bookmark / deep-link 보존.
  useEffect(() => {
    if (proposeOpen && searchParams.get('propose') !== '1') {
      const next = new URLSearchParams(searchParams)
      next.set('propose', '1')
      setSearchParams(next, { replace: true })
    }
    if (!proposeOpen && searchParams.get('propose') === '1') {
      const next = new URLSearchParams(searchParams)
      next.delete('propose')
      setSearchParams(next, { replace: true })
    }
  }, [proposeOpen, searchParams, setSearchParams])

  const { list, domains, isEmpty } = useGlossarySearch({
    q,
    domain,
    page,
    size,
  })

  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / size))
  const domainList: GlossaryDomain[] = domains.data ?? []

  function selectDomain(slug: string | null) {
    setDomain(slug)
    setPage(1)
  }

  function onQueryChange(v: string) {
    setQ(v)
    setPage(1)
  }

  const domainName = useMemo(() => {
    if (!domain) return '전체'
    return domainList.find((d) => d.slug === domain)?.name ?? domain
  }, [domain, domainList])

  return (
    <div
      className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"
      data-testid="glossary-page"
    >
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-smsg-900 dark:text-smsg-100">
          용어집
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          분야별 용어를 검색하고 정의를 확인하세요. 없는 용어는 제안할 수 있습니다.
        </p>
      </header>

      {/* Mobile: chip-row 가로 스크롤. sm+ 에서는 grid 로 사이드바 + 메인. */}
      <div
        className="scroll-fade-x mb-4 -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:hidden"
        role="tablist"
        aria-label="분야 필터"
        data-testid="glossary-domain-chips"
      >
        <DomainChip
          active={domain === null}
          label="전체"
          onClick={() => selectDomain(null)}
        />
        {domainList.map((d) => (
          <DomainChip
            key={d.slug}
            active={domain === d.slug}
            label={d.name}
            onClick={() => selectDomain(d.slug)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[12rem_1fr] lg:grid-cols-[14rem_1fr]">
        {/* Sidebar (sm+) */}
        <aside
          className="hidden sm:block"
          aria-label="분야 사이드바"
          data-testid="glossary-domain-sidebar"
        >
          <nav>
            <ul className="space-y-0.5 text-sm">
              <li>
                <SidebarLink
                  active={domain === null}
                  label="전체"
                  onClick={() => selectDomain(null)}
                />
              </li>
              {domainList.map((d) => (
                <li key={d.slug}>
                  <SidebarLink
                    active={domain === d.slug}
                    label={d.name}
                    onClick={() => selectDomain(d.slug)}
                  />
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Main column */}
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <input
                type="search"
                value={q}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="용어 / alias / 영문 검색"
                aria-label="용어 검색"
                data-testid="glossary-search"
                className="w-full max-w-sm rounded border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-smsg-500 focus:outline-none focus:ring-1 focus:ring-smsg-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {domainName} · {total.toLocaleString()}개
            </p>
          </div>

          {list.isError && (
            <p
              role="alert"
              className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200"
            >
              용어를 불러오지 못했습니다.
            </p>
          )}

          {list.isPending && (
            <p className="text-sm text-gray-500" data-testid="glossary-loading">
              불러오는 중…
            </p>
          )}

          {!list.isPending && isEmpty && (
            <div
              className="rounded-md border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300"
              data-testid="glossary-empty"
            >
              <p>검색 결과가 없습니다.</p>
              <button
                type="button"
                onClick={() => setProposeOpen(true)}
                className="mt-2 inline-block rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900"
                data-testid="glossary-propose-link"
              >
                용어 제안하기
              </button>
            </div>
          )}

          {!list.isPending && !isEmpty && (
            <ul
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
              data-testid="glossary-cards"
            >
              {items.map((t) => (
                <li key={t.id}>
                  <TermCard term={t} />
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <nav
              className="mt-5 flex items-center justify-center gap-2 text-sm"
              aria-label="페이지네이션"
              data-testid="glossary-pagination"
            >
              <PageBtn
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                label="이전"
              />
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {page} / {totalPages}
              </span>
              <PageBtn
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                label="다음"
              />
            </nav>
          )}
        </section>
      </div>

      <ProposeTermModal
        open={proposeOpen}
        initialTerm={q}
        initialDomain={domain ?? undefined}
        onClose={() => setProposeOpen(false)}
      />
    </div>
  )
}

function DomainChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ' +
        (active
          ? 'border-smsg-700 bg-smsg-700 text-white'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800')
      }
    >
      {label}
    </button>
  )
}

function SidebarLink({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={
        'block w-full rounded px-2 py-1 text-left text-sm transition-colors ' +
        (active
          ? 'bg-smsg-50 font-semibold text-smsg-900 dark:bg-smsg-900/30 dark:text-smsg-100'
          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800')
      }
    >
      {label}
    </button>
  )
}

function PageBtn({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
    >
      {label}
    </button>
  )
}

function TermCard({ term }: { term: GlossaryTerm }) {
  return (
    <article
      data-testid={`glossary-card-${term.id}`}
      className="h-full rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-smsg-900 dark:text-smsg-100">
            {term.term}
            {term.term_en && (
              <span className="ml-1 text-xs font-normal text-gray-500">
                ({term.term_en})
              </span>
            )}
          </h3>
        </div>
        {term.domain && (
          <span className="shrink-0 rounded-full bg-smsg-50 px-2 py-0.5 text-[10px] font-medium text-smsg-700 dark:bg-smsg-900/40 dark:text-smsg-100">
            {term.domain}
          </span>
        )}
      </header>
      <p className="mt-1.5 line-clamp-4 text-xs text-gray-700 dark:text-gray-200">
        {term.definition}
      </p>
      {term.aliases && term.aliases.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {term.aliases.map((a) => (
            <li
              key={a}
              className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              {a}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
