import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Slug, SectionLevel1, SectionLevel2, SectionLevel3 } from '@/types/document'
import { BlockRenderer } from './blocks/BlockRenderer'
import { parseFootnoteDefinition } from './blocks/ParagraphBlock'
import { Inline } from './wiki/Inline'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { SectionQuickEdit } from '@/features/editor/components/SectionQuickEdit'
import { SimpleStackEditor } from '@/features/editor/components/SimpleStackEditor'
import { useSectionCollapseStore } from '@/features/editor/sectionCollapseStore'

/**
 * Local alias — the schema declares 3 explicit Section interfaces; mostly
 * we just want "any section" without re-declaring it everywhere.
 */
export type Section = SectionLevel1 | SectionLevel2 | SectionLevel3

interface SectionRendererProps {
  section: Section
  /** When provided, enables the quick-edit pencil and full-edit affordances. */
  editableSlug?: Slug
  /**
   * When true the SectionEditor auto-focuses on mount — used for the very
   * first level-1 section so a freshly-created doc lands the cursor inside
   * its first paragraph.
   */
  autoFocusInline?: boolean
  /**
   * Slug used as the collapse-state key. Defaults to `editableSlug` (always
   * set in app routes) but tests / read-only callers can pass it explicitly.
   */
  collapseSlug?: string
}

/**
 * Recursive Section node. Heading levels are mapped:
 *   level 1 → <h2>     (h1 is the document title)
 *   level 2 → <h3>
 *   level 3 → <h4>
 *
 * Each heading carries id="section-<number>" for in-page anchor links and a
 * hover-only `#` anchor that copies a permalink into the URL.
 */
