import type {
  DocumentJSONV10,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'
import type { DocumentMetaEnvelope, DocumentRow } from '@/features/document/api'
import { Infobox } from './Infobox'
import { SectionRenderer } from './SectionRenderer'
import { Badge } from '@/components/ui'
import { FavoriteStar } from '@/features/favorites/components/FavoriteStar'
import { BookmarkButton } from '@/features/bookmarks/components/BookmarkButton'
import { FollowButton } from '@/features/subscriptions/FollowButton'
import { estimateReadingTimeMinutes } from '@/lib/readingTime'
import { Suspense, lazy } from 'react'
import { useSectionCollapseStore } from '@/features/editor/sectionCollapseStore'
// BulkActionsBar only renders inside the editable surface and is rarely shown
// (multi-select state). Lazy so the read-mode reader doesn't ship its code.
const BulkActionsBar = lazy(() =>
  import('@/features/editor/components/BulkActionsBar').then((m) => ({
    default: m.BulkActionsBar,
  })),
)
import { SectionSwipe } from '@/features/mobile/SectionSwipe'
import { ReviewersPanel } from '@/features/approvals/ReviewersPanel'
import { WorkflowRibbon } from '@/features/approvals/WorkflowRibbon'
import { SeriesNav } from '@/features/series/SeriesNav'
import { AddToSeriesButton } from '@/features/series/AddToSeriesButton'
import { OfflineBanner } from '@/features/pwa/OfflineBanner'
import { PresenceAvatars } from '@/features/presence/PresenceAvatars'
import { BlockPresenceMarker } from '@/features/presence/BlockPresenceMarker'
import { useAnchorBlockTracker } from '@/features/presence/useAnchorBlockTracker'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type DocStatus, transitionStatus } from '@/features/approvals/api'
import { useAuthStore } from '@/features/auth/store'
import { DocAnalyticsModal } from '@/features/analytics/DocAnalyticsModal'
import { SaveAsTemplateModal } from '@/features/templates/SaveAsTemplateModal'
import { ReactionBar } from '@/features/reactions/ReactionBar'
import { ReadReceiptPanel } from '@/features/read-receipts/ReadReceiptPanel'
import { AckReadButton } from '@/features/read-receipts/AckReadButton'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'

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
type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3

function collectSectionIds(sections: readonly AnySection[]): string[] {
  const out: string[] = []
  const walk = (s: AnySection) => {
    if (s?.id) out.push(s.id)
    if ('subsections' in s && Array.isArray(s.subsections)) {
      for (const sub of s.subsections) walk(sub as AnySection)
    }
  }
  for (const s of sections) walk(s)
  return out
}

