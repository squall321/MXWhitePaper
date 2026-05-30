import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import type { ImageBlock, Slug } from '@/types/document'
import { useImage } from '@/features/upload/hooks/useImage'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from '@/features/upload/components/ImageDropzone'
import { CropOverlay } from '@/features/upload/CropOverlay'
import { uploadImage } from '@/features/upload/uploadImage'
import { loadImageElement, rotateImageToBlob } from '@/features/upload/canvasEncode'
import { rotate90 } from '@/features/upload/cropMath'
import { useT } from '@/lib/i18n'

/**
 * Pure keyboard policy for caption/alt inputs. Extracted so we can unit-test
 * the policy without a DOM (the project intentionally doesn't ship jsdom).
 *
 *   Enter   → commit
 *   Tab     → commit-and-tab (move focus to next field)
 *   Escape  → revert
 *   else    → noop
 *
 * The current and previous values are unused by the policy itself but kept
 * in the signature so callers don't have to compute the diff inline — the
 * "commit if changed" branch is the same shape for caption and alt.
 */
export type KeyAction = 'commit' | 'commit-and-tab' | 'revert' | 'noop'

export function decideKeyAction(
  key: string,
  _current: string,
  _previous: string,
): KeyAction {
  if (key === 'Enter') return 'commit'
  if (key === 'Tab') return 'commit-and-tab'
  if (key === 'Escape') return 'revert'
  return 'noop'
}

/**
 * The accessibility warning policy: alt is REQUIRED but only after the user
 * has saved at least once, so initial focus on a fresh image doesn't yell at
 * them before they had a chance to type.
 */
export function shouldShowAltWarning(alt: string, savedOnce: boolean): boolean {
  return savedOnce && alt.trim() === ''
}

/**
 * Five built-in placeholder images. Each entry references a local data-URI
 * SVG so we don't depend on a third-party CDN.
 */
export interface SampleImage {
  id: string
  label: string
  /** Inline SVG data-URI used as the dropzone fallback. */
  src: string
}

export const SAMPLE_IMAGES: ReadonlyArray<SampleImage> = [
  {
    id: 'mx-blue',
    label: '파랑 그라데이션',
    src:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1428A0"/><stop offset="1" stop-color="#4F8BFF"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><text x="160" y="100" font-size="22" fill="white" text-anchor="middle" font-family="Inter">MX 샘플</text></svg>',
      ),
  },
  {
    id: 'mx-grid',
    label: '회색 그리드',
    src:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#f5f5f5"/><g stroke="#ddd"><path d="M0 30h320M0 60h320M0 90h320M0 120h320M0 150h320"/></g></svg>',
      ),
  },
  {
    id: 'mx-warm',
    label: '따뜻한 조명',
    src:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><radialGradient id="g"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></radialGradient></defs><rect width="320" height="180" fill="url(#g)"/></svg>',
      ),
  },
  {
    id: 'mx-mono',
    label: '모노크롬',
    src:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#1f2937"/><circle cx="160" cy="90" r="50" fill="#9ca3af"/></svg>',
      ),
  },
  {
    id: 'mx-grid-dark',
    label: '다크 그리드',
    src:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#0f172a"/><g stroke="#1e293b"><path d="M0 30h320M0 60h320M0 90h320M0 120h320M0 150h320M40 0v180M80 0v180M120 0v180M160 0v180M200 0v180M240 0v180M280 0v180"/></g></svg>',
      ),
  },
]

interface ImageBlockEditorProps {
  slug: Slug
  block: ImageBlock
  /**
   * If true, autofocus the caption field on mount. Normally derived from the
   * editor store's `pendingCaptionFocusBlockId`, but components can force it
   * (e.g. unit tests).
   */
  autoFocusCaption?: boolean
}

const WIDTH_OPTIONS: { value: NonNullable<ImageBlock['width']>; label: string }[] = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
  { value: 'full', label: 'Full' },
]

