import { useCallback, useRef, useState, type ReactNode } from 'react'
import type {
  Block,
  FileBlock,
  ImageBlock,
  PdfBlock,
  Slug,
  Ulid,
  VideoBlock,
} from '@/types/document'
import { insertBlock, isPreconditionFailed } from '@/features/editor/api'
import { useEditorStore } from '@/features/editor/state'
import { ulid } from '@/features/editor/ulid'
import { uploadImage } from './uploadImage'
import { uploadFile, fileDownloadUrl } from './uploadFile'
import { dispatchByMime } from './dispatchByMime'
import { toast } from '@/components/ui/Toast'

/**
 * Hard caps for a single drop. Per the spec:
 *   - At most 10 files per drop (anything beyond is dropped on the floor with
 *     a single warn toast).
 *   - Each file ≤ 30 MB (the BE enforces its own cap too; this is a friendly
 *     pre-check so the user doesn't sit through a hash-then-fail cycle).
 */
const MAX_FILES_PER_DROP = 10
const MAX_BYTES_PER_FILE = 30 * 1024 * 1024

/** Single in-flight progress row shown in the floating toast list. */
interface UploadRow {
  id: string
  filename: string
  pct: number
  /** When non-null the upload failed and we surface a short reason. */
  error?: string
}

interface Props {
  slug: Slug
  /** Section to insert the resulting blocks into. */
  sectionId: Ulid
  /**
   * If true, suppresses the drop UX entirely (used while the section is
   * collapsed — there's nothing visible to drop onto). Listeners are still
   * mounted so we don't break the wrapper boundary.
   */
  disabled?: boolean
  children: ReactNode
}

/**
 * Wrap any container with native drag-drop file handling. Dropped files are
 * routed by MIME → uploadImage / uploadFile → insertBlock, in sequence, at
 * the end of `sectionId`.
 *
 * Why a separate wrapper instead of folding it into the existing
 * `ImageDropzone`?  ImageDropzone is image-only and lives under the article
 * root for fullEdit mode. SmartFileDropZone is per-section and accepts ANY
 * file type, so dropping onto the in-section block list "just works" without
 * the user first having to pick a block type from the slash menu.
 *
 * Doesn't conflict with dnd-kit: dnd-kit's PointerSensor uses pointer events
 * and never calls `dataTransfer.setData('Files')`, so the native drag/drop
 * handlers below don't fire when the user is reordering blocks.
 */
