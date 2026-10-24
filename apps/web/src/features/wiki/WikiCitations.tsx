// AI 위키 문서의 근거 — 블록 끝 각주 번호 · 누르면 원천 카드(종류 · 출처 · 날짜 · 위치 · 인용 · 원본 링크) · 문서 머리띠(배지 · 기대는 원천)
/**
 * 근거는 DocumentJSON 밖 옆 표에 있다(CONTRACTS §2-3) — 문서 화면이 `GET /wiki/pages/{slug}` 를 받아 컨텍스트로 내려 주고,
 * `SectionRenderer` 가 블록마다 `WikiCited` 로 감싼다. 컨텍스트가 없으면(위키 문서가 아니면) 감싸기는 아무것도 하지 않는다.
 * 각주 번호는 문서가 기대는 원천 목록(생긴 때 순)의 차례 — 같은 원천은 문서 어디서나 같은 번호다.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { kst, type WikiCite, type WikiPageInfo } from './api'

interface CitationsValue {
  page: WikiPageInfo
  numberOf: Record<string, number>
}

const CitationsContext = createContext<CitationsValue | null>(null)

const KIND_LABEL: Record<string, string> = {
  sim_result: '해석 결과', field_defect: '시장불량', qa: '문답', deliberation: '심의', report: '보고서', card: '지식카드',
  document: '백서', correction: '정정', inquiry_answer: '지속 질의 답', note: '메모',
}

export function sourceKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind
}

export function WikiCitationsProvider({ page, children }: { page: WikiPageInfo; children: ReactNode }) {
  const value = useMemo<CitationsValue>(
    () => ({ page, numberOf: Object.fromEntries(page.sources.map((s, i) => [s.source_id, i + 1])) }),
    [page],
  )
  return <CitationsContext.Provider value={value}>{children}</CitationsContext.Provider>
}

function SourceCard({ cite, n, onClose }: { cite: WikiCite; n: number; onClose: () => void }) {
  const path = typeof cite.locator?.path === 'string' ? cite.locator.path : null
  return (
    <div
      role="dialog"
      aria-label={`근거 ${n}`}
      data-testid="wiki-source-card"
      className="absolute right-0 top-full z-popover mt-1 w-80 rounded-lg border border-gray-200 bg-white p-3 text-left text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">[{n}]</span>
        <Badge tone="info">{sourceKindLabel(cite.kind)}</Badge>
        {cite.status !== 'active' && <Badge tone="warn">{cite.status === 'withdrawn' ? '철회됨' : '새 판에 밀림'}</Badge>}
        <button type="button" onClick={onClose} className="ml-auto text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
          닫기
        </button>
      </div>
      <Link to={`/wiki/sources/${cite.source_id}`} className="font-medium text-smsg-700 hover:underline dark:text-smsg-300">
        {cite.title}
      </Link>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        {cite.system} · {kst(cite.captured_at)} KST · {cite.short}
        {path && <> · 위치 <code className="font-mono">{path}</code></>}
      </p>
      {cite.quote && (
        <blockquote className="mt-2 border-l-2 border-gray-300 pl-2 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-300">
          {cite.quote}
        </blockquote>
      )}
      <div className="mt-2 flex gap-3 text-xs">
        {cite.doc_slug && (
          <Link to={`/docs/${cite.doc_slug}`} className="text-smsg-700 hover:underline dark:text-smsg-300">원천 문서</Link>
        )}
        {cite.url && (
          <a href={cite.url} target="_blank" rel="noreferrer" className="text-smsg-700 hover:underline dark:text-smsg-300">
            원본 열기
          </a>
        )}
      </div>
    </div>
  )
}

/** 블록 하나를 감싸 그 블록의 근거 번호를 끝에 단다. 근거가 없거나 위키 문서가 아니면 그대로. */
export function WikiCited({ blockId, children }: { blockId: string; children: ReactNode }) {
  const ctx = useContext(CitationsContext)
  const [open, setOpen] = useState<string | null>(null)
  const cites = ctx?.page.citations[blockId]
  if (!ctx || !cites?.length) return <>{children}</>
  const unique = cites.filter((c, i) => cites.findIndex((x) => x.source_id === c.source_id) === i)
  return (
    <div data-wiki-cited={blockId}>
      {children}
      <div className="relative mt-0.5 flex justify-end gap-1" data-testid="wiki-footnotes">
        {unique.map((c) => {
          const n = ctx.numberOf[c.source_id] ?? 0
          return (
            <button
              key={c.source_id}
              type="button"
              onClick={() => setOpen(open === c.source_id ? null : c.source_id)}
              aria-expanded={open === c.source_id}
              title={c.title}
              className="rounded px-1 font-mono text-[11px] leading-4 text-smsg-700 hover:bg-smsg-50 dark:text-smsg-300 dark:hover:bg-gray-800"
            >
              [{n}]
            </button>
          )
        })}
        {open && (
          <SourceCard
            cite={unique.find((c) => c.source_id === open) as WikiCite}
            n={ctx.numberOf[open] ?? 0}
            onClose={() => setOpen(null)}
          />
        )}
      </div>
    </div>
  )
}

/** 위키 문서 머리띠 — 관리 주체 · 종류 · 범위 · 잠금 · 낡음 배지와 '이 문서가 기대는 원천'. */
export function WikiPageBanner({ page }: { page: WikiPageInfo }) {
  const [showSources, setShowSources] = useState(false)
  return (
    <div
      data-testid="wiki-page-banner"
      className="rounded-lg border border-smsg-100 bg-smsg-50/60 px-4 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={page.managed === 'ai' ? 'brand' : 'neutral'}>{page.managed === 'ai' ? 'AI 관리' : '사람 관리'}</Badge>
        {page.entity && <Badge tone="muted">{page.entity.type_key}</Badge>}
        {!page.entity && <Badge tone="muted">{page.kind}</Badge>}
        {page.audience.map((a) => (
          <Badge key={a} tone={a === 'org' ? 'neutral' : 'warn'}>{a === 'org' ? '전사' : a}</Badge>
        ))}
        {page.review_lock && <Badge tone="info">검토 잠금</Badge>}
        {page.stale_since && <Badge tone="error">낡음 · {kst(page.stale_since).slice(0, 10)}</Badge>}
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          aria-expanded={showSources}
          className="ml-auto text-xs text-smsg-700 hover:underline dark:text-smsg-300"
        >
          이 문서가 기대는 원천 {page.sources.length}
        </button>
      </div>
      {showSources && (
        <ol className="mt-2 space-y-1 text-xs" data-testid="wiki-page-sources">
          {page.sources.map((s, i) => (
            <li key={s.source_id} className="flex gap-2">
              <span className="font-mono text-gray-500">[{i + 1}]</span>
              <Link to={`/wiki/sources/${s.source_id}`} className="text-smsg-700 hover:underline dark:text-smsg-300">
                {s.title}
              </Link>
              <span className="text-gray-500 dark:text-gray-400">
                {sourceKindLabel(s.kind)} · {s.system} · {kst(s.captured_at).slice(0, 10)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