const ALIGN_OPTIONS: { value: 'left' | 'center' | 'right' | 'full'; labelKey: 'editor.image.alignLeft' | 'editor.image.alignCenter' | 'editor.image.alignRight' | 'editor.image.alignFull' }[] = [
  { value: 'left', labelKey: 'editor.image.alignLeft' },
  { value: 'center', labelKey: 'editor.image.alignCenter' },
  { value: 'right', labelKey: 'editor.image.alignRight' },
  { value: 'full', labelKey: 'editor.image.alignFull' },
]

const WIDTH_CLASS: Record<NonNullable<ImageBlock['width']>, string> = {
  sm: 'w-full sm:w-1/3',
  md: 'w-full sm:w-2/3',
  lg: 'w-full sm:w-3/4',
  full: 'w-full',
}

/**
 * Editable image block. Renders the same image as `<ImageBlockView>` plus
 * inline caption / alt inputs and a hover toolbar.
 *
 * Caption / alt save policy:
 *   - Enter   : confirm (PATCH with the new value)
 *   - Tab     : confirm + move focus to the next field (caption → alt)
 *   - Escape  : revert local edit, do not save
 *   - Blur    : confirm if value changed
 *
 * The accessibility warning fires when alt is empty *after* the first save
 * attempt — typing pause / first commit, not on initial render.
 */
