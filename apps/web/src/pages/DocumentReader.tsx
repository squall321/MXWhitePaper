import { useEffect, useState } from 'react'
import { useParams, useOutletContext, useSearchParams } from 'react-router-dom'
import { useDocument } from '@/features/document/hooks/useDocument'
import { WikiArticle } from '@/components/WikiArticle'
import { RightRail } from '@/components/layout/RightRail'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { useEditorShortcuts } from '@/features/editor/hooks/useEditorShortcuts'
import { useAutoSave } from '@/features/editor/hooks/useAutoSave'
import { EditorToolbar } from '@/features/editor/components/EditorToolbar'
import { OutlinePanel } from '@/features/editor/components/OutlinePanel'
import { VersionHistoryPanel } from '@/features/editor/components/VersionHistoryPanel'
import { ConflictMergeModal } from '@/features/editor/components/ConflictMergeModal'
import { OnboardingTour } from '@/features/editor/components/OnboardingTour'
import { ArticleDropSurface } from '@/features/upload/components/ArticleDropSurface'
import { OrgTree } from '@/features/org/components/OrgTree'
import { Drawer } from '@/components/ui/Drawer'
import { pushRecent } from '@/features/recent/store'
import type { AppOutletContext } from '@/App'

/**
 * Document reader.
 *
 *   - Loads the document via `useDocument(slug)` (data.data.content per the
 *     BE envelope contract).
 *   - In reader mode pushes the standard `<RightRail>` into the AppShell.
 *   - In fullEdit mode pushes `<VersionHistoryPanel>` into the right rail
 *     and renders `<EditorToolbar>` + (eventually) `<OutlinePanel>` instead
 *     of OrgTree (Sprint 6 will wire that into AppShell properly).
 *   - Honours hash-based deep links and `?edit=<sectionId>` for quick-edit
 *     deep-linking.
 */
