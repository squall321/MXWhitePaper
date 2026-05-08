import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  type ReactNode,
} from 'react'
import type { ImageRecord } from '../api'
import { uploadImage } from '../uploadImage'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export type DropzoneMode = 'inline' | 'replace' | 'gallery'

/**
 * Imperative handle exposed by `<ImageDropzone>`. The slash-menu and the
 * `+ 이미지` toolbar button call `openFilePicker()` to programmatically
 * trigger file selection without the user having to drag a file in.
 */
export interface ImageDropzoneHandle {
  openFilePicker(): void
  /** Programmatic upload for files acquired some other way (e.g. drop). */
  uploadFiles(files: File[]): Promise<void>
}

interface UploadStatus {
  /** 0..100 — combined hashing+uploading+finalizing progress. */
  pct: number
  stage: 'hashing' | 'uploading' | 'finalizing'
  /** Mapped to the dominant_color shimmer once we have it (we don't yet). */
  filename: string
}

interface ImageDropzoneProps {
  /**
   * Called once for each successfully uploaded image. The block insertion is
   * the parent's responsibility (so a slash-menu insertion vs. a toolbar
   * insertion can pick a different `section_id` / index).
   */
  onImageReady: (image: ImageRecord, ctx: { mode: DropzoneMode; index: number; total: number }) => void | Promise<void>
  /**
   * Called once after ALL files in a single drop / paste / pick have been
   * processed. Used by the gallery flow to bundle results.
   */
  onBatchReady?: (images: ImageRecord[]) => void | Promise<void>
  /** True = render an always-on visible drop target (article-root mount). */
  surface?: boolean
  /** Children appear inside the drop surface; hover state is overlaid. */
  children?: ReactNode
  /** Initial mode hint passed to onImageReady. Inline by default. */
  mode?: DropzoneMode
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

/**
 * Universal image dropzone wired into:
 *   1. Drag & drop on the editor surface.
 *   2. Clipboard paste (active while editor is in fullEdit mode — caller
 *      controls activation by mounting / unmounting this component).
 *   3. File picker via the imperative handle (slash-menu + toolbar button).
 *   4. Multi-file flows: 2+ files trigger a "make a gallery?" dialog.
 *
 * The dropzone never inserts blocks itself — it just yields validated
 * `ImageRecord`s through `onImageReady`. The parent (block toolbar / slash
 * menu) decides where to insert them.
 */
export const ImageDropzone = forwardRef<ImageDropzoneHandle, ImageDropzoneProps>(
  function ImageDropzone(
    { onImageReady, onBatchReady, surface = false, children, mode = 'inline' },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [dragOver, setDragOver] = useState(false)
    const [uploads, setUploads] = useState<UploadStatus[]>([])
    const [pendingMulti, setPendingMulti] = useState<File[] | null>(null)

    /** Run the upload for a list of files. Reports progress per slot. */
    const runUploads = useCallback(
      async (files: File[], chosenMode: DropzoneMode) => {
        // Seed status rows so the UI shows skeletons immediately.
        setUploads(
          files.map((f) => ({ pct: 0, stage: 'hashing', filename: f.name })),
        )
        const records: ImageRecord[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (!file) continue
          try {
            const rec = await uploadImage(file, {
              onProgress: (stage, pct) => {
                setUploads((prev) => {
                  const copy = prev.slice()
                  // Map sub-stage progress to a single 0..100:
                  //   hashing 0..15, uploading 15..90, finalizing 90..100.
                  let total = 0
                  if (stage === 'hashing') total = Math.round(pct * 0.15)
                  else if (stage === 'uploading')
                    total = 15 + Math.round(pct * 0.75)
                  else total = 90 + Math.round(pct * 0.1)
                  copy[i] = { pct: total, stage, filename: file.name }
                  return copy
                })
              },
            })
            records.push(rec)
            await onImageReady(rec, {
              mode: chosenMode,
              index: i,
              total: files.length,
            })
          } catch (err) {
            console.error('[ImageDropzone] upload failed', err)
            setUploads((prev) => {
              const copy = prev.slice()
              copy[i] = { pct: 0, stage: 'hashing', filename: `${file.name} ✗` }
              return copy
            })
          }
        }
        if (onBatchReady && records.length > 0) await onBatchReady(records)
        // Hide progress shortly after completion so the user can see the
        // final block immediately.
        setTimeout(() => setUploads([]), 600)
      },
      [onImageReady, onBatchReady],
    )

    /** Entry-point used by drop, paste, and picker. Branches on N>1. */
    const acceptFiles = useCallback(
      (files: File[]) => {
        const images = files.filter((f) => f.type.startsWith('image/'))
        if (images.length === 0) return
        if (images.length === 1) {
          void runUploads(images, mode === 'gallery' ? 'gallery' : mode)
          return
        }
        // Multi-file: prompt for gallery vs. inline-stacked.
        setPendingMulti(images)
      },
      [mode, runUploads],
    )

    useImperativeHandle(
      ref,
      () => ({
        openFilePicker: () => inputRef.current?.click(),
        uploadFiles: async (files) => {
          acceptFiles(files)
        },
      }),
      [acceptFiles],
    )

    // --- Drag handlers -----------------------------------------------------
    const onDragOver = useCallback((e: React.DragEvent) => {
      if (!e.dataTransfer) return
      const hasFiles =
        Array.from(e.dataTransfer.items ?? []).some((it) => it.kind === 'file') ||
        e.dataTransfer.types.includes('Files')
      if (!hasFiles) return
      e.preventDefault()
      setDragOver(true)
    }, [])

    const onDragLeave = useCallback(() => setDragOver(false), [])

    const onDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const dt = e.dataTransfer
        if (!dt) return
        acceptFiles(Array.from(dt.files))
      },
      [acceptFiles],
    )

