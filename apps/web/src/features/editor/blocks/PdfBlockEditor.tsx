import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { PdfBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useUploadFile } from '@/features/upload/hooks/useUploadFile'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  block: PdfBlock
}

/**
 * PdfBlockEditor — PDF picker + live inline preview.
 *
 *   1. File input restricted to `application/pdf`. Reuses the cycle-5 upload
 *      pipeline (`useUploadFile`) so the BE finalize step + permissions are
 *      shared with FileBlockEditor.
 *   2. After upload sets `block.file_id` and persists immediately.
 *   3. Title / starting page / height inputs are debounced 800 ms via
 *      `patchBlock`, mirroring the IframeBlockEditor cadence.
 *
 * Live preview reuses the same `<iframe src=".../download#page=N">` shape as
 * the read-mode `PdfBlockView` so editors see exactly what readers will get.
 */
export function PdfBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<PdfBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { upload, progress, busy, error: uploadError } = useUploadFile()

  useEffect(() => {
    setLocal(block)
  }, [block])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (uploadError) setError(uploadError)
  }, [uploadError])

  const schedule = (next: PdfBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: PdfBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          file_id: next.file_id,
          title: next.title,
          page: next.page,
          height_px: next.height_px,
        } as Partial<PdfBlock>,
        etag,
        t('editor.pdf.changeLog'),
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

  const doUpload = async (file: File) => {
    setError(null)
    try {
      const rec = await upload(file)
      const next: PdfBlock = {
        ...local,
        file_id: rec.fileId,
        // Default the title to the filename if the editor never typed one.
        title: local.title && local.title.length > 0 ? local.title : rec.filename,
      }
      setLocal(next)
      await persist(next)
    } catch {
      // upload hook already surfaced the error message.
    }
  }

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type && file.type !== 'application/pdf') {
      setError(t('editor.pdf.notPdf'))
      return
    }
    void doUpload(file)
  }

  const height = local.height_px ?? 600
  const page = local.page ?? 1
  const hasFile = Boolean(local.file_id)
  const previewSrc = hasFile
    ? `/api/v1/files/${encodeURIComponent(local.file_id)}/download${
        page > 1 ? `#page=${page}` : ''
      }`
    : null
  const pct = Math.round(progress * 100)

  return (
    <div
      data-pdf-block-editor
      data-block-id={block.id}
      className="my-3 space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={local.title ?? ''}
          onChange={(e) =>
            schedule({ ...local, title: e.target.value || undefined })
          }
          placeholder={t('editor.pdf.titlePlaceholder')}
          aria-label={t('editor.pdf.titleLabel')}
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded border border-smsg-300 bg-white px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100 disabled:opacity-50"
        >
          {hasFile ? t('editor.pdf.replace') : t('editor.pdf.upload')}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-[11px] text-gray-600">
          <span>{t('editor.pdf.pageLabel')}</span>
          <input
            type="number"
            min={1}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value)
              schedule({ ...local, page: Number.isFinite(n) && n >= 1 ? n : 1 })
            }}
            aria-label={t('editor.pdf.pageLabel')}
            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-gray-600">
          <span>{t('editor.pdf.heightLabel')}</span>
          <input
            type="number"
            min={200}
            max={4000}
            value={height}
            onChange={(e) => {
              const n = Number(e.target.value)
              schedule({
                ...local,
                height_px: clampHeight(Number.isFinite(n) ? n : 600),
              })
            }}
            aria-label={t('editor.pdf.heightLabel')}
            className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
          />
        </label>
      </div>

      {busy && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('editor.pdf.uploadProgress')}
          className="h-1.5 w-full overflow-hidden rounded bg-gray-200"
        >
          <div
            className="h-full bg-smsg-500 transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={onPickFile}
        className="hidden"
        aria-label={t('editor.pdf.pickerLabel')}
      />

      {previewSrc ? (
        <iframe
          src={previewSrc}
          title={local.title ?? 'PDF 미리보기'}
          height={height}
          className="w-full rounded border border-gray-200 bg-gray-100"
        />
      ) : (
        <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-center text-xs text-gray-500">
          {t('editor.pdf.empty')}
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

/** Clamp height to schema bounds (200..4000). Exported for unit tests. */
export function clampHeight(n: number): number {
  if (n < 200) return 200
  if (n > 4000) return 4000
  return Math.round(n)
}
