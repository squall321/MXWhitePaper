import { useCallback, useState } from 'react'
import type { Block, Slug } from '@/types/document'
import type { AnySection } from '../api'
import { patchSection, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'
import { SectionEditor } from './SectionEditorLazy'
import { EmptyArticleCTA } from './EmptyArticleCTA'

interface SectionInlineEditProps {
  slug: Slug
  section: AnySection
  /** When true the SectionEditor auto-focuses on mount. */
  autoFocus?: boolean
}

/**
 * Always-on inline editor for full-edit mode. Renders an editable section
 * title and a BlockNote SectionEditor that streams changes back to the BE
 * via debounced PATCH (the auto-save hook owns the flush). No save/cancel
 * buttons — every keystroke flows through the editor store and the doc-level
 * auto-save covers persistence.
 */
export function SectionInlineEdit({
  slug,
  section,
  autoFocus,
}: SectionInlineEditProps) {
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [title, setTitle] = useState(section.title)
  const [titleDirty, setTitleDirty] = useState(false)

  const persistTitle = useCallback(async () => {
    if (!etag || !titleDirty) return
    try {
      const result = await patchSection(
        slug,
        section.id,
        { title },
        etag,
        '섹션 제목 수정',
      )
      applySnapshot(result.document, result.etag)
      setTitleDirty(false)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }, [etag, slug, section.id, title, titleDirty, applySnapshot, setConflict])

  const persistBlocks = useCallback(
    async (blocks: Block[]) => {
      if (!etag) return
      try {
        const result = await patchSection(
          slug,
          section.id,
          { blocks },
          etag,
          '섹션 본문 수정',
        )
        applySnapshot(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      }
    },
    [etag, slug, section.id, applySnapshot, setConflict],
  )

  return (
    <section
      data-section-inline-edit
      data-section-level={section.level}
      className="space-y-2"
    >
      <div className="group flex items-baseline gap-2">
        {section.number && (
          <span className="font-mono text-sm text-smsg-500">{section.number}</span>
        )}
        <input
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-2xl font-semibold text-smsg-900 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setTitleDirty(true)
          }}
          onBlur={() => void persistTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              void persistTitle()
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
          aria-label="섹션 제목"
        />
      </div>

      {section.blocks.length === 0 && (
        <EmptyArticleCTA
          onSelect={() => {
            /* The `/` slash menu is the canonical entry point — focusing the
               editor is enough. */
            const el = document.querySelector(
              '[data-blocknote-surface] [contenteditable="true"]',
            ) as HTMLElement | null
            el?.focus()
          }}
        />
      )}

      <SectionEditor
        initialBlocks={section.blocks}
        autoFocus={autoFocus}
        onChange={(blocks) => {
          // Fire-and-forget; the auto-save hook also debounces full-doc PUTs
          // so a quick PATCH here keeps things fresh per section.
          void persistBlocks(blocks)
        }}
      />
    </section>
  )
}
