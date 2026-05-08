import type { ReactNode } from 'react'
import type { Slug, SectionLevel1, SectionLevel2, SectionLevel3 } from '@/types/document'
import { BlockRenderer } from './blocks/BlockRenderer'
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
 * CollapsiblePanel — wraps section body with a max-height transition. We use
 * `display: none` (via `hidden`) when fully collapsed so subtree DOM does
 * not affect anchor scroll / IO listeners. The animation is best-effort —
 * with content of unknown height we'd need a measure pass; the simpler
 * "fade + collapse" feels fine for section-level content.
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
  if (collapsed) {
    // SSR-safe: just don't render children. The hidden attr keeps the panel
    // discoverable via aria-controls without leaking to assistive tech.
    return <div id={id} hidden aria-hidden="true" />
  }
  return (
    <div id={id} data-collapsible-panel>
      {children}
    </div>
  )
}
