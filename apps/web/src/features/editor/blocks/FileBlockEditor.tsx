import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { FileBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'

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
 * FileBlockEditor — local file picker pulls name/size/mime from the OS file
 * picker (read-only metadata) so the user can attach a description quickly.
 *
 * Note: full file upload infra (sha256 + presigned URL like images) is not
 * in scope of this editor refactor — the BE accepts an existing `fileId` and
 * we surface that as a manually editable input. Replace / rename round-trip
 * via `patchBlock`.
 */
export function FileBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<FileBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocal(block)
  }, [block])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

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

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    schedule({
      ...local,
      name: file.name,
      size: file.size,
      mime: file.type || local.mime,
    })
  }

  const icon = pickIcon(local.mime)

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
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded border border-smsg-300 px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100"
        >
          교체
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        onChange={onPickFile}
        className="hidden"
        aria-label="파일 선택"
      />
      <input
        type="text"
        value={local.fileId ?? ''}
        onChange={(e) => schedule({ ...local, fileId: e.target.value })}
        placeholder="파일 ID (사내 스토리지)"
        aria-label="파일 ID"
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 font-mono text-[11px] focus:border-smsg-500 focus:outline-none"
      />
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

function pickIcon(mime: string | undefined): string {
  if (!mime) return '📎'
  if (mime.startsWith('image/')) return '🖼'
  if (mime.startsWith('video/')) return '🎞'
  if (mime.startsWith('audio/')) return '🎧'
  if (mime === 'application/pdf') return '📕'
  if (mime.includes('zip') || mime.includes('archive')) return '🗜'
  if (mime.includes('json') || mime.includes('xml')) return '📋'
  if (mime.startsWith('text/')) return '📄'
  return '📎'
}