export function SmartFileDropZone({ slug, sectionId, disabled, children }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [rows, setRows] = useState<UploadRow[]>([])
  // Suppress quick dragLeave→dragEnter flicker: we count enter/leave so the
  // overlay stays up while the user moves over child elements.
  const dragDepth = useRef(0)

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      if (!hasFiles(e)) return
      dragDepth.current += 1
      e.preventDefault()
      setDragOver(true)
    },
    [disabled],
  )

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      if (!hasFiles(e)) return
      // preventDefault is required to mark the element as a valid drop target.
      e.preventDefault()
      // Some browsers fire dragover without dragenter when the file enters
      // from outside the window — make sure the overlay shows.
      if (!dragOver) setDragOver(true)
    },
    [disabled, dragOver],
  )

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (disabled) return
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }, [disabled])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      if (disabled) return
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      await processDroppedFiles({
        files,
        slug,
        sectionId,
        onProgress: (next) => setRows(next),
      })
      // Auto-clear progress rows shortly after the last upload finishes.
      window.setTimeout(() => setRows([]), 1200)
    },
    [disabled, slug, sectionId],
  )

  return (
    <div
      data-smart-file-dropzone
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
      className="relative"
    >
      {children}

      {dragOver && !disabled && (
        <div
          data-testid="smart-drop-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-smsg-100/70 ring-2 ring-smsg-500"
        >
          <span className="rounded bg-white px-3 py-1 text-sm font-medium shadow">
            📁 파일 떨어뜨려서 추가
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <ul
          data-testid="smart-drop-progress"
          className="my-2 space-y-1 rounded border border-smsg-100 bg-white p-2 text-xs"
        >
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="w-32 truncate text-gray-600">{r.filename}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-100">
                <div
                  className="h-full bg-smsg-700 transition-all"
                  style={{ width: `${r.pct}%` }}
                />
              </div>
              <span className="w-16 text-right text-gray-500">
                {r.error ? '✗' : `${r.pct}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** True iff this drag event carries one or more File objects. */
function hasFiles(e: React.DragEvent): boolean {
  const dt = e.dataTransfer
  if (!dt) return false
  const types = Array.from(dt.types ?? [])
  if (types.includes('Files')) return true
  return Array.from(dt.items ?? []).some((it) => it.kind === 'file')
}

/**
 * Public for unit testing. Sequentially uploads each file and inserts a
 * block. Any failure is surfaced via toast + the progress row turns into a
 * red ✗; the loop continues with the remaining files (one bad file shouldn't
 * lose the rest of a multi-file drop).
 *
 * `deps` is an optional injection seam — production callers leave it empty
 * and we resolve uploadImage / uploadFile / insertBlock from the module
 * namespace, but tests pass mocks directly to avoid mocking ESM.
 */
export interface ProcessDroppedFilesArgs {
  files: File[]
  slug: Slug
  sectionId: Ulid
  onProgress: (rows: UploadRow[]) => void
  deps?: Partial<ProcessDeps>
  maxFiles?: number
  maxBytes?: number
}

export interface ProcessDeps {
  uploadImage: typeof uploadImage
  uploadFile: typeof uploadFile
  insertBlock: typeof insertBlock
  getEtag: () => string | null
  applySnapshot: (
    doc: Parameters<ReturnType<typeof useEditorStore.getState>['applyServerSnapshot']>[0],
    etag: string,
  ) => void
  setConflict: (remote: null) => void
  toastError: (m: string) => void
  toastWarn: (m: string) => void
  fileDownloadUrl: (id: string) => string
}

const defaultDeps = (): ProcessDeps => ({
  uploadImage,
  uploadFile,
  insertBlock,
  getEtag: () => useEditorStore.getState().etag,
  applySnapshot: (doc, etag) =>
    useEditorStore.getState().applyServerSnapshot(doc, etag),
  setConflict: (remote) => useEditorStore.getState().setConflict(remote),
  toastError: (m) => toast.error(m),
  toastWarn: (m) => toast.warn(m),
  fileDownloadUrl,
})

export async function processDroppedFiles(
  args: ProcessDroppedFilesArgs,
): Promise<void> {
  const max = args.maxFiles ?? MAX_FILES_PER_DROP
  const cap = args.maxBytes ?? MAX_BYTES_PER_FILE
  const deps: ProcessDeps = { ...defaultDeps(), ...args.deps }

  let queue = args.files
  if (queue.length > max) {
    deps.toastWarn(`한 번에 최대 ${max}개만 업로드합니다 (${queue.length - max}개 무시).`)
    queue = queue.slice(0, max)
  }

  // Reject oversize files up-front; the BE enforces its own cap too.
  const accepted: File[] = []
  for (const f of queue) {
    if (f.size > cap) {
      deps.toastWarn(`${f.name}: 30MB를 초과하여 업로드 불가.`)
      continue
    }
    accepted.push(f)
  }
  if (accepted.length === 0) return

  const rows: UploadRow[] = accepted.map((f) => ({
    id: ulid(),
    filename: f.name,
    pct: 0,
  }))
  args.onProgress(rows.slice())

  for (let i = 0; i < accepted.length; i++) {
    const file = accepted[i]
    if (!file) continue
    const decision = dispatchByMime(file)

    try {
      const block = await uploadAndBuildBlock(file, decision, deps, (pct) => {
        const row = rows[i]
        if (!row) return
        row.pct = pct
        args.onProgress(rows.slice())
      })

      const etag = deps.getEtag()
      if (!etag) {
        // No etag means the editor isn't bound — surface and stop the loop.
        deps.toastError('편집 세션이 만료되었습니다. 새로고침 후 다시 시도해주세요.')
        const row = rows[i]
        if (row) row.error = '세션 만료'
        args.onProgress(rows.slice())
        break
      }

      try {
        const result = await deps.insertBlock(
          args.slug,
          { section_id: args.sectionId, block },
          etag,
          `${decision.kind} 드롭 추가`,
        )
        deps.applySnapshot(result.document, result.etag)
        const row = rows[i]
        if (row) row.pct = 100
        args.onProgress(rows.slice())
      } catch (err) {
        if (isPreconditionFailed(err)) deps.setConflict(null)
        const row = rows[i]
        if (row) row.error = '저장 실패'
        deps.toastError(`${file.name}: 저장 실패`)
        args.onProgress(rows.slice())
        // Stop the loop — subsequent inserts would also fail with stale etag.
        break
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? '업로드 실패'
      const row = rows[i]
      if (row) row.error = msg
      deps.toastError(`${file.name}: ${msg}`)
      args.onProgress(rows.slice())
      // Continue with the next file — one bad upload shouldn't drop the rest.
    }
  }
}

/**
 * Run the right uploader for `decision` and assemble the matching Block.
 * Pulled out of the loop so the test can target it without faking the
 * editor store.
 */
async function uploadAndBuildBlock(
  file: File,
  decision: ReturnType<typeof dispatchByMime>,
  deps: ProcessDeps,
  onPct: (pct: number) => void,
): Promise<Block> {
  if (decision.uploader === 'image') {
    const rec = await deps.uploadImage(file, {
      onProgress: (stage, pct) => {
        // Map sub-stages onto a single 0..100 (same curve as ImageDropzone).
        let total = 0
        if (stage === 'hashing') total = Math.round(pct * 0.15)
        else if (stage === 'uploading') total = 15 + Math.round(pct * 0.75)
        else total = 90 + Math.round(pct * 0.1)
        onPct(total)
      },
    })
    const block: ImageBlock = {
      type: 'image',
      id: ulid(),
      imageId: rec.image_id,
    }
    return block
  }

  // file uploader is the path for pdf / video / file.
  const rec = await deps.uploadFile(file, {
    onProgress: (frac) => onPct(Math.round(frac * 100)),
  })

  if (decision.kind === 'pdf') {
    const pdf: PdfBlock = {
      type: 'pdf',
      id: ulid(),
      file_id: rec.fileId,
      title: rec.filename,
      page: 1,
      height_px: 600,
    }
    return pdf
  }
  if (decision.kind === 'video') {
    const video: VideoBlock = {
      type: 'video',
      id: ulid(),
      url: deps.fileDownloadUrl(rec.fileId),
      title: rec.filename,
      provider: 'intra',
    }
    return video
  }
  const file_block: FileBlock = {
    type: 'file',
    id: ulid(),
    fileId: rec.fileId,
    name: rec.filename,
    size: rec.size,
    mime: rec.mime,
  }
  return file_block
}
