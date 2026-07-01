import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { DocumentJSONV10, GlossaryItem } from '@/types/document'
import { TableOfContents } from '../TableOfContents'
import { RelatedDocs } from '../RelatedDocs'
import { Backlinks } from '../Backlinks'
import { Relationships } from '../Relationships'
import { RailBoundary } from '../blocks/BlockBoundary'
import { CommentsThread } from '@/features/comments/components/CommentsThread'
import { useComments } from '@/features/comments/hooks/useComments'

interface RightRailProps {
  document: DocumentJSONV10
}

/**
 * Composes the right-column components: TOC + RelatedDocs + Backlinks +
 * Glossary. Glossary is rendered inline (small enough to belong here in
 * Sprints 2/3 — moves to its own page in Sprint 4 if the list grows).
 *
 * Each panel is wrapped in `<RailBoundary>` (Hardening C) so one panel
 * failing won't take the whole rail (and the page) down.
 *
 * Tier 2C — adds a "💬 댓글 / 📑 목차" toggle so the same column can swap
 * between TOC view and the comments thread, plus a "🌐 그래프 보기" link
 * underneath Backlinks linking to the wiki graph for this slug.
 */
export function RightRail({ document }: RightRailProps) {
  const [view, setView] = useState<'toc' | 'comments'>('toc')
  const { data: commentsData } = useComments(view === 'toc' ? undefined : document?.slug)

  if (!document) return null
  const related = Array.isArray(document.related_documents)
    ? document.related_documents
    : []
  const glossary = Array.isArray(document.glossary) ? document.glossary : []
  const commentCount = commentsData?.items?.filter((c) => c.status !== 'deleted').length ?? 0

  return (
    <div className="space-y-2 py-3" data-testid="right-rail-toc">
      <div
        role="tablist"
        aria-label="우측 패널 전환"
        className="flex gap-1 px-3 pb-1 text-xs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === 'toc'}
          data-testid="rail-tab-toc"
          onClick={() => setView('toc')}
          className={`flex items-center gap-1 rounded px-2 py-1 ${
            view === 'toc'
              ? 'bg-smsg-100 font-semibold text-smsg-900'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <span aria-hidden>📑</span> 목차
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'comments'}
          data-testid="rail-tab-comments"
          onClick={() => setView('comments')}
          className={`flex items-center gap-1 rounded px-2 py-1 ${
            view === 'comments'
              ? 'bg-smsg-100 font-semibold text-smsg-900'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <span aria-hidden>💬</span> 댓글
          {commentCount > 0 && (
            <span className="ml-1 rounded-full bg-smsg-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {commentCount}
            </span>
          )}
        </button>
      </div>

      {view === 'toc' ? (
        <>
          <RailBoundary name="목차">
            <TableOfContents document={document} />
          </RailBoundary>
          {related.length > 0 && (
            <RailBoundary name="관련 문서">
              <RelatedDocs items={related} />
            </RailBoundary>
          )}
          <RailBoundary name="백링크">
            <div data-testid="right-rail-backlinks">
              <Backlinks slug={document.slug} />
              <div className="mt-2 px-3">
                <Link
                  to={`/graph/${encodeURIComponent(document.slug)}`}
                  data-testid="rail-graph-link"
                  className="inline-flex items-center gap-1 text-xs text-link hover:underline"
                >
                  <span aria-hidden>🌐</span> 그래프 보기
                </Link>
              </div>
            </div>
          </RailBoundary>
          <RailBoundary name="관계">
            <Relationships slug={document.slug} />
          </RailBoundary>
          {glossary.length > 0 && (
            <RailBoundary name="용어집">
              <GlossaryPanel items={glossary} />
            </RailBoundary>
          )}
        </>
      ) : (
        <RailBoundary name="댓글">
          <CommentsThread slug={document.slug} />
        </RailBoundary>
      )}
    </div>
  )
}

function GlossaryPanel({ items }: { items: GlossaryItem[] }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <section aria-label="용어집" className="mt-6 px-3">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        용어
      </h3>
      <dl className="space-y-2 text-sm">
        {items.map((g) => (
          <div key={g?.term ?? Math.random().toString(36)}>
            <dt className="font-semibold text-smsg-900">{g?.term ?? '(용어 없음)'}</dt>
            <dd className="text-xs text-gray-600">{g?.definition ?? ''}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