export function SectionRenderer({
  section,
  editableSlug,
  autoFocusInline,
  collapseSlug,
}: SectionRendererProps) {
  const headingId = section.number ? `section-${section.number}` : section.id
  const subsections = ('subsections' in section && section.subsections
    ? section.subsections
    : []) as Section[]

  const isQuickEditing = useEditorStore(editorSelectors.isQuickEditing(section.id))
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  const enterQuickEdit = useEditorStore((s) => s.enterQuickEdit)
  const exitToReader = useEditorStore((s) => s.exitToReader)

  const slugForCollapse = collapseSlug ?? editableSlug ?? ''
  const collapsed = useSectionCollapseStore((s) =>
    slugForCollapse ? s.isCollapsed(slugForCollapse, section.id) : false,
  )
  const toggleCollapsed = useSectionCollapseStore((s) => s.toggle)

  if (isQuickEditing && editableSlug) {
    return (
      <SectionQuickEdit
        slug={editableSlug}
        section={section}
        onSaved={() => exitToReader()}
        onCancel={() => exitToReader()}
      />
    )
  }

  // In fullEdit mode the level-1 section becomes a SimpleStackEditor
  // (Notion-style block stack with `+` rails on every block, drag-to-reorder,
  // and inline contentEditable for text blocks). Replaces the BlockNote-based
  // SectionInlineEdit so users no longer need the "/" slash menu to add
  // widgets. Sub-sections still render below for structure visibility.
  if (isFullEditing && editableSlug && section.level === 1) {
    return (
      <div data-section-level={section.level}>
        <SimpleStackEditor
          slug={editableSlug}
          section={section}
          autoFocusTitle={autoFocusInline}
        />
        {subsections.length > 0 && (
          <div className="mt-4 space-y-6">
            {subsections.map((sub) => (
              <SectionRenderer
                key={sub.id}
                section={sub}
                editableSlug={editableSlug}
                collapseSlug={slugForCollapse}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const levelTextCls =
    section.level === 1
      ? 'text-2xl font-semibold mt-8 pb-1.5 border-b border-smsg-100 relative'
      : section.level === 2
      ? 'text-xl font-semibold mt-6'
      : 'text-lg font-semibold mt-4 text-gray-700'

  const showPencil = Boolean(editableSlug) && !isFullEditing

  const directBlockCount = (section.blocks ?? []).length
  const panelId = `section-panel-${section.id}`
  const onToggle = slugForCollapse
    ? () => toggleCollapsed(slugForCollapse, section.id)
    : undefined

  // Collect pandoc-style footnote definitions from this section's direct
  // paragraph blocks. We render them as a numbered list at the bottom of the
  // section so inline `[^N]` superscripts have a stable jump target. The
  // ParagraphBlock view hides the source paragraphs to avoid duplication.
  const footnotes = collectFootnotes(section.blocks ?? [])

  return (
    <section data-section-level={section.level} data-section-id={section.id}>
      <SectionHeading
        level={section.level}
        id={headingId}
        number={section.number}
        title={section.title}
        className={levelTextCls}
        onEdit={showPencil ? () => enterQuickEdit(section.id) : undefined}
        collapsed={collapsed}
        onToggleCollapsed={onToggle}
        controlsId={panelId}
        directBlockCount={directBlockCount}
      />

      <CollapsiblePanel id={panelId} collapsed={collapsed}>
        <div className="mt-3 space-y-4">
          {(section.blocks ?? []).map((block) => (
            <BlockRenderer key={block.id} block={block} />
          ))}
        </div>

        {footnotes.length > 0 && <FootnoteList footnotes={footnotes} />}

        {subsections.length > 0 && (
          <div className="mt-4 space-y-6">
            {subsections.map((sub) => (
              <SectionRenderer
                key={sub.id}
                section={sub}
                editableSlug={editableSlug}
                collapseSlug={slugForCollapse}
              />
            ))}
          </div>
        )}
      </CollapsiblePanel>
    </section>
  )
}

interface FootnoteEntry {
  tag: string
  body: string
}

/**
 * Walk a section's direct blocks and pull every paragraph whose text matches
 * the footnote-definition pattern (`[^TAG]: …`). Order = source order;
 * duplicate tags keep the first occurrence (silently — markdown-lite has no
 * concept of "valid"; the renderer should not throw).
 */
function collectFootnotes(blocks: readonly { type?: string; text?: string }[]): FootnoteEntry[] {
  const seen = new Set<string>()
  const out: FootnoteEntry[] = []
  for (const b of blocks) {
    if (b.type !== 'paragraph') continue
    const text = b.text ?? ''
    const def = parseFootnoteDefinition(text)
    if (!def) continue
    if (seen.has(def.tag)) continue
    seen.add(def.tag)
    out.push(def)
  }
  return out
}

/**
 * Section-bottom 각주 mini-list. Each entry carries `id="fn-TAG"` so the
 * inline `<sup><a href="#fn-TAG">` can scroll-jump to it; a `↩` back-link
 * targets `#fnref-TAG` so the reader returns to the citation.
 */
function FootnoteList({ footnotes }: { footnotes: FootnoteEntry[] }) {
  return (
    <aside
      data-footnote-list
      className="mt-6 border-t border-smsg-100 pt-3 text-xs text-gray-600"
      aria-label="각주"
    >
      <div className="mb-1 font-semibold text-gray-700">각주</div>
      <ol className="list-none space-y-1 pl-0">
        {footnotes.map((fn) => (
          <li key={fn.tag} id={`fn-${fn.tag}`} className="leading-5">
            <span className="mr-1 font-mono text-gray-500">[{fn.tag}]</span>
            <Inline text={fn.body} />
            <a
              href={`#fnref-${fn.tag}`}
              className="ml-1 text-link no-underline hover:underline"
              aria-label={`각주 ${fn.tag} 본문으로 돌아가기`}
            >
              ↩
            </a>
          </li>
        ))}
      </ol>
    </aside>
  )
}

interface SectionHeadingProps {
  level: 1 | 2 | 3
  id: string
  number?: string
  title: string
  className: string
  onEdit?: () => void
  collapsed: boolean
  onToggleCollapsed?: () => void
  controlsId: string
  directBlockCount: number
}

function SectionHeading({
  level,
  id,
  number,
  title,
  className,
  onEdit,
  collapsed,
  onToggleCollapsed,
  controlsId,
  directBlockCount,
}: SectionHeadingProps) {
  const inner = (
    <>
      {onToggleCollapsed && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onToggleCollapsed()
          }}
          aria-label={collapsed ? '섹션 펴기' : '섹션 접기'}
          aria-expanded={!collapsed}
          aria-controls={controlsId}
          data-testid="section-collapse-toggle"
          className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-smsg-500 transition-transform hover:bg-smsg-50 hover:text-smsg-900"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="2,4 6,8 10,4" />
          </svg>
        </button>
      )}
      {number && (
        <span className="mr-2 font-mono text-sm text-smsg-500">{number}</span>
      )}
      <span>{title}</span>
      {collapsed && directBlockCount > 0 && (
        <span className="ml-2 text-xs font-normal text-gray-500">
          ({directBlockCount}개 항목 접힘)
        </span>
      )}
      <a
        href={`#${id}`}
        className="ml-2 text-smsg-500 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="섹션 링크 복사"
      >
        #
      </a>
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onEdit()
          }}
          aria-label="섹션 빠른 편집"
          className="ml-1 text-smsg-500 opacity-0 transition-opacity hover:text-smsg-700 group-hover:opacity-100"
        >
          ✏︎
        </button>
      )}
    </>
  )
  const sharedCls = `group flex items-baseline scroll-mt-20 text-smsg-900 ${className}`
  if (level === 1) {
    return (
      <h2 id={id} className={sharedCls}>
        {inner}
      </h2>
    )
  }
  if (level === 2) {
    return (
      <h3 id={id} className={sharedCls}>
        {inner}
      </h3>
    )
  }
  return (
    <h4 id={id} className={sharedCls}>
      {inner}
    </h4>
  )
}

