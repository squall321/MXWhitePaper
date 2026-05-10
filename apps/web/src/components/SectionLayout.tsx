import type { ReactNode } from 'react'
import type { Block, Section } from '@/types/document'

export type SectionLayoutKind = NonNullable<Section['layout']> | 'stack'

/**
 * Renders a section's `blocks` array according to the section's `layout`
 * choice. The renderer is purely presentational — it doesn't know about
 * editor state, lazy-loading, or footnotes. Callers wrap each block with
 * whatever they need (e.g. LazyBlockSlot) and pass the JSX nodes via the
 * `renderBlock` callback.
 *
 * The same layouts apply to both the wiki view (this file) and the slide
 * view (the SlideBlockRenderer reuses these same shapes), so a section's
 * visual structure stays identical whether it's read inline or projected.
 */
export function SectionLayout({
  blocks,
  layout,
  renderBlock,
  className,
}: {
  blocks: readonly Block[]
  layout: SectionLayoutKind | undefined
  /** Per-block React node — caller decides on lazy/eager wrapping. */
  renderBlock: (block: Block, index: number) => ReactNode
  /** Extra wrapper classes (e.g. `mt-3 space-y-4`). Applied to the outer div
   * regardless of layout so callers can keep their spacing rules consistent. */
  className?: string
}) {
  const kind = (layout ?? 'stack') as SectionLayoutKind
  if (blocks.length === 0) return null

  switch (kind) {
    case 'title-only':
      // Cover-slide layout — section heading carries the message; body
      // blocks are hidden in this layout. Useful for chapter dividers.
      return null

    case 'two-col': {
      // Split blocks alternately into 2 columns. First block → col 1,
      // second → col 2, third → col 1, … This keeps the mental model
      // simple ("write linearly, render side-by-side") and survives
      // adding/removing blocks gracefully.
      const left: { node: ReactNode; key: string }[] = []
      const right: { node: ReactNode; key: string }[] = []
      blocks.forEach((b, i) => {
        const node = renderBlock(b, i)
        ;(i % 2 === 0 ? left : right).push({ node, key: b.id })
      })
      return (
        <div
          data-section-layout="two-col"
          className={`${className ?? ''} grid gap-4 md:grid-cols-2`}
        >
          <div className="space-y-4">{left.map((x) => <div key={x.key}>{x.node}</div>)}</div>
          <div className="space-y-4">{right.map((x) => <div key={x.key}>{x.node}</div>)}</div>
        </div>
      )
    }

    case 'image-left':
    case 'image-right': {
      // Pull the first image block aside; everything else stacks in the
      // text column. If there's no image at all we degrade gracefully to
      // a regular stack so the user can switch the layout in advance of
      // adding the image.
      const imgIdx = blocks.findIndex((b) => b.type === 'image')
      if (imgIdx < 0) {
        return (
          <div
            data-section-layout={kind}
            data-fallback="no-image"
            className={`${className ?? ''} space-y-4`}
          >
            {blocks.map((b, i) => (
              <div key={b.id}>{renderBlock(b, i)}</div>
            ))}
          </div>
        )
      }
      const imageNode = renderBlock(blocks[imgIdx]!, imgIdx)
      const rest = blocks
        .filter((_, i) => i !== imgIdx)
        .map((b, i) => ({ node: renderBlock(b, i), key: b.id }))
      const imagePane = (
        <div className="space-y-4 [&_figure]:m-0">{imageNode}</div>
      )
      const textPane = (
        <div className="space-y-4">
          {rest.map((x) => <div key={x.key}>{x.node}</div>)}
        </div>
      )
      return (
        <div
          data-section-layout={kind}
          className={`${className ?? ''} grid gap-6 md:grid-cols-[2fr_3fr]`}
        >
          {kind === 'image-left' ? (
            <>{imagePane}{textPane}</>
          ) : (
            <>{textPane}{imagePane}</>
          )}
        </div>
      )
    }

    case 'full-bleed': {
      // First image renders as a background; remaining blocks overlay on
      // top with a subtle dark gradient for readability. Falls back to
      // stack when no image is present.
      const imgIdx = blocks.findIndex((b) => b.type === 'image')
      if (imgIdx < 0) {
        return (
          <div
            data-section-layout="full-bleed"
            data-fallback="no-image"
            className={`${className ?? ''} space-y-4`}
          >
            {blocks.map((b, i) => (
              <div key={b.id}>{renderBlock(b, i)}</div>
            ))}
          </div>
        )
      }
      const rest = blocks.filter((_, i) => i !== imgIdx)
      return (
        <div
          data-section-layout="full-bleed"
          className={`${className ?? ''} relative overflow-hidden rounded-lg`}
        >
          <div className="absolute inset-0 -z-10 [&_figure]:m-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover">
            {renderBlock(blocks[imgIdx]!, imgIdx)}
          </div>
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/0 via-black/30 to-black/60" />
          <div className="space-y-4 p-8 text-white [&_p]:text-white [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white">
            {rest.map((b, i) => (
              <div key={b.id}>{renderBlock(b, i)}</div>
            ))}
          </div>
        </div>
      )
    }

    case 'stack':
    default:
      return (
        <div
          data-section-layout="stack"
          className={`${className ?? ''} space-y-4`}
        >
          {blocks.map((b, i) => (
            <div key={b.id}>{renderBlock(b, i)}</div>
          ))}
        </div>
      )
  }
}

export const LAYOUT_OPTIONS: { value: SectionLayoutKind; label: string; emoji: string }[] = [
  { value: 'stack', label: '기본 (위→아래)', emoji: '☰' },
  { value: 'two-col', label: '2단', emoji: '⫴' },
  { value: 'image-left', label: '이미지 좌 / 글 우', emoji: '⬛︎▤' },
  { value: 'image-right', label: '글 좌 / 이미지 우', emoji: '▤⬛︎' },
  { value: 'title-only', label: '제목만 (표지)', emoji: '∅' },
  { value: 'full-bleed', label: '이미지 배경 + 위에 글', emoji: '◳' },
]
