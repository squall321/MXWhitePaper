// AI 위키 화면들의 머리 — 제목 · 위키 안 내비(홈 · 엔티티 · 온톨로지 · 검토 큐 · 기록) · 꺼짐 · 오류 상태(docs/llm-wiki W4 · W5)
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { isNotFound } from '@/lib/api/envelope'

const LINKS = [
  { to: '/wiki', label: '홈', end: true },
  { to: '/wiki/entities', label: '엔티티', end: false },
  { to: '/wiki/ontology', label: '온톨로지', end: false },
  { to: '/wiki/changes', label: '검토 큐', end: false },
  { to: '/wiki/log', label: '기록', end: false },
]

export function WikiShell({ title, subtitle, testId, children }: {
  title: string
  subtitle?: ReactNode
  testId: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8" data-testid={testId}>
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-smsg-900 dark:text-gray-100">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>}
        </div>
        <nav className="flex gap-1 text-sm" aria-label="AI 위키">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded-full px-3 py-1 ${isActive
                  ? 'bg-smsg-100 font-medium text-smsg-800 dark:bg-gray-800 dark:text-gray-100'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {children}
    </div>
  )
}

/** 위키가 꺼졌으면(404 wiki_disabled) 그렇다고, 그 밖의 오류는 오류로. */
export function WikiError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isNotFound(error)) {
    return <EmptyState title="여기에는 없다" description="AI 위키가 꺼져 있거나(WIKI_ENABLED), 볼 수 있는 범위 밖이다." />
  }
  return <ErrorState description={error instanceof Error ? error.message : undefined} onRetry={onRetry} />
}
