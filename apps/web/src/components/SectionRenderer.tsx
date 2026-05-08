import type { Slug, SectionLevel1, SectionLevel2, SectionLevel3 } from '@/types/document'
import { BlockRenderer } from './blocks/BlockRenderer'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { SectionQuickEdit } from '@/features/editor/components/SectionQuickEdit'
import { SectionInlineEdit } from '@/features/editor/components/SectionInlineEdit'

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
}: SectionRendererProps) {
  const headingId = section.number ? `section-${section.number}` : section.id
  const subsections = ('subsections' in section && section.subsections
    ? section.subsections
    : []) as Section[]

  const isQuickEditing = useEditorStore(editorSelectors.isQuickEditing(section.id))
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  const enterQuickEdit = useEditorStore((s) => s.enterQuickEdit)
  const exitToReader = useEditorStore((s) => s.exitToReader)

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

  // In fullEdit mode the level-1 section becomes a live BlockNote editor with
  // an inline-renamable title. Sub-sections stay rendered (we keep them as
  // BlockRenderers so the user sees structure even while editing top-level).
  if (isFullEditing && editableSlug && section.level === 1) {
    return (
      <div data-section-level={section.level}>
        <SectionInlineEdit
          slug={editableSlug}
          section={section}
          autoFocus={autoFocusInline}
        />
        {subsections.length > 0 && (
          <div className="mt-4 space-y-6">
            {subsections.map((sub) => (
              <SectionRenderer
                key={sub.id}
                section={sub}
                editableSlug={editableSlug}
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

  return (
    <section data-section-level={section.level}>
      <SectionHeading
        level={section.level}
        id={headingId}
        number={section.number}
        title={section.title}
        className={levelTextCls}
        onEdit={showPencil ? () => enterQuickEdit(section.id) : undefined}
      />

      <div className="mt-3 space-y-4">
        {section.blocks.map((block) => (
          <BlockRenderer key={block.id} block={block} />
        ))}
      </div>

      {subsections.length > 0 && (
        <div className="mt-4 space-y-6">
          {subsections.map((sub) => (
            <SectionRenderer key={sub.id} section={sub} editableSlug={editableSlug} />
          ))}
        </div>
      )}
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
}

function SectionHeading({
  level,
  id,
  number,
  title,
  className,
  onEdit,
}: SectionHeadingProps) {
  const inner = (
    <>
      {number && (
        <span className="mr-2 font-mono text-sm text-smsg-500">{number}</span>
      )}
      <span>{title}</span>
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
