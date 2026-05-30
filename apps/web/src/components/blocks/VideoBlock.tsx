import type { VideoBlock } from '@/types/document'

/**
 * Video block.
 *  - `provider === 'youtube'` → `<iframe>` to youtube embed URL.
 *  - default ('intra' or undefined) → native `<video>`.
 *  - `provider === 'vimeo'` → `<iframe>` to vimeo embed URL.
 *
 * `autoplay` / `controls` / `loop` (widget-integrity-pass-2 M4 옵션) 은
 * native video 에는 그대로 attr 로, YouTube/Vimeo 는 embed URL query 로
 * 반영. 브라우저 정책상 `autoplay` 가 적용되려면 muted 가 함께 필요해서
 * autoplay=true 인 경우 YouTube/Vimeo embed URL 에 mute=1 도 동반.
 */
export function VideoBlockView({ block }: { block: VideoBlock }) {
  const provider = block.provider ?? 'intra'
  const autoplay = block.autoplay ?? false
  const controls = block.controls ?? true
  const loop = block.loop ?? false

  if (provider === 'youtube') {
    const embed = toYouTubeEmbed(block.url, { autoplay, controls, loop })
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
    const embed = toVimeoEmbed(block.url, { autoplay, loop })
    return (
      <figure className="my-4">
        <div className="aspect-video w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700">
          <iframe
            src={embed}
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
        controls={controls}
        autoPlay={autoplay}
        loop={loop}
        muted={autoplay}
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

function toYouTubeEmbed(
  url: string,
  opts: { autoplay: boolean; controls: boolean; loop: boolean },
): string {
  // Best-effort URL → embed conversion. Accepts both watch URLs and bare IDs.
  try {
    const u = new URL(url)
    const id = u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).pop() ?? ''
    if (!id) return url
    const params = new URLSearchParams()
    if (opts.autoplay) {
      params.set('autoplay', '1')
      // YouTube blocks autoplay unless muted.
      params.set('mute', '1')
    }
    if (!opts.controls) params.set('controls', '0')
    if (opts.loop) {
      params.set('loop', '1')
      // YouTube loop only honors `loop=1` when `playlist=<id>` is also set.
      params.set('playlist', id)
    }
    const qs = params.toString()
    return `https://www.youtube.com/embed/${id}${qs ? `?${qs}` : ''}`
  } catch {
    return url
  }
}

function toVimeoEmbed(
  url: string,
  opts: { autoplay: boolean; loop: boolean },
): string {
  try {
    const u = new URL(url)
    const params = new URLSearchParams(u.search)
    if (opts.autoplay) {
      params.set('autoplay', '1')
      // Vimeo also requires muted for autoplay.
      params.set('muted', '1')
    }
    if (opts.loop) params.set('loop', '1')
    u.search = params.toString()
    return u.toString()
  } catch {
    return url
  }
}
