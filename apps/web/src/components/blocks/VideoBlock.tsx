import type { VideoBlock } from '@/types/document'

/**
 * Video block.
 *  - `provider === 'youtube'` → `<iframe>` to youtube embed URL.
 *  - default ('intra' or undefined) → native `<video>`.
 *  - `provider === 'vimeo'` → `<iframe>` to vimeo embed URL.
 */
export function VideoBlockView({ block }: { block: VideoBlock }) {
  const provider = block.provider ?? 'intra'

  if (provider === 'youtube') {
    const embed = toYouTubeEmbed(block.url)
    return (
      <figure className="my-4">
        <div className="aspect-video w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700">
          <iframe
            src={embed}
            title={block.title ?? 'YouTube video'}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
        {block.title && (
          <figcaption className="mt-1 text-center text-xs text-gray-500">
            {block.title}
          </figcaption>
        )}
      </figure>
    )
  }

  if (provider === 'vimeo') {
    return (
      <figure className="my-4">
        <div className="aspect-video w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700">
          <iframe
            src={block.url}
            title={block.title ?? 'Vimeo video'}
            loading="lazy"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
        {block.title && (
          <figcaption className="mt-1 text-center text-xs text-gray-500">
            {block.title}
          </figcaption>
        )}
      </figure>
    )
  }

  // intra → native video element. Lazy-loaded via `preload="none"`.
  return (
    <figure className="my-4">
      <video
        src={block.url}
        controls
        preload="none"
        className="w-full rounded border border-gray-200 bg-black dark:border-gray-700"
      />
      {block.title && (
        <figcaption className="mt-1 text-center text-xs text-gray-500">
          {block.title}
        </figcaption>
      )}
    </figure>
  )
}

function toYouTubeEmbed(url: string): string {
  // Best-effort URL → embed conversion. Accepts both watch URLs and bare IDs.
  try {
    const u = new URL(url)
    const id = u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).pop() ?? ''
    return id ? `https://www.youtube.com/embed/${id}` : url
  } catch {
    return url
  }
}