export function ImageBlockEditor({
  slug,
  block,
  autoFocusCaption,
}: ImageBlockEditorProps) {
  const t = useT()
  const { data: image } = useImage(block.imageId || undefined)
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const pendingFocusId = useEditorStore((s) => s.pendingCaptionFocusBlockId)
  const clearPendingFocus = useEditorStore((s) => s.setPendingCaptionFocus)
  const shouldAutoFocus = autoFocusCaption ?? pendingFocusId === block.id

  const [caption, setCaption] = useState(block.caption ?? '')
  const [alt, setAlt] = useState(block.alt ?? '')
  const [savedOnce, setSavedOnce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [altChipDismissed, setAltChipDismissed] = useState(false)
  const [captionPulsing, setCaptionPulsing] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const [rotateBusy, setRotateBusy] = useState(false)

  const captionRef = useRef<HTMLInputElement>(null)
  const altRef = useRef<HTMLInputElement>(null)
  const dropzoneRef = useRef<ImageDropzoneHandle>(null)

  // Auto-focus caption when the block was just inserted. Also pulses the
  // caption ring and scrolls it into view so the user knows where to type.
  useEffect(() => {
    if (shouldAutoFocus) {
      // requestAnimationFrame so the DOM has finished mounting the input.
      const r = requestAnimationFrame(() => {
        captionRef.current?.focus()
        captionRef.current?.select()
        captionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
        setCaptionPulsing(true)
        setTimeout(() => setCaptionPulsing(false), 900)
      })
      // Clear the store flag once we've consumed it so a re-render doesn't
      // steal focus from another field the user has tabbed into.
      if (pendingFocusId === block.id) clearPendingFocus(null)
      return () => cancelAnimationFrame(r)
    }
    return undefined
  }, [shouldAutoFocus, pendingFocusId, block.id, clearPendingFocus])

  const widthCls = WIDTH_CLASS[block.width ?? 'md']
  const usingSample = block.imageId.startsWith('sample:')
  const sampleSrc = usingSample
    ? SAMPLE_IMAGES.find((s) => `sample:${s.id}` === block.imageId)?.src
    : undefined
  const src =
    sampleSrc ?? image?.urls.view ?? `/api/v1/images/${encodeURIComponent(block.imageId)}`
  const placeholderBg = image?.dominant_color ?? '#f3f4f6'

  const persist = useCallback(
    async (patch: Partial<ImageBlock>) => {
      if (!etag) return
      setBusy(true)
      setError(null)
      try {
        const result = await patchBlock(slug, block.id, patch, etag, t('editor.image.changeLog'))
        applySnapshot(result.document, result.etag)
        setSavedOnce(true)
      } catch (err) {
        if (isPreconditionFailed(err)) {
          setConflict(null)
          setError(t('editor.common.conflict'))
        } else {
          setError((err as Error).message)
        }
      } finally {
        setBusy(false)
      }
    },
    [etag, slug, block.id, applySnapshot, setConflict, t],
  )

  const onCaptionKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const decision = decideKeyAction(e.key, caption, block.caption ?? '')
    if (decision === 'commit') {
      e.preventDefault()
      void persist({ caption })
    } else if (decision === 'commit-and-tab') {
      e.preventDefault()
      if (caption !== (block.caption ?? '')) void persist({ caption })
      altRef.current?.focus()
    } else if (decision === 'revert') {
      e.preventDefault()
      setCaption(block.caption ?? '')
      ;(e.currentTarget as HTMLInputElement).blur()
    }
  }

  const onAltKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const decision = decideKeyAction(e.key, alt, block.alt ?? '')
    if (decision === 'commit' || decision === 'commit-and-tab') {
      e.preventDefault()
      void persist({ alt })
    } else if (decision === 'revert') {
      e.preventDefault()
      setAlt(block.alt ?? '')
      ;(e.currentTarget as HTMLInputElement).blur()
    }
  }

  const onCaptionBlur = () => {
    if (caption !== (block.caption ?? '')) void persist({ caption })
  }
  const onAltBlur = () => {
    if (alt !== (block.alt ?? '')) void persist({ alt })
  }

  const onWidth = (e: ChangeEvent<HTMLSelectElement>) => {
    void persist({ width: e.target.value as ImageBlock['width'] })
  }

  const onAlign = (e: ChangeEvent<HTMLSelectElement>) => {
    const meta: ImageBlock['meta'] = {
      ...(block.meta ?? {}),
      align: e.target.value as NonNullable<ImageBlock['meta']>['align'],
    }
    void persist({ meta })
  }

  const onLink = (e: ChangeEvent<HTMLInputElement>) => {
    void persist({ link: e.target.value || undefined })
  }

  const onReplaceClick = () => dropzoneRef.current?.openFilePicker()

  const onCropApply = useCallback(
    async (blob: Blob) => {
      try {
        const rec = await uploadImage(blob, { filename: `crop-${block.id}.png` })
        await persist({ imageId: rec.image_id })
        setCropOpen(false)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [block.id, persist],
  )

  const onRotateClick = async () => {
    if (rotateBusy || !src || usingSample) return
    setRotateBusy(true)
    setError(null)
    try {
      const el = await loadImageElement(src)
      const next = rotate90(0, 1) // single 90° step per click
      const blob = await rotateImageToBlob(el, next)
      const rec = await uploadImage(blob, { filename: `rot-${block.id}.png` })
      await persist({ imageId: rec.image_id })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRotateBusy(false)
    }
  }

  const altWarn = shouldShowAltWarning(alt ?? '', savedOnce)

  return (
    <figure
      data-image-block-editor
      data-block-id={block.id}
      className={`group relative my-4 ${widthCls} mx-auto`}
    >
      <div
        className="relative overflow-hidden rounded-lg border border-smsg-100 shadow-sm transition-shadow duration-base group-hover:shadow-md"
        style={{ backgroundColor: placeholderBg }}
      >
        <img
          src={src}
          alt={alt || caption || ''}
          loading="lazy"
          className="block w-full"
        />

        {/* Hover toolbar */}
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-white/95 p-1 text-xs opacity-0 shadow-md backdrop-blur-sm transition-all duration-base group-hover:opacity-100 group-focus-within:opacity-100">
          <select
            aria-label={t('editor.image.size')}
            value={block.width ?? 'md'}
            onChange={onWidth}
            disabled={busy}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            {WIDTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t('editor.image.align')}
            value={block.meta?.align ?? 'center'}
            onChange={onAlign}
            disabled={busy}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            {ALIGN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
          <button
            type="button"
            title={t('editor.image.crop')}
            aria-label={t('editor.image.cropAria')}
            data-action="crop"
            onClick={() => setCropOpen(true)}
            disabled={busy || usingSample}
            className="rounded px-1 hover:bg-smsg-100 disabled:opacity-40"
          >
            <span aria-hidden="true">✂</span>
          </button>
          <button
            type="button"
            title={t('editor.image.rotateTitle')}
            aria-label={t('editor.image.rotateAria')}
            data-action="rotate"
            onClick={() => void onRotateClick()}
            disabled={busy || rotateBusy || usingSample}
            className="rounded px-1 hover:bg-smsg-100 disabled:opacity-40"
          >
            <span aria-hidden="true">↻</span>
          </button>
          <button
            type="button"
            title={t('editor.image.replaceTitle')}
            aria-label={t('editor.image.replaceAria')}
            onClick={onReplaceClick}
            className="rounded px-1 hover:bg-smsg-100"
          >
            <span aria-hidden="true">🔁</span>
          </button>
          <button
            type="button"
            title={t('editor.image.galleryTitle')}
            aria-label={t('editor.image.galleryTitle')}
            onClick={() => setGalleryOpen((v) => !v)}
            className="rounded px-1 hover:bg-smsg-100"
          >
            <span aria-hidden="true">🖻</span>
          </button>
          {image && (
            <a
              href={image.urls.orig}
              download
              title={t('editor.image.downloadTitle')}
              aria-label={t('editor.image.downloadAria')}
              className="rounded px-1 hover:bg-smsg-100"
            >
              <span aria-hidden="true">⬇</span>
            </a>
          )}
        </div>
      </div>

      {/* Caption / alt inputs — the differentiating UX. */}
      <div className="mt-1 space-y-1 text-xs text-gray-700">
        <input
          ref={captionRef}
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={onCaptionKey}
          onBlur={onCaptionBlur}
          placeholder={t('editor.image.captionPlaceholder')}
          aria-label={t('editor.image.captionLabel')}
          data-pulsing={captionPulsing ? '' : undefined}
          className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-center transition-shadow hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none ${
            captionPulsing
              ? 'ring-2 ring-smsg-500 ring-offset-1'
              : ''
          }`}
        />
        <div className="flex items-center gap-2">
          <input
            ref={altRef}
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            onKeyDown={onAltKey}
            onBlur={onAltBlur}
            placeholder={t('editor.image.altPlaceholder')}
            aria-label={t('editor.image.altLabel')}
            className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
          />
          <input
            type="text"
            defaultValue={block.link ?? ''}
            onBlur={onLink}
            placeholder={t('editor.image.linkPlaceholder')}
            aria-label={t('editor.image.linkLabel')}
            className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
          />
        </div>
        {altWarn && !altChipDismissed && (
          <div
            data-alt-warning
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-0.5 text-[11px] text-amber-800"
          >
            <span aria-hidden="true">⚠</span>
            <span className="flex-1">{t('editor.image.altWarn')}</span>
            <button
              type="button"
              onClick={() => altRef.current?.focus()}
              className="rounded bg-amber-100 px-2 py-0.5 font-medium hover:bg-amber-200"
            >
              {t('editor.image.altInsert')}
            </button>
            <button
              type="button"
              aria-label={t('editor.image.altDismiss')}
              onClick={() => setAltChipDismissed(true)}
              className="rounded px-1 hover:bg-amber-100"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        )}
        {error && (
          <p role="status" aria-live="polite" className="text-red-600">
            {error}
          </p>
        )}
      </div>

      {/* Sample image gallery — appears when toggled on by 🖻 chip. */}
      {galleryOpen && (
        <div
          data-sample-image-gallery
          className="mt-2 grid grid-cols-3 gap-2 rounded border border-gray-200 bg-white p-2 sm:grid-cols-5"
        >
          {SAMPLE_IMAGES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              aria-label={t('editor.image.sampleLabel', { label: sample.label })}
              data-sample-id={sample.id}
              onClick={() => {
                void persist({ imageId: `sample:${sample.id}` })
                setGalleryOpen(false)
              }}
              className="overflow-hidden rounded border border-gray-200 transition-shadow hover:shadow-md"
            >
              <img src={sample.src} alt={sample.label} loading="lazy" className="h-12 w-full object-cover" />
              <span className="block px-1 py-0.5 text-[10px] text-gray-600">{sample.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Hidden replace dropzone. */}
      <ImageDropzone
        ref={dropzoneRef}
        mode="replace"
        onImageReady={(rec) => persist({ imageId: rec.image_id })}
      />

      {cropOpen && !usingSample && (
        <CropOverlay
          src={image?.urls.orig ?? src}
          onApply={onCropApply}
          onCancel={() => setCropOpen(false)}
        />
      )}
    </figure>
  )
}
