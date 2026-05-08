import type { DocumentJSONV10 } from '@/types/document'
import type { DocumentMetaEnvelope, DocumentRow } from '@/features/document/api'
import { Infobox } from './Infobox'
import { SectionRenderer } from './SectionRenderer'
import { Badge } from '@/components/ui'
import { FavoriteStar } from '@/features/favorites/components/FavoriteStar'

interface WikiArticleProps {
  document: DocumentJSONV10
  row?: DocumentRow
  meta?: DocumentMetaEnvelope
  /** When provided, sections expose the quick-edit pencil. */
  editableSlug?: string
}

/**
 * Article shell — title + summary + meta strip (team / part / 마지막 편집)
 * with the Infobox floating right and the recursive section tree below.
 *
 * Visual: stronger title hierarchy, subtle gradient accent under the slug
 * pill, owner/tag badges in the meta strip.
 */
export function WikiArticle({ document, row, meta, editableSlug }: WikiArticleProps) {
  // Defensive: insertBlock 등 부분 응답이 metadata 를 빠뜨려도 (또는 신규 문서가
  // empty metadata 인 경우) 페이지 전체가 흰 화면이 되지 않게 한다.
  const md = document.metadata ?? {}
  const path = [md.division, md.team, md.group, md.part]
    .filter(Boolean)
    .join(' / ')
  const updatedAt = row?.updated_at ?? meta?.updated_at

  return (
    <article className="space-y-6">
      <header className="space-y-3 border-b border-gray-200 pb-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-smsg-50 px-2 py-0.5 font-mono text-[11px] text-smsg-700">
            /{document.slug}
          </span>
          {md.confidentiality && (
            <Badge tone={md.confidentiality === 'public' ? 'success' : md.confidentiality === 'restricted' ? 'warn' : 'brand'}>
              {md.confidentiality}
            </Badge>
          )}
          {(md.tags ?? []).slice(0, 3).map((t) => (
            <Badge key={t} tone="muted" size="sm">#{t}</Badge>
          ))}
        </div>
        <div className="flex items-start gap-2">
          <h1 className="flex-1 text-3xl font-semibold tracking-tight text-smsg-900 sm:text-4xl">
            {document.title}
          </h1>
          <FavoriteStar slug={document.slug} title={document.title} />
        </div>
        {document.summary && (
          <p className="text-base leading-relaxed text-gray-700">{document.summary}</p>
        )}
        <p className="text-xs text-gray-500">
          {path && <span>{path}</span>}
          {path && updatedAt && <span className="mx-2">·</span>}
          {updatedAt && (
            <span>마지막 편집: <time>{formatDate(updatedAt)}</time></span>
          )}
        </p>
      </header>

      <div className="clearfix">
        {document.infobox && <Infobox data={document.infobox} />}
        <div className="space-y-6">
          {(document.sections ?? []).map((section, idx) => (
            <SectionRenderer
              key={section.id}
              section={section}
              editableSlug={editableSlug}
              autoFocusInline={idx === 0}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

function formatDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso
}
