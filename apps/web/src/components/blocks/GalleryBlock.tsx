import type { GalleryBlock } from '@/types/document'
import { useImage } from '@/features/upload/hooks/useImage'

/**
 * Read-mode gallery — grid (or horizontal carousel) of thumbnails. Each cell
 * uses the `thumb` URL from the resolved image record and falls back to a
 * dominant_color background while loading.
 */
export function GalleryBlockView({ block }: { block: GalleryBlock }) {
  if (block.layout === 'carousel') {
    return (
      <div className="my-4 flex snap-x gap-3 overflow-x-auto">
        {block.items.map((it, i) => (
          <GalleryItem key={i} item={it} />
        ))}
      </div>
    )
  }
  return (
    <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {block.items.map((it, i) => (
        <GalleryItem key={i} item={it} />
      ))}
    </div>
  )
}

function GalleryItem({
  item,
}: {
  item: { imageId: string; caption?: string; alt?: string }
}) {
  const { data: image } = useImage(item.imageId || undefined)
  const src = image?.urls.thumb ?? `/api/v1/images/${encodeURIComponent(item.imageId)}`
  const bg = image?.dominant_color ?? '#f3f4f6'
  return (
    <figure
      className="overflow-hidden rounded border border-gray-200"
      style={{ backgroundColor: bg }}
    >
      <img
        src={src}
        alt={item.alt ?? item.caption ?? ''}
        loading="lazy"
        className="aspect-square w-full object-cover"
      />
      {item.caption && (
        <figcaption className="bg-white px-2 py-1 text-xs text-gray-600">
          {item.caption}
        </figcaption>
      )}
    </figure>
  )
}
