import type {
  DocumentJSONV10,
  SectionLevel1,
  SectionLevel2,
} from '@/types/document'

/**
 * Slide is one screen in presentation mode.
 *
 *  - kind="title"    → cover slide (doc title + summary + meta strip)
 *  - kind="section"  → a Section becomes a slide; renders heading + blocks
 */
export interface TitleSlide {
  kind: 'title'
  key: string
  title: string
  summary?: string
  meta: { path: string; tags: readonly string[]; confidentiality?: string }
}
export interface SectionSlide {
  kind: 'section'
  key: string
  number: string
  title: string
  level: 1 | 2
  section: SectionLevel1 | SectionLevel2
}
export type Slide = TitleSlide | SectionSlide

export interface BuildSlidesOptions {
  /**
   * When true, expose level-2 subsections as their own slides immediately
   * after their parent (Reveal.js "vertical" feel). Default false.
   */
  nested?: boolean
}

/**
 * Pure: derive a flat slide list from a DocumentJSON. Always produces at
 * least the title slide.
 */
export function buildSlides(
  doc: DocumentJSONV10,
  opts: BuildSlidesOptions = {},
): Slide[] {
  const md = doc.metadata
  const path = [md.division, md.team, md.group, md.part]
    .filter((x): x is string => Boolean(x))
    .join(' / ')
  const slides: Slide[] = [
    {
      kind: 'title',
      key: `title:${doc.slug}`,
      title: doc.title,
      summary: doc.summary,
      meta: {
        path,
        tags: md.tags ?? [],
        confidentiality: md.confidentiality,
      },
    },
  ]
  for (const section of doc.sections) {
    slides.push({
      kind: 'section',
      key: `sec:${section.id}`,
      number: section.number ?? '',
      title: section.title,
      level: 1,
      section,
    })
    if (opts.nested) {
      for (const sub of section.subsections ?? []) {
        slides.push({
          kind: 'section',
          key: `sec:${sub.id}`,
          number: sub.number ?? '',
          title: sub.title,
          level: 2,
          section: sub,
        })
      }
    }
  }
  return slides
}

/**
 * Pure navigation reducer. Index always clamped to [0, total - 1].
 *
 * "next"/"prev" do nothing at the boundaries instead of wrapping — wrapping
 * surprises presenters mid-talk.
 */
export type NavCommand =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'goto'; index: number }

export function navigate(current: number, total: number, cmd: NavCommand): number {
  const last = Math.max(0, total - 1)
  switch (cmd.type) {
    case 'next':
      return Math.min(current + 1, last)
    case 'prev':
      return Math.max(current - 1, 0)
    case 'first':
      return 0
    case 'last':
      return last
    case 'goto':
      return Math.min(Math.max(cmd.index, 0), last)
  }
}

/**
 * Map a keyboard event to a NavCommand (or null if it shouldn't navigate).
 * Pure — no DOM access; tests pass plain objects.
 */
export interface KeyEventLike {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

export function keyToNav(ev: KeyEventLike): NavCommand | null {
  // Ignore modified shortcuts so Cmd-R / Ctrl-K still work.
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return null
  switch (ev.key) {
    case 'ArrowRight':
    case ' ':
    case 'PageDown':
    case 'n':
    case 'N':
      return { type: 'next' }
    case 'ArrowLeft':
    case 'PageUp':
    case 'p':
    case 'P':
      return { type: 'prev' }
    case 'Home':
      return { type: 'first' }
    case 'End':
      return { type: 'last' }
    default:
      return null
  }
}
