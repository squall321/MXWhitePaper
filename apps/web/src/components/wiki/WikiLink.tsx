import { useNavigate } from 'react-router-dom'
import { useRef, useState, type MouseEvent, type TouchEvent } from 'react'
import { useDocumentExists } from '@/features/document/hooks/useDocumentExists'
import { useEditorStore } from '@/features/editor/state'
import { useAuthStore } from '@/features/auth/store'
import type {
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'
import { useSectionCollapseStore } from '@/features/editor/sectionCollapseStore'
import { LinkPreview } from './LinkPreview'
import { ProposeTermModal } from '@/features/glossary/components/ProposeTermModal'
import { withBase } from '@/lib/basePath'

// Long-press threshold (ms) on touch — matches the project's other
// long-press affordances (BlockRenderer drag-handle, SectionRenderer).
const LONG_PRESS_MS = 500

// 500ms mouseenter debounce before the preview popup fetches/shows.
const HOVER_DELAY_MS = 500

interface WikiLinkProps {
  /** Empty string means "current document" (same-doc anchor). */
  slug: string
  /** Either `1.1` or `section-1.1` — both forms are accepted. */
  anchor?: string
  display?: string
}

/**
 * Internal wiki link.
 *
 *   - Live (slug exists)        → blue `<a href="/docs/<slug>#section-<anchor>">`.
 *   - Missing (404)             → red link; click navigates to `/docs/<slug>?create=1`.
 *   - Pending / network         → render as if-exists (blue) so first paint isn't red.
 *   - Same-doc anchor (slug='') → blue link; click smooth-scrolls + updates `#hash`
 *                                 via `history.replaceState`. If the target section
 *                                 lives in a collapsed group, the link expands it
 *                                 first (via `sectionCollapseStore`) so the anchor
 *                                 lands on visible content.
 */
export function WikiLink({ slug, anchor, display }: WikiLinkProps) {
  const navigate = useNavigate()
  // Skip the existence query for same-doc anchors (slug === '').
  const { data: exists, isPending } = useDocumentExists(slug || undefined)

  // editor+admin gating for the redlink → propose-term secondary action.
  // Viewers never see the affordance — the BE would 403 anyway, and the
  // tooltip noise would confuse readers.
  const role = useAuthStore((s) => s.user?.role)
  const canPropose = role === 'admin' || role === 'editor'

  // Hover state for the preview popup. Only enabled for cross-doc links;
  // same-doc anchors already show the section title via the inline label.
  const [hovered, setHovered] = useState(false)
  // Propose-term modal state — opens on right-click / long-press of a
  // redlink for editor+admin. Initial term defaults to the wiki slug.
  const [proposeOpen, setProposeOpen] = useState(false)
  const anchorElRef = useRef<HTMLAnchorElement | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const handleEnter = (e: MouseEvent<HTMLAnchorElement>) => {
    anchorElRef.current = e.currentTarget
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = window.setTimeout(() => {
      setHovered(true)
    }, HOVER_DELAY_MS)
  }
  const handleLeave = () => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHovered(false)
  }
  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const sameDoc = slug === ''
  // Normalise anchor → numeric portion (`1.1`) and the DOM id (`section-1.1`).
  const anchorId = anchor ? toAnchorId(anchor) : undefined
  const anchorNum = anchor ? toAnchorNumber(anchor) : undefined

  // Display fallback for same-doc anchors: walk the editor draft for the
  // section's title. Falls back to the literal `#section-<num>` slug.
  const sameDocDefaultLabel = sameDoc && anchorNum ? findSectionTitle(anchorNum) : null
  const label =
    display ??
    (sameDoc
      ? sameDocDefaultLabel ?? (anchorId ? `#${anchorId}` : '')
      : slug)

  const href = sameDoc
    ? `#${anchorId}`
    : anchorId
      ? withBase(`/docs/${encodeURIComponent(slug)}#${anchorId}`)
      : withBase(`/docs/${encodeURIComponent(slug)}`)

  // While loading we render the blue variant — the cache is shared so most
  // links resolve instantly anyway. Same-doc anchors skip the existence check.
  const isMissing = !sameDoc && exists === false && !isPending

  if (isMissing) {
    // Missing target → land on the new-doc wizard with the slug pre-filled,
    // so a click straight from a red wiki-link starts authoring immediately.
    //
    // Secondary action (editor+admin only): the same slug is often a candidate
    // term. Right-click or long-press opens the propose-term modal with the
    // slug pre-filled instead of navigating to the new-doc wizard. We keep
    // it as a secondary gesture so the primary click still does the obvious
    // thing (create document) — the redlink isn't necessarily a term.
    const target = `/docs/new?slug=${encodeURIComponent(slug)}`
    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
      clearLongPress()
      navigate(target)
    }
    const handleContextMenu = (e: MouseEvent<HTMLAnchorElement>) => {
      if (!canPropose) return
      e.preventDefault()
      setProposeOpen(true)
    }
    const handleTouchStart = () => {
      if (!canPropose) return
      clearLongPress()
      longPressTimerRef.current = window.setTimeout(() => {
        setProposeOpen(true)
      }, LONG_PRESS_MS)
    }
    const handleTouchEnd = (e: TouchEvent<HTMLAnchorElement>) => {
      // If long-press already fired and opened the modal, suppress the
      // synthetic click so the user doesn't jump to /docs/new behind the
      // modal. Otherwise let the click through.
      clearLongPress()
      if (proposeOpen) e.preventDefault()
    }
    const titleHint = canPropose
      ? `'${slug}' 문서가 아직 없습니다. 클릭해 생성하거나, 우클릭/길게-누르기로 용어를 제안하세요.`
      : `'${slug}' 문서가 아직 없습니다. 클릭해 생성하세요.`
    return (
      <>
        <a
          href={withBase(target)}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={clearLongPress}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          className="text-link-missing hover:underline"
          title={titleHint}
          data-redlink-slug={slug}
        >
          {label}
        </a>
        {hovered && (
          <LinkPreview
            slug={slug}
            anchor={anchor}
            anchorEl={anchorElRef.current}
            onClose={handleLeave}
          />
        )}
        {canPropose && (
          <ProposeTermModal
            open={proposeOpen}
            initialTerm={slug}
            onClose={() => setProposeOpen(false)}
          />
        )}
      </>
    )
  }

  if (sameDoc && anchorId) {
    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
      scrollToAnchor(anchorId, anchorNum ?? '')
    }
    return (
      <a
        href={href}
        onClick={handleClick}
        className="text-link hover:underline"
        title={`#${anchorId}`}
      >
        {label}
      </a>
    )
  }

  return (
    <>
      <a
        href={href}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className="text-link hover:underline"
        title={anchorId ? `${slug} #${anchorId}` : slug}
      >
        {label}
      </a>
      {hovered && !sameDoc && (
        <LinkPreview
          slug={slug}
          anchor={anchor}
          anchorEl={anchorElRef.current}
          onClose={handleLeave}
        />
      )}
    </>
  )
}

