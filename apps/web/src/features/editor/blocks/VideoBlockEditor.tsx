import { useEffect, useRef, useState } from 'react'
import type { VideoBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  block: VideoBlock
}

/**
 * Detect video provider from a URL. Returns one of `youtube` / `vimeo` /
 * `intra`. Used to default the picker after a paste.
 */
export function detectProvider(url: string): VideoBlock['provider'] {
  const u = url.trim()
  if (!u) return 'intra'
  if (/youtu\.be|youtube\.com/.test(u)) return 'youtube'
  if (/vimeo\.com/.test(u)) return 'vimeo'
  return 'intra'
}

/** Convert a YouTube watch URL or bare ID into the embed form. */
export function toYouTubeEmbed(url: string): string {
  try {
    const u = new URL(url)
    const id =
      u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).pop() ?? ''
    return id ? `https://www.youtube.com/embed/${id}` : url
  } catch {
    return url
  }
}

/**
 * VideoBlockEditor — paste a URL, the provider is auto-detected, the title
 * is editable. Saves debounced 800 ms after the last keystroke.
 */
export function VideoBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<VideoBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLocal(block)
  }, [block])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const schedule = (next: VideoBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: VideoBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          url: next.url,
          title: next.title,
          provider: next.provider,
          autoplay: next.autoplay,
          controls: next.controls,
          loop: next.loop,
        },
        etag,
        t('editor.video.changeLog'),
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError(t('editor.common.conflict'))
      } else {
        setError((err as Error).message)
      }
    }
  }

  const onUrlChange = (url: string) => {
    schedule({ ...local, url, provider: detectProvider(url) })
  }

  const provider = local.provider ?? 'intra'
  const previewSrc =
    provider === 'youtube' ? toYouTubeEmbed(local.url) : local.url

  return (
    <div
      data-video-block-editor
      data-block-id={block.id}
      className="my-3 space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <input
          type="url"
          value={local.url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder={t('editor.video.urlPlaceholder')}
          aria-label={t('editor.video.urlLabel')}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        />
        <select
          aria-label={t('editor.video.providerLabel')}
          value={provider}
          onChange={(e) =>
            schedule({ ...local, provider: e.target.value as VideoBlock['provider'] })
          }
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
        >
          <option value="intra">{t('editor.video.providerIntra')}</option>
          <option value="youtube">YouTube</option>
          <option value="vimeo">Vimeo</option>
        </select>
      </div>
      <input
        type="text"
        value={local.title ?? ''}
        onChange={(e) => schedule({ ...local, title: e.target.value || undefined })}
        placeholder={t('editor.video.titlePlaceholder')}
        aria-label={t('editor.video.titleLabel')}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
      />

      <fieldset className="flex flex-wrap gap-3 text-xs text-gray-700">
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            data-video-autoplay
            checked={local.autoplay ?? false}
            onChange={(e) => schedule({ ...local, autoplay: e.target.checked })}
            className="h-3.5 w-3.5"
          />
          <span>{t('editor.video.autoplay')}</span>
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            data-video-controls
            checked={local.controls ?? true}
            onChange={(e) => schedule({ ...local, controls: e.target.checked })}
            className="h-3.5 w-3.5"
          />
          <span>{t('editor.video.controls')}</span>
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            data-video-loop
            checked={local.loop ?? false}
            onChange={(e) => schedule({ ...local, loop: e.target.checked })}
            className="h-3.5 w-3.5"
          />
          <span>{t('editor.video.loop')}</span>
        </label>
      </fieldset>

      {local.url ? (
        <div className="aspect-video w-full overflow-hidden rounded border border-gray-200 bg-black">
          {provider === 'youtube' || provider === 'vimeo' ? (
            <iframe
              src={previewSrc}
              title={local.title ?? t('editor.video.previewTitle')}
              loading="lazy"
              allowFullScreen
              className="h-full w-full"
            />
          ) : (
            <video src={local.url} controls preload="none" className="h-full w-full" />
          )}
        </div>
      ) : (
        <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-center text-xs text-gray-500">
          {t('editor.video.urlHint')}
        </div>
      )}

      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
