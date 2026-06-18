import { Suspense, lazy, useEffect, useState } from 'react'
import { useParams, useOutletContext, useSearchParams } from 'react-router-dom'
import { useDocument } from '@/features/document/hooks/useDocument'
import { WikiArticle } from '@/components/WikiArticle'
import { RightRail } from '@/components/layout/RightRail'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { useEditorShortcuts } from '@/features/editor/hooks/useEditorShortcuts'
import { useAutoSave } from '@/features/editor/hooks/useAutoSave'
import { EditorToolbar } from '@/features/editor/components/EditorToolbar'
import { QuickInsertBar } from '@/features/editor/components/QuickInsertBar'
import { OutlinePanel } from '@/features/editor/components/OutlinePanel'
import { VersionHistoryPanel } from '@/features/editor/components/VersionHistoryPanel'
// ConflictMergeModal only mounts when an ETag conflict actually fires —
// defer the chunk so it doesn't bloat the reader's first paint.
const ConflictMergeModal = lazy(() =>
  import('@/features/editor/components/ConflictMergeModal').then((m) => ({
    default: m.ConflictMergeModal,
  })),
)
import { OnboardingTour } from '@/features/editor/components/OnboardingTour'
import { EditorHelpButton } from '@/features/editor/components/EditorHelpButton'
import { ArticleDropSurface } from '@/features/upload/components/ArticleDropSurface'
import { OrgTree } from '@/features/org/components/OrgTree'
import { Drawer } from '@/components/ui/Drawer'
import { pushRecent } from '@/features/recent/store'
import { withBase } from '@/lib/basePath'
import { useReadingTimeTracker } from '@/features/bookmarks/hooks/useReadingTimeTracker'
import type { AppOutletContext } from '@/App'
import { useSectionCollapseStore } from '@/features/editor/sectionCollapseStore'
import type {
  DocumentJSONV10,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'

/**
 * Walk the document tree for a section whose `number` matches `num` and
 * return its ULID. Used by the collapse-aware deep-link effect to translate
 * a `#section-1.1` hash into the section identifier the collapse store
 * keys on.
 */
function findSectionUlidByNumber(
  doc: DocumentJSONV10,
  num: string,
): string | null {
  type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3
  const stack: AnySection[] = [...doc.sections]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur) continue
    if (cur.number === num) return cur.id
    if ('subsections' in cur && cur.subsections) {
      for (const s of cur.subsections) stack.push(s as AnySection)
    }
  }
  return null
}

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

  // Server-side read tracking — accumulates seconds while the page is visible
  // and flushes every 30s + on unmount. Decoupled from analytics view ping so
  // the reading-list query reflects per-doc time spent, not just visit count.
  useReadingTimeTracker(data ? slug : undefined)

  // Tier 2D — analytics view ping. Fire-and-forget; failures are silent so
  // the read-only UX never depends on the analytics pipeline.
  useEffect(() => {
    if (!slug || !data) return
    const url = (import.meta.env.VITE_API_URL as string | undefined) || `${import.meta.env.BASE_URL}api/v1`
    void fetch(`${url}/documents/${slug}/view`, {
      method: 'POST',
      credentials: 'include',
      headers: (() => {
        const h: Record<string, string> = {}
        try {
          const tok = window.sessionStorage.getItem('mxwp.access_token')
          if (tok) h['Authorization'] = `Bearer ${tok}`
        } catch {
          /* ignore */
        }
        return h
      })(),
    }).catch(() => {
      /* ignore */
    })
  }, [slug, data])

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
    onUndo: () => void useEditorStore.getState().undo(),
    onRedo: () => void useEditorStore.getState().redo(),
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

  // FE PDF fallback — `?print=1` triggers `window.print()` once the doc
  // has settled. After the print dialog closes we strip the param so a
  // reload doesn't re-trigger the dialog. Two rAF ticks let WikiArticle
  // commit its layout (charts/images) before the snapshot is captured.
  useEffect(() => {
    if (!data) return
    if (typeof window === 'undefined') return
    if (searchParams.get('print') !== '1') return
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          window.print()
        } finally {
          const url = new URL(window.location.href)
          url.searchParams.delete('print')
          window.history.replaceState(null, '', url.toString())
        }
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [data, searchParams])

  // Deep-link to #section-X.Y.Z after the body has rendered. When the
  // target section sits inside a collapsed group, expand it first so the
  // anchor lands on visible content.
  useEffect(() => {
    if (!data) return
    if (typeof window === 'undefined') return
    const hash = window.location.hash?.replace(/^#/, '')
    if (!hash || !slug) return
    // hash is the DOM id (`section-1.1`); the collapse store keys on
    // section ULIDs. Walk the doc once for the matching ULID.
    if (hash.startsWith('section-')) {
      const num = hash.slice('section-'.length)
      const sectionId = findSectionUlidByNumber(data.document, num)
      if (sectionId) {
        const store = useSectionCollapseStore.getState()
        if (store.isCollapsed(slug, sectionId)) {
          store.setCollapsed(slug, sectionId, false)
        }
      }
    }
    const r = requestAnimationFrame(() => {
      const el = document.getElementById(hash)
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
    return () => cancelAnimationFrame(r)
  }, [data, slug])

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
              href={withBase(`/docs/new?slug=${encodeURIComponent(slug)}`)}
              className="rounded bg-smsg-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-smsg-900"
            >
              이 슬러그로 새 문서 작성
            </a>
            <a
              href={withBase('/')}
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
    <div className="space-y-3" data-testid="doc-reader">
      <EditorToolbar
        slug={slug}
        onSaveNow={() => void saveNow()}
        onToggleVersions={() => setShowVersions((v) => !v)}
        onToggleEdit={() => (isFullEditing ? exitToReader() : enterFullEdit())}
      />

      {isFullEditing && (
        <CollapsibleOutline slug={slug} document={live} />
      )}

      {isFullEditing ? (
        <ArticleDropSurface slug={slug} document={live}>
          <WikiArticle document={live} row={data.row} meta={data.meta} editableSlug={slug} />
        </ArticleDropSurface>
      ) : (
        <WikiArticle document={live} row={data.row} meta={data.meta} editableSlug={slug} />
      )}

      {isFullEditing && <QuickInsertBar slug={slug} />}

      {conflict && (
        <Suspense fallback={null}>
          <ConflictMergeModal slug={slug} />
        </Suspense>
      )}
      {isFullEditing && <OnboardingTour />}
      <EditorHelpButton />

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

/**
 * Collapsible 아웃라인 wrapper used inside fullEdit.
 *
 * Why: when the document has many sections the OutlinePanel grows to
 * hundreds of pixels tall and pushes the float-right Infobox far down the
 * page, making it look like the outline is "covering" the Infobox area.
 * Defaulting to collapsed (and remembering the user's choice in
 * localStorage per slug) keeps the editing surface compact while still
 * giving one-click access to the structural editor.
 */
function CollapsibleOutline({
  slug,
  document,
}: {
  slug: string
  document: import('@/types/document').DocumentJSONV10
}) {
  const storageKey = `outline-open:${slug}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, open ? '1' : '0')
    } catch {
      /* private mode / no storage — silently OK */
    }
  }, [open, storageKey])

  // Count top-level + nested sections so the collapsed header can
  // surface "(N개 섹션)" as a useful hint without expanding.
  const sectionCount = countSectionsDeep(document.sections ?? [])

  return (
    <div className="rounded border border-smsg-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-50"
        data-testid="outline-toggle"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span>아웃라인</span>
          {sectionCount > 0 && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal normal-case text-gray-500">
              {sectionCount}개 섹션
            </span>
          )}
        </span>
        <span className="text-[10px] font-normal normal-case text-gray-400">
          {open ? '접기' : '펴서 편집'}
        </span>
      </button>
      {open && (
        <div className="border-t border-smsg-100 p-3">
          <OutlinePanel slug={slug} document={document} />
        </div>
      )}
    </div>
  )
}

function countSectionsDeep(
  sections: readonly { subsections?: readonly unknown[] }[],
): number {
  let n = 0
  const walk = (list: readonly { subsections?: readonly unknown[] }[]) => {
    for (const s of list) {
      n += 1
      const sub = s.subsections as
        | readonly { subsections?: readonly unknown[] }[]
        | undefined
      if (sub && sub.length > 0) walk(sub)
    }
  }
  walk(sections)
  return n
}