export function WikiArticle({ document, row, meta, editableSlug }: WikiArticleProps) {
  // Defensive: insertBlock 등 부분 응답이 metadata 를 빠뜨려도 (또는 신규 문서가
  // empty metadata 인 경우) 페이지 전체가 흰 화면이 되지 않게 한다.
  const md = document.metadata ?? {}
  const path = [md.division, md.team, md.group, md.part]
    .filter(Boolean)
    .join(' / ')
  const updatedAt = row?.updated_at ?? meta?.updated_at

  // Approval workflow: status comes from the document row (not the JSON
  // body). We track it locally so the ribbon can update without a full
  // doc refetch. `reviewerBump` invalidates the ribbon's reviewer cache
  // when the panel mutates.
  const initialStatus = (row?.status as DocStatus | undefined) ?? 'draft'
  const [workflowStatus, setWorkflowStatus] =
    useState<DocStatus>(initialStatus)
  const [reviewerBump, setReviewerBump] = useState(0)
  const showApprovals =
    !!editableSlug && (row?.status ?? 'draft') !== 'archived'

  // "전체 펴기 / 접기" — operates on section-level collapse only.
  // Block-level meta.collapsed is intentionally NOT touched here: walking the
  // tree to flip every block's meta would mean N patchBlock calls (or a giant
  // PUT) and most users won't expect a "fold sections" button to disturb
  // individual chart toggles.
  const slug = editableSlug ?? document.slug
  const expandAll = useSectionCollapseStore((s) => s.expandAll)
  const collapseAll = useSectionCollapseStore((s) => s.collapseAll)

  // Pipe the topmost-visible block id into the presence anchor cache so
  // the heartbeat can broadcast where each viewer is reading.
  useAnchorBlockTracker(document.slug)

  // Cycle 0016 — per-doc analytics modal (editor+ visible).
  const userRole = useAuthStore((s) => s.user?.role)
  const canViewAnalytics =
    !!editableSlug && (userRole === 'editor' || userRole === 'admin')
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  // Cycle 0020 — save-as-template (editor+ only). Visible whenever the user
  // could edit the doc; we don't gate on editableSlug because templates are
  // independent of edit permission on a specific doc.
  const canSaveTemplate = userRole === 'editor' || userRole === 'admin'
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)

  // Cycle 8 — quick archive button (editor+ on non-archived docs).
  const navigate = useNavigate()
  const isArchived = workflowStatus === 'archived'
  const canArchive =
    !!editableSlug &&
    !isArchived &&
    (userRole === 'editor' || userRole === 'admin')
  const isAdmin = userRole === 'admin'
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const onArchive = async () => {
    if (!editableSlug || archiveBusy) return
    setArchiveBusy(true)
    try {
      await transitionStatus(editableSlug, 'archived')
      toast.success('문서를 보관 처리했습니다.')
      setArchiveConfirmOpen(false)
      navigate('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '보관 실패')
    } finally {
      setArchiveBusy(false)
    }
  }
  const onUnarchive = async () => {
    if (!editableSlug || archiveBusy) return
    setArchiveBusy(true)
    try {
      const res = await transitionStatus(editableSlug, 'draft')
      setWorkflowStatus(res.status)
      toast.success('보관을 해제했습니다 (초안).')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복원 실패')
    } finally {
      setArchiveBusy(false)
    }
  }

  return (
    <article className="relative space-y-6">
      <OfflineBanner />
      {isArchived && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="archived-doc-banner"
          role="status"
        >
          <span aria-hidden="true">📦</span>
          <span>이 문서는 보관 처리되었습니다 — 일반 사용자에게 보이지 않습니다.</span>
          {isAdmin && editableSlug && (
            <button
              type="button"
              onClick={() => void onUnarchive()}
              disabled={archiveBusy}
              className="ml-auto rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              data-testid="archived-banner-unarchive"
            >
              복원
            </button>
          )}
        </div>
      )}
      {showApprovals && editableSlug && (
        <WorkflowRibbon
          slug={editableSlug}
          status={workflowStatus}
          reloadKey={reviewerBump}
          onTransitioned={(next) => setWorkflowStatus(next)}
        />
      )}
      <SeriesNav slug={document.slug} placement="top" />
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
          <PresenceAvatars slug={document.slug} />
          {row?.id && (
            <AddToSeriesButton slug={document.slug} documentId={row.id} />
          )}
          {canViewAnalytics && (
            <button
              type="button"
              onClick={() => setAnalyticsOpen(true)}
              className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-smsg-700"
              data-testid="open-doc-analytics"
              aria-label="문서 통계"
              title="문서 통계"
            >
              <span aria-hidden="true">📊</span>
              <span className="ml-1 hidden sm:inline">통계</span>
            </button>
          )}
          {canSaveTemplate && (
            <button
              type="button"
              onClick={() => setSaveTemplateOpen(true)}
              className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-smsg-700"
              data-testid="open-save-as-template"
              aria-label="템플릿으로 저장"
              title="템플릿으로 저장"
            >
              <span aria-hidden="true">📋</span>
              <span className="ml-1 hidden sm:inline">템플릿으로 저장</span>
            </button>
          )}
          {canArchive && (
            <button
              type="button"
              onClick={() => setArchiveConfirmOpen(true)}
              className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-smsg-700"
              data-testid="open-archive-doc"
              aria-label="보관"
              title="보관"
            >
              <span aria-hidden="true">📦</span>
              <span className="ml-1 hidden sm:inline">보관</span>
            </button>
          )}
          <AckReadButton slug={document.slug} docStatus={workflowStatus} />
          <FavoriteStar slug={document.slug} title={document.title} />
          <BookmarkButton slug={document.slug} title={document.title} />
          <FollowButton slug={document.slug} />
        </div>
        <ReadingTimePill document={document} />
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

      {(document.sections ?? []).length > 0 && (
        <div
          className="flex justify-end gap-1 text-xs"
          data-testid="section-collapse-controls"
        >
          <button
            type="button"
            onClick={() => collapseAll(slug, collectSectionIds((document.sections ?? []) as AnySection[]))}
            className="rounded border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 hover:text-smsg-700"
          >
            전체 접기
          </button>
          <button
            type="button"
            onClick={() => expandAll(slug)}
            className="rounded border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 hover:text-smsg-700"
          >
            전체 펴기
          </button>
        </div>
      )}

      <div className="clearfix">
        {document.infobox && <Infobox data={document.infobox} />}
        <SectionSwipe
          sectionIds={(document.sections ?? []).map((s) =>
            s.number ? `section-${s.number}` : s.id,
          )}
        >
          <div className="space-y-6">
            {(document.sections ?? []).map((section, idx) => (
              <SectionRenderer
                key={section.id}
                section={section}
                editableSlug={editableSlug}
                autoFocusInline={idx === 0}
                collapseSlug={slug}
              />
            ))}
          </div>
        </SectionSwipe>
      </div>
      {/* Cycle 0021 — doc-level emoji reactions. Lives at article bottom so
          readers see it after digesting the body. */}
      <div className="flex flex-col items-start gap-2 border-t border-gray-200 pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          이 문서에 반응
        </span>
        <ReactionBar slug={document.slug} documentId={row?.id} />
      </div>
      <SeriesNav slug={document.slug} placement="bottom" />
      {showApprovals && editableSlug && (
        <ReviewersPanel
          slug={editableSlug}
          onChange={() => setReviewerBump((n) => n + 1)}
        />
      )}
      {/* Cycle 0023 — read receipts surface for the doc author / reviewers.
          Editor+ only; the panel itself is silent on permission errors. */}
      {editableSlug && (userRole === 'editor' || userRole === 'admin') && (
        <ReadReceiptPanel slug={editableSlug} />
      )}
      {/* Floating bulk-actions bar — renders only when the bulk-selection
          store has at least one block. Lives at the article level so its
          fixed-position pill doesn't multiply across nested sections. */}
      {editableSlug && (
        <Suspense fallback={null}>
          <BulkActionsBar slug={editableSlug} />
        </Suspense>
      )}
      {/* Right-margin presence dots — sibling overlay layer that polls
          getBoundingClientRect every 200ms; never touches block internals. */}
      <BlockPresenceMarker slug={document.slug} />
      {canViewAnalytics && (
        <DocAnalyticsModal
          slug={document.slug}
          open={analyticsOpen}
          onClose={() => setAnalyticsOpen(false)}
        />
      )}
      {canSaveTemplate && (
        <SaveAsTemplateModal
          document={document}
          open={saveTemplateOpen}
          onClose={() => setSaveTemplateOpen(false)}
        />
      )}
      <Modal
        open={archiveConfirmOpen}
        onClose={() => setArchiveConfirmOpen(false)}
        title="문서 보관 확인"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setArchiveConfirmOpen(false)}
              data-testid="archive-doc-cancel"
            >
              취소
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={archiveBusy}
              onClick={() => void onArchive()}
              data-testid="archive-doc-confirm"
            >
              보관
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4 text-sm text-gray-700">
          <p>이 문서를 보관 처리합니다. 일반 사용자에게는 더 이상 노출되지 않으며, 관리자가 보관 문서 페이지에서 복원할 수 있습니다.</p>
        </div>
      </Modal>
    </article>
  )
}

function formatDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso
}

function ReadingTimePill({ document }: { document: DocumentJSONV10 }) {
  const minutes = estimateReadingTimeMinutes(document)
  if (!minutes) return null
  return (
    <div className="text-xs text-gray-500" data-testid="reading-time-pill">
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-gray-600">
        <span aria-hidden="true">📖</span>
        <span>~{minutes}분 분량</span>
      </span>
    </div>
  )
}
