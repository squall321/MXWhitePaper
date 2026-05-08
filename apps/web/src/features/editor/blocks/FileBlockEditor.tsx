import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { FileBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useUploadFile } from '@/features/upload/hooks/useUploadFile'
import { fileDownloadUrl } from '@/features/upload/uploadFile'

interface Props {
  slug: Slug
  block: FileBlock
}

const MIB = 1024 * 1024
const KIB = 1024
function formatSize(size: number | undefined): string {
  if (!size) return ''
  if (size >= MIB) return (size / MIB).toFixed(1) + ' MB'
  if (size >= KIB) return (size / KIB).toFixed(1) + ' KB'
  return size + ' B'
}

/**
 * FileBlockEditor — full upload pipeline:
 *
 *   1. OS picker → File
 *   2. `uploadFile` (presign-put → PUT → finalize) with a progress bar
 *   3. patchBlock to persist `fileId / name / size / mime`
 *
 * On failure shows the error inline with a "다시 시도" button (re-clicks the
 * picker). Below the upload affordance, rendering the file's display state:
 * mime emoji + filename + size + "다운로드" link → `/files/:id/download`.
 */
export function FileBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<FileBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [lastFile, setLastFile] = useState<File | null>(null)
  const debounceRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { upload, progress, busy, error: uploadError, reset } = useUploadFile()

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

  const schedule = (next: FileBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: FileBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          fileId: next.fileId,
          name: next.name,
          size: next.size,
          mime: next.mime,
        },
        etag,
        '파일 편집',
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('충돌 — 새로고침 필요')
      } else {
        setError((err as Error).message)
      }
    }
  }

  const doUpload = async (file: File) => {
    setError(null)
    setLastFile(file)
    try {
      const rec = await upload(file)
      // 업로드 성공 → 즉시 patch (debounce 없이) — 사용자가 추가 편집을 안 해도 저장.
      const next: FileBlock = {
        ...local,
        fileId: rec.fileId,
        name: rec.filename,
        size: rec.size,
        mime: rec.mime,
      }
      setLocal(next)
      await persist(next)
    } catch {
      // useUploadFile already set its own error state; we just stop here.
    }
  }

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file later
    if (!file) return
    void doUpload(file)
  }

  const onRetry = () => {
    if (lastFile) {
      reset()
      void doUpload(lastFile)
    } else {
      reset()
      fileInputRef.current?.click()
    }
  }

  const icon = mimeToEmoji(local.mime)
  const hasFile = Boolean(local.fileId)
  const downloadHref = hasFile ? fileDownloadUrl(local.fileId) : null
  const pct = Math.round(progress * 100)

  return (
    <div
      data-file-block-editor
      data-block-id={block.id}
      className="my-3 space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
    >
      <div className="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2">
        <span aria-hidden className="text-2xl">
          {icon}
        </span>
        <div className="flex-1 space-y-1 text-sm">
          <input
            type="text"
            value={local.name ?? ''}
            onChange={(e) => schedule({ ...local, name: e.target.value })}
            placeholder="파일명"
            aria-label="파일명"
            className="w-full rounded border border-transparent px-1 py-0.5 font-medium text-smsg-900 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
          />
          <p className="text-[11px] text-gray-500">
            {local.mime ? `${local.mime} · ` : ''}
            {formatSize(local.size)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {downloadHref && !busy && (
            <a
              href={downloadHref}
              className="rounded border border-smsg-300 px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100"
              download={local.name}
              aria-label="다운로드"
            >
              다운로드
            </a>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="rounded border border-smsg-300 px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100 disabled:opacity-50"
          >
            {hasFile ? '교체' : '업로드'}
          </button>
        </div>
      </div>

      {busy && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="파일 업로드 진행률"
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
        onChange={onPickFile}
        className="hidden"
        aria-label="파일 선택"
      />

      {error && (
        <div className="flex items-center justify-between rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="ml-2 rounded border border-red-300 bg-white px-2 py-0.5 text-red-700 hover:bg-red-100"
          >
            다시 시도
          </button>
        </div>
      )}
    </div>
  )
}

export function mimeToEmoji(mime: string | undefined): string {
  if (!mime) return '📎'
  if (mime.startsWith('image/')) return '🖼'
  if (mime.startsWith('video/')) return '🎞'
  if (mime.startsWith('audio/')) return '🎧'
  if (mime === 'application/pdf') return '📕'
  if (mime.includes('zip') || mime.includes('archive') || mime.includes('tar') || mime.includes('gzip'))
    return '🗜'
  if (mime.includes('word') || mime.includes('msword')) return '📘'
  if (mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv') return '📊'
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📽'
  if (mime.includes('json') || mime.includes('xml')) return '📋'
  if (mime.startsWith('text/')) return '📄'
  return '📎'
}
