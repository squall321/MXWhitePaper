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
 * The dominant_color is painted as the loading placeholder so there is no
 * flash of empty white while the bytes stream in.
 */
export function ImageBlockView({ block }: { block: ImageBlock }) {
  const widthCls = WIDTH_CLASS[block.width ?? 'md']
  const { data: image } = useImage(block.imageId || undefined)
  const [open, setOpen] = useState(false)

  const viewSrc = image?.urls.view ?? `/api/v1/images/${encodeURIComponent(block.imageId)}`
  const origSrc = image?.urls.orig ?? viewSrc
  const bg = image?.dominant_color ?? '#f3f4f6'

  return (
    <figure className={`my-4 ${widthCls} mx-auto`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="이미지 확대"
        className="block w-full overflow-hidden rounded border border-gray-200"
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
      {block.caption && (
        <figcaption className="mt-1 text-center text-xs text-gray-500">
          {block.caption}
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