/**
 * Returns the DOM id form (`section-1.1`) for either an already-prefixed
 * anchor or a bare numeric one.
 */
function toAnchorId(anchor: string): string {
  return anchor.startsWith('section-') ? anchor : `section-${anchor}`
}

/**
 * Returns the bare numeric portion (`1.1`) from either form.
 */
function toAnchorNumber(anchor: string): string {
  return anchor.startsWith('section-') ? anchor.slice('section-'.length) : anchor
}

/**
 * Walk the editor draft for a section whose `number` matches `num` (e.g.
 * `'1.1'`). Returns the section title or `null` when not found / no draft.
 * Used as the display fallback for `[[#section-1.1]]` (no explicit label).
 */
function findSectionTitle(num: string): string | null {
  const draft = useEditorStore.getState().draft
  if (!draft) return null
  type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3
  const stack: AnySection[] = [...draft.sections]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur) continue
    if (cur.number === num) return cur.title
    if ('subsections' in cur && cur.subsections) {
      for (const s of cur.subsections) stack.push(s as AnySection)
    }
  }
  return null
}

/**
 * Smooth-scroll to the heading element with id `domId` (e.g. `section-1.1`)
 * and update the URL hash without triggering a route change. If the section
 * lives inside a collapsed group (per `sectionCollapseStore`), expand it
 * first so the anchor lands on visible content.
 *
 * `numericAnchor` is the bare anchor (e.g. `1.1`) used to find the matching
 * section's ULID in the current draft — the collapse store keys on ULIDs,
 * not DOM ids.
 */
function scrollToAnchor(domId: string, numericAnchor: string) {
  const draft = useEditorStore.getState().draft
  const slug = useEditorStore.getState().slug
  if (draft && slug) {
    const sectionId = findSectionIdByNumber(numericAnchor)
    if (sectionId) {
      const store = useSectionCollapseStore.getState()
      if (store.isCollapsed(slug, sectionId)) {
        store.setCollapsed(slug, sectionId, false)
      }
    }
  }

  // Wait one frame so the layout reflows after any expand call before we
  // measure the target element's position.
  requestAnimationFrame(() => {
    const el = document.getElementById(domId)
    if (!el) {
       
      console.warn(`[WikiLink] scroll target #${domId} not found`)
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    try {
      history.replaceState(null, '', `#${domId}`)
    } catch {
      /* SecurityError in some sandboxed iframes — ignore */
    }
  })
}

/**
 * Walk the editor draft for the section whose `number` matches `num` and
 * return its ULID, or null when not found / no draft.
 */
function findSectionIdByNumber(num: string): string | null {
  const draft = useEditorStore.getState().draft
  if (!draft) return null
  type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3
  const stack: AnySection[] = [...draft.sections]
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