export function DocumentReaderPage() {
  const { slug } = useParams<{ slug: string }>()
  const { setRightRail, setLeftRail } = useOutletContext<AppOutletContext>()
  const { data, isPending, isError, error } = useDocument(slug)
  const [searchParams] = useSearchParams()
  const [showVersions, setShowVersions] = useState(false)
  const [orgDrawerOpen, setOrgDrawerOpen] = useState(false)
  const status = (error as { response?: { status?: number } } | null)?.response
    ?.status

  const bind = useEditorStore((s) => s.bind)
  const reset = useEditorStore((s) => s.reset)
  const enterQuickEdit = useEditorStore((s) => s.enterQuickEdit)
  const enterFullEdit = useEditorStore((s) => s.enterFullEdit)
  const exitToReader = useEditorStore((s) => s.exitToReader)
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  const conflict = useEditorStore((s) => s.conflictRemote)
  const draft = useEditorStore((s) => s.draft)

  // Bind editor store to the loaded doc.
  useEffect(() => {
    if (data && slug) {
      bind(slug, data.document, data.meta.etag ?? '')
    }
    return () => reset()
  }, [data, slug, bind, reset])

  // Hide the desktop OrgTree column entirely on document pages — it's still
  // accessible via the floating "조직" toggle below (and the TopBar hamburger
  // on mobile).
  useEffect(() => {
    setLeftRail(null)
    return () => setLeftRail(undefined)
  }, [setLeftRail])

  // Record the view in localStorage once the document title is known.
  useEffect(() => {
    if (slug && data?.document?.title) {
      pushRecent(slug, data.document.title)
    }
  }, [slug, data?.document?.title])

  // Honour ?edit=<sectionId> + ?fullEdit=1 deep links.
  useEffect(() => {
    if (!data) return
    const editId = searchParams.get('edit')
    if (editId) {
      enterQuickEdit(editId)
      return
    }
    if (searchParams.get('fullEdit') === '1') enterFullEdit()
  }, [searchParams, data, enterQuickEdit, enterFullEdit])

  // Auto-save: only active in edit modes.
  const editing = useEditorStore(editorSelectors.isEditing)
  const { saveNow } = useAutoSave(slug, { enabled: editing })

  // Shortcuts.
  useEditorShortcuts(slug, {
    onSave: () => void saveNow(),
  })

  // Push correct right-rail.
  useEffect(() => {
    if (!data || !slug) {
      setRightRail(null)
      return
    }
    if (showVersions || isFullEditing) {
      setRightRail(<VersionHistoryPanel slug={slug} />)
    } else {
      setRightRail(<RightRail document={data.document} />)
    }
    return () => setRightRail(null)
  }, [data, slug, isFullEditing, showVersions, setRightRail])

  // Deep-link to #section-X.Y.Z after the body has rendered.
  useEffect(() => {
    if (!data) return
    const hash = window.location.hash?.replace(/^#/, '')
    if (!hash) return
    const r = requestAnimationFrame(() => {
      const el = document.getElementById(hash)
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
    return () => cancelAnimationFrame(r)
  }, [data])

  if (!slug) return <p className="text-sm text-red-600">missing slug parameter</p>
  if (isPending) return <p className="text-sm text-gray-500">loading…</p>
  if (isError) {
    if (status === 404) {
      return (
        <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-sm">
          <p className="font-semibold text-smsg-900">문서를 찾을 수 없습니다.</p>
          <p className="mt-1 text-gray-600">
            <code className="rounded bg-gray-100 px-1">{slug}</code> 슬러그에 해당하는
            문서가 없거나 보관되었습니다.
          </p>
          <div className="mt-3 flex gap-2">
            <a
              href={`/docs/new?slug=${encodeURIComponent(slug)}`}
              className="rounded bg-smsg-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-smsg-900"
            >
              이 슬러그로 새 문서 작성
            </a>
            <a
              href="/"
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              홈으로
            </a>
          </div>
        </div>
      )
    }
    if (status === 403) {
      return (
        <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          이 문서를 볼 권한이 없습니다.
        </p>
      )
    }
    return (
      <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        문서를 불러오지 못했습니다: {(error as Error).message}
      </p>
    )
  }
  if (!data) return <p className="text-sm text-gray-500">loading…</p>

  // Always work off the editor draft when present; falls back to server doc.
  const live = draft ?? data.document

  return (
    <div className="space-y-3">
      <EditorToolbar
        slug={slug}
        onSaveNow={() => void saveNow()}
        onToggleVersions={() => setShowVersions((v) => !v)}
        onToggleEdit={() => (isFullEditing ? exitToReader() : enterFullEdit())}
      />

      {isFullEditing && (
        <div className="rounded border border-smsg-100 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            아웃라인
          </h3>
          <OutlinePanel slug={slug} document={live} />
        </div>
      )}

      {isFullEditing ? (
        <ArticleDropSurface slug={slug} document={live}>
          <WikiArticle document={live} row={data.row} meta={data.meta} editableSlug={slug} />
        </ArticleDropSurface>
      ) : (
        <WikiArticle document={live} row={data.row} meta={data.meta} editableSlug={slug} />
      )}

      {conflict && <ConflictMergeModal slug={slug} />}
      {isFullEditing && <OnboardingTour />}

      {isFullEditing && (
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
          단축키 <kbd className="rounded border border-gray-300 bg-gray-50 px-1 font-mono">?</kbd>
        </div>
      )}

      {/* Floating "조직" toggle — desktop only. Mobile already gets the org
          tree via the TopBar hamburger drawer, so we hide this button below
          md to avoid duplicates. */}
      <button
        type="button"
        onClick={() => setOrgDrawerOpen(true)}
        aria-label="조직 트리 열기"
        className="fixed bottom-4 left-4 z-drawer hidden items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-smsg-900 shadow-md transition-all duration-base ease-out-soft hover:-translate-y-0.5 hover:border-smsg-300 md:inline-flex"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h5l1.5 1.5H14V13a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        조직
      </button>

      <Drawer
        open={orgDrawerOpen}
        onClose={() => setOrgDrawerOpen(false)}
        side="left"
        ariaLabel="조직 트리"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">조직</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setOrgDrawerOpen(false)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-2" onClick={() => setOrgDrawerOpen(false)}>
          <OrgTree />
        </div>
      </Drawer>
    </div>
  )
}