    // --- Paste handler (window-level so it works while editor focuses) -----
    useEffect(() => {
      const onPaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items
        if (!items) return
        const files: File[] = []
        for (const it of items) {
          if (it.kind === 'file') {
            const f = it.getAsFile()
            if (f && f.type.startsWith('image/')) files.push(f)
          }
        }
        if (files.length > 0) {
          e.preventDefault()
          acceptFiles(files)
        }
      }
      window.addEventListener('paste', onPaste)
      return () => window.removeEventListener('paste', onPaste)
    }, [acceptFiles])

    return (
      <div
        data-image-dropzone
        onDragOver={surface ? onDragOver : undefined}
        onDragLeave={surface ? onDragLeave : undefined}
        onDrop={surface ? onDrop : undefined}
        className={
          surface
            ? `relative ${dragOver ? 'ring-2 ring-smsg-700 ring-offset-2' : ''}`
            : 'relative'
        }
      >
        {children}

        {/* Hidden file picker — driven by the imperative handle. */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) acceptFiles(files)
            // Reset so picking the same file twice still fires onChange.
            e.target.value = ''
          }}
        />

        {/* Drag-over hint. */}
        {dragOver && surface && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded bg-smsg-100/70 text-smsg-900">
            <span className="rounded bg-white px-3 py-1 text-sm font-medium shadow">
              여기에 이미지를 놓으세요
            </span>
          </div>
        )}

        {/* Per-file progress rows. */}
        {uploads.length > 0 && (
          <ul
            data-upload-progress
            className="my-2 space-y-1 rounded border border-smsg-100 bg-white p-2 text-xs"
          >
            {uploads.map((u, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-32 truncate text-gray-600">{u.filename}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-100">
                  <div
                    className="h-full bg-smsg-700 transition-all"
                    style={{ width: `${u.pct}%` }}
                  />
                </div>
                <span className="w-10 text-right text-gray-500">
                  {u.stage === 'finalizing' ? '확인' : `${u.pct}%`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Gallery confirmation. */}
        <ConfirmDialog
          open={pendingMulti !== null}
          title={`이미지 ${pendingMulti?.length ?? 0}장 — 갤러리로 만들까요?`}
          message="갤러리 블록 하나로 묶거나, 인라인 이미지로 따로 추가할 수 있어요."
          confirmLabel="갤러리"
          cancelLabel="개별 이미지"
          onConfirm={() => {
            const files = pendingMulti
            setPendingMulti(null)
            if (files) void runUploads(files, 'gallery')
          }}
          onCancel={() => {
            const files = pendingMulti
            setPendingMulti(null)
            if (files) void runUploads(files, 'inline')
          }}
        />
      </div>
    )
  },
)
