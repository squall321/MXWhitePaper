import { useEffect, useMemo, useRef, useState } from 'react'
import type { GalleryBlock } from '@/types/document'
import { useImage } from '@/features/upload/hooks/useImage'
import { Lightbox, type LightboxItem } from '@/components/Lightbox'
import { useT } from '@/lib/i18n'
import { withBase } from '@/lib/basePath'

/**
 * Read-mode gallery — grid (or horizontal carousel) of thumbnails. Each cell
 * uses the `thumb` URL from the resolved image record and falls back to a
 * dominant_color background while loading.
 *
 * Clicking a tile opens the shared `<Lightbox>` with prev/next + keyboard
 * navigation across all gallery items. Each `<GalleryItem>` owns one
 * `useImage` query and reports its resolved URLs upward via `onResolved` so
 * we don't violate the rules of hooks by calling them in a loop here.
 */
export function GalleryBlockView({ block }: { block: GalleryBlock }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [resolved, setResolved] = useState<Record<number, { src: string }>>({})

  const onResolved = (i: number, src: string) => {
    setResolved((r) => (r[i]?.src === src ? r : { ...r, [i]: { src } }))
  }

  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      block.items.map((it, i) => ({
        src:
          resolved[i]?.src ??
          (it.imageId ? withBase(`/api/v1/images/${encodeURIComponent(it.imageId)}`) : ''),
        alt: it.alt,
        caption: it.caption,
      })),
    [block.items, resolved],
  )

  const onTileClick = (i: number) => setOpenIdx(i)

  const tiles = block.items.map((it, i) => (
    <GalleryItem
      key={i}
      item={it}
      index={i}
      onOpen={onTileClick}
      onResolved={onResolved}
    />
  ))

  return (
    <>
      {block.layout === 'carousel' ? (
        // `scroll-fade-x` paints a soft edge gradient that shrinks as the
        // user scrolls — gives mobile users a visible cue that more tiles
        // exist off-screen (otherwise the snap-x scrollbar stays invisible
        // until they drag). Same utility used by TableBlock / SpreadsheetBlock.
        <div className="scroll-fade-x my-4 flex snap-x gap-3 overflow-x-auto">{tiles}</div>
      ) : (
        <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{tiles}</div>
      )}
      <Lightbox
        open={openIdx !== null}
        items={lightboxItems}
        startIndex={openIdx ?? 0}
        onClose={() => setOpenIdx(null)}
      />
    </>
  )
}

function GalleryItem({
  item,
  index,
  onOpen,
  onResolved,
}: {
  item: { imageId: string; caption?: string; alt?: string }
  index: number
  onOpen: (i: number) => void
  onResolved: (i: number, src: string) => void
}) {
  const t = useT()
  const { data: image } = useImage(item.imageId || undefined)
  const thumb = image?.urls.thumb ?? withBase(`/api/v1/images/${encodeURIComponent(item.imageId)}`)
  const bg = image?.dominant_color ?? '#f3f4f6'

  // Report the highest-quality URL we know up to the parent (for the
  // lightbox). Effect, not event handler — the URL changes asynchronously.
  const lastReported = useRef<string>('')
  useEffect(() => {
    const orig = image?.urls.orig ?? image?.urls.view
    if (orig && orig !== lastReported.current) {
      lastReported.current = orig
      onResolved(index, orig)
    }
  }, [image, index, onResolved])

  return (
    <figure
      className="overflow-hidden rounded border border-gray-200 dark:border-gray-700"
      style={{ backgroundColor: bg }}
    >
      <button
        type="button"
        onClick={() => onOpen(index)}
        aria-label={t('block.gallery.zoomItemAria', { index: index + 1 })}
        className="block w-full"
      >
        <img
          src={thumb}
          alt={item.alt ?? item.caption ?? ''}
          loading="lazy"
          className="aspect-square w-full object-cover"
        />
      </button>
      {item.caption && (
        <figcaption className="bg-white px-2 py-1 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400">
          {item.caption}
        </figcaption>
      )}
    </figure>
  )
}