/**
 * CollapsiblePanel — animates `max-height` between 0 and the panel's measured
 * natural height so collapse/expand glide instead of snapping.
 *
 * Implementation:
 *   - On mount + on every children change, `useLayoutEffect` reads the
 *     panel's `scrollHeight` synchronously (still "measured" — `useEffect`
 *     would race with paint).
 *   - When `collapsed` toggles, we set `max-height` to either 0 or the
 *     measured height, transitioning over `var(--duration-base)` (=200ms).
 *   - After expand, `transitionend` clears `max-height` to `none` so future
 *     content additions aren't clipped.
 *   - `prefers-reduced-motion: reduce` skips the transition entirely.
 *
 * SSR / no-DOM fallback: when the panel hasn't measured yet (`measured=0`),
 * the expanded state simply has no max-height (children flow naturally) and
 * the collapsed state hides via `display:none`. This keeps
 * `renderToStaticMarkup` snapshots stable and avoids 0-height flashes.
 *
 * Note: we keep children mounted both ways. Hiding via `max-height: 0` +
 * `overflow: hidden` is intentional — popping children out of the tree
 * would lose IntersectionObserver state on charts/images and re-trigger
 * lazy-load each time.
 */
function CollapsiblePanel({
  id,
  collapsed,
  children,
}: {
  id: string
  collapsed: boolean
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Initialise max-height to 0 if the section starts collapsed so the first
  // post-mount paint doesn't flash the body at full height. Subsequent
  // toggles flow through the useEffect transition pipeline.
  const [maxHeight, setMaxHeight] = useState<string | undefined>(
    collapsed ? '0px' : undefined,
  )
  const animatingRef = useRef<boolean>(false)
  const prevCollapsedRef = useRef<boolean>(collapsed)
  // Cached natural height measured by the layout effect below. Used as a
  // fallback when the toggle effect runs before the panel has had a chance
  // to lay out (e.g. when content is still mounting).
  const measuredRef = useRef<number>(0)
  // Track whether we've ever mounted on a real DOM. Until then we keep the
  // legacy "unmount children when collapsed" behaviour so:
  //   1) SSR / `renderToStaticMarkup` snapshots stay byte-identical to the
  //      pre-transition build (existing SectionRenderer.test.tsx asserts on
  //      collapsed-state body absence).
  //   2) Initial paint after navigation doesn't briefly flash a 0-height
  //      panel for a freshly-collapsed section.
  // Once `mounted=true`, we keep children rendered and drive the open/close
  // via a `max-height` CSS transition.
  const [mounted, setMounted] = useState<boolean>(false)
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    (() => {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch {
        return false
      }
    })()

  // Flip `mounted` once after first paint so subsequent toggles animate.
  useEffect(() => {
    setMounted(true)
  }, [])

  // Measure the panel's natural height after every layout. We cache it on a
  // ref (no re-render) so the toggle effect below can pick up the freshest
  // value even when content has been added since the last open/close.
  useLayoutEffect(() => {
    if (!mounted) return
    const el = panelRef.current
    if (!el) return
    if (animatingRef.current) return
    if (collapsed) return
    measuredRef.current = el.scrollHeight
  })

  // React to collapse/expand transitions.
  useEffect(() => {
    if (!mounted) return
    // Skip the very first effect call when the state didn't actually change
    // (initial paint after hydration with the same collapsed value as SSR).
    if (prevCollapsedRef.current === collapsed) return
    prevCollapsedRef.current = collapsed
    const el = panelRef.current
    if (!el) return
    if (reduceMotion) {
      // Skip the animation: snap directly to final state.
      setMaxHeight(collapsed ? '0px' : undefined)
      return
    }
    if (collapsed) {
      // Two-phase: 1st set to current measured height (so `none` baseline
      // transitions), then on next frame collapse to 0.
      const current = el.scrollHeight || measuredRef.current
      animatingRef.current = true
      setMaxHeight(`${current}px`)
      requestAnimationFrame(() => {
        setMaxHeight('0px')
      })
    } else {
      // Expand: from 0 (current draft) to measured natural height. The
      // `transitionend` handler below clears max-height when we land.
      animatingRef.current = true
      const target = el.scrollHeight || measuredRef.current
      setMaxHeight(`${target}px`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, reduceMotion, mounted])

  const onTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.propertyName !== 'max-height') return
    animatingRef.current = false
    if (!collapsed) {
      // Once expanded, drop the cap so future child additions aren't clipped.
      setMaxHeight(undefined)
    }
  }

  // Pre-mount path — preserve the legacy unmount behaviour so SSR and the
  // first reader paint match prior snapshots.
  if (!mounted) {
    if (collapsed) {
      return <div id={id} hidden aria-hidden="true" />
    }
    return (
      <div id={id} ref={panelRef} data-collapsible-panel>
        {children}
      </div>
    )
  }

  const style: React.CSSProperties = {
    overflow: 'hidden',
    transition: reduceMotion
      ? 'none'
      : 'max-height var(--duration-base, 200ms) ease',
    ...(maxHeight !== undefined ? { maxHeight } : null),
  }

  return (
    <div
      id={id}
      ref={panelRef}
      data-collapsible-panel
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-hidden={collapsed ? 'true' : undefined}
      style={style}
      onTransitionEnd={onTransitionEnd}
    >
      {children}
    </div>
  )
}
