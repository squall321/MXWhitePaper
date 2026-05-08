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

const ALIGN_OPTIONS: { value: 'left' | 'center' | 'right' | 'full'; label: string }[] = [
  { value: 'left', label: '좌' },
  { value: 'center', label: '중앙' },
  { value: 'right', label: '우' },
  { value: 'full', label: 'Full' },
]

const WIDTH_CLASS: Record<NonNullable<ImageBlock['width']>, string> = {
  sm: 'w-1/4',
  md: 'w-1/2',
  lg: 'w-3/4',
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
  const src = image?.urls.view ?? `/api/v1/images/${encodeURIComponent(block.imageId)}`
  const placeholderBg = image?.dominant_color ?? '#f3f4f6'

  const persist = useCallback(
    async (patch: Partial<ImageBlock>) => {
      if (!etag) return
      setBusy(true)
      setError(null)
      try {
        const result = await patchBlock(slug, block.id, patch, etag, '이미지 편집')
        applySnapshot(result.document, result.etag)
        setSavedOnce(true)
      } catch (err) {
        if (isPreconditionFailed(err)) {
          setConflict(null)
          setError('충돌 — 새로고침 필요')
        } else {
          setError((err as Error).message)
        }
      } finally {
        setBusy(false)
      }
    },
    [etag, slug, block.id, applySnapshot, setConflict],
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
            aria-label="크기"
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
            aria-label="정렬"
            value={block.meta?.align ?? 'center'}
            onChange={onAlign}
            disabled={busy}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            {ALIGN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="교체"
            aria-label="이미지 교체"
            onClick={onReplaceClick}
            className="rounded px-1 hover:bg-smsg-100"
          >
            🔁
          </button>
          {image && (
            <a
              href={image.urls.orig}
              download
              title="다운로드"
              aria-label="원본 다운로드"
              className="rounded px-1 hover:bg-smsg-100"
            >
              ⬇
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
          placeholder="캡션 입력..."
          aria-label="이미지 캡션"
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
            placeholder="대체 텍스트 (alt)"
            aria-label="이미지 alt 텍스트"
            className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
          />
          <input
            type="text"
            defaultValue={block.link ?? ''}
            onBlur={onLink}
            placeholder="링크 (URL or slug)"
            aria-label="이미지 링크"
            className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
          />
        </div>
        {altWarn && !altChipDismissed && (
          <div
            data-alt-warning
            className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-0.5 text-[11px] text-amber-800"
          >
            <span aria-hidden>⚠</span>
            <span className="flex-1">alt 입력 추천 — 접근성/검색에 도움이 돼요.</span>
            <button
              type="button"
              onClick={() => altRef.current?.focus()}
              className="rounded bg-amber-100 px-2 py-0.5 font-medium hover:bg-amber-200"
            >
              alt 입력
            </button>
            <button
              type="button"
              aria-label="이번 세션에서는 숨기기"
              onClick={() => setAltChipDismissed(true)}
              className="rounded px-1 hover:bg-amber-100"
            >
              ✕
            </button>
          </div>
        )}
        {error && <p className="text-red-600">{error}</p>}
      </div>

      {/* Hidden replace dropzone. */}
      <ImageDropzone
        ref={dropzoneRef}
        mode="replace"
        onImageReady={(rec) => persist({ imageId: rec.image_id })}
      />
    </figure>
  )
}
