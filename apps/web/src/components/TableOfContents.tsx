import { useEffect, useMemo, useState } from 'react'
import type { DocumentJSONV10, SectionLevel1, SectionLevel2, SectionLevel3 } from '@/types/document'
import { useSectionCollapseStore } from '@/features/editor/sectionCollapseStore'

type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3

interface TocItem {
  id: string
  /** Section ULID — distinct from `id` (which is the heading anchor). */
  sectionId: string
  number?: string
  title: string
  level: 1 | 2 | 3
}

interface TableOfContentsProps {
  document: DocumentJSONV10
}

/**
 * Sticky right-rail Table of Contents. Walks the Section tree (heading-4
 * Blocks are intentionally excluded) and tracks the active anchor via
 * IntersectionObserver. Click → smooth-scroll to the section.
 */
export function TableOfContents({ document }: TableOfContentsProps) {
  const items = useMemo<TocItem[]>(() => {
    const out: TocItem[] = []
    const walk = (s: AnySection) => {
      out.push({
        id: s.number ? `section-${s.number}` : s.id,
        sectionId: s.id,
        number: s.number,
        title: s.title,
        level: s.level,
      })
      if ('subsections' in s && s.subsections) {
        for (const sub of s.subsections) walk(sub as AnySection)
      }
    }
    for (const s of document.sections) walk(s)
    return out
  }, [document])

  // Subscribe to the per-slug collapse map so the rail re-renders when a
  // section folds. We deliberately read the inner sub-object rather than
  // calling `isCollapsed` per item so the equality stays referential.
  const slug = document.slug
  const collapsedMap = useSectionCollapseStore((s) => s.map[slug])
  const setCollapsed = useSectionCollapseStore((s) => s.setCollapsed)

  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null)

  useEffect(() => {
    if (items.length === 0) return
    const elements = items
      .map((it) => globalThis.document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the first entry that is intersecting and closest to the top.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0 && visible[0]?.target.id) {
          setActiveId(visible[0].target.id)
        }
      },
      {
        // Trigger when the heading enters the top quarter of the viewport.
        rootMargin: '0px 0px -70% 0px',
        threshold: [0, 1.0],
      },
    )
    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [items])

  if (items.length === 0) return null

  return (
    <nav aria-label="목차" className="px-3">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        목차
      </h3>
      <ul className="space-y-1 text-sm">
        {items.map((it) => {
          const indent =
            it.level === 1 ? 'pl-0' : it.level === 2 ? 'pl-3' : 'pl-6'
          const active = it.id === activeId
          const isCollapsed = collapsedMap?.[it.sectionId] === true
          // Faded style for collapsed sections — clickable so users can jump
          // to (and auto-expand) a folded section from the rail.
          const collapsedCls = isCollapsed ? 'opacity-50' : ''
          return (
            <li key={it.id} className={indent}>
              <a
                href={`#${it.id}`}
                data-toc-collapsed={isCollapsed ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  // Auto-expand the target section before scrolling so the
                  // anchor lands on visible content.
                  if (isCollapsed) setCollapsed(slug, it.sectionId, false)
                  const scroll = () => {
                    const el = globalThis.document.getElementById(it.id)
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      history.replaceState(null, '', `#${it.id}`)
                    }
                  }
                  // The expand re-renders the panel children — rAF lets the
                  // anchor target settle into the layout before we scroll.
                  if (isCollapsed) requestAnimationFrame(scroll)
                  else scroll()
                }}
                className={
                  (active
                    ? 'block border-l-2 border-smsg-500 pl-2 font-medium text-smsg-700'
                    : 'block border-l-2 border-transparent pl-2 text-gray-600 hover:border-gray-300 hover:text-smsg-900') +
                  ' ' +
                  collapsedCls
                }
              >
                {it.number && (
                  <span className="mr-1 font-mono text-xs text-gray-400">
                    {it.number}
                  </span>
                )}
                {it.title}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
