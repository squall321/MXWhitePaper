import { useState } from 'react'
import type { ImageBlock } from '@/types/document'
import { useImage } from '@/features/upload/hooks/useImage'
import { Lightbox } from '@/components/Lightbox'

const WIDTH_CLASS: Record<NonNullable<ImageBlock['width']>, string> = {
  sm: 'w-full sm:w-1/3',
  md: 'w-full sm:w-2/3',
  lg: 'w-full sm:w-3/4',
  full: 'w-full',
}

/**
 * Read-mode image block. Resolves the image record via TanStack Query and
 * renders the `view` (≤1024px) URL. Click opens the original in a Lightbox.
 *
 * If `block.link` is set, a small "↗ 링크 열기" affordance appears under the
 * caption that navigates to the target (external URL or `/docs/{slug}`).
 * The image itself still opens the Lightbox so accidentally clicking the
 * picture never yanks the reader off-page.
 *
 * Figure auto-numbering: CSS counter `figure-num` defined in styles/print.css
 * on the article wrapper increments per <figure data-block-type="image">
 * and prepends "그림 N:" to the figcaption. No DOM coupling needed.
 */
export function ImageBlockView({ block }: { block: ImageBlock }) {
  const widthCls = WIDTH_CLASS[block.width ?? 'md']
  const { data: image } = useImage(block.imageId || undefined)
  const [open, setOpen] = useState(false)

  const viewSrc = image?.urls.view ?? `/api/v1/images/${encodeURIComponent(block.imageId)}`
  const origSrc = image?.urls.orig ?? viewSrc
  const bg = image?.dominant_color ?? '#f3f4f6'
  const link = (block as { link?: string }).link
  const linkHref = link
    ? (link.startsWith('http://') || link.startsWith('https://')
        ? link
        : `/docs/${encodeURIComponent(link.replace(/^\/+/, ''))}`)
    : undefined

  return (
    <figure
      className={`my-4 ${widthCls} mx-auto`}
      data-block-type="image"
      data-has-caption={block.caption ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="이미지 확대"
        className="block w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700"
        style={{ backgroundColor: bg }}
      >
        <img
          src={viewSrc}
          alt={block.alt ?? block.caption ?? ''}
          loading="lazy"
          decoding="async"
          className="block w-full"
        />
      </button>
      {(block.caption || linkHref) && (
        <figcaption className="mt-1 text-center text-xs text-gray-500">
          {block.caption && <span className="figure-caption-text">{block.caption}</span>}
          {linkHref && (
            <a
              href={linkHref}
              target={link?.startsWith('http') ? '_blank' : undefined}
              rel={link?.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="ml-2 text-blue-600 underline hover:text-blue-700"
            >
              ↗ 링크 열기
            </a>
          )}
        </figcaption>
      )}
      <Lightbox
        open={open}
        src={origSrc}
        alt={block.alt}
        caption={block.caption}
        onClose={() => setOpen(false)}
      />
    </figure>
  )
}
