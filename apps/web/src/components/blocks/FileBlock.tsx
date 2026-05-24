import type { FileBlock } from '@/types/document'

const MIB = 1024 * 1024
const KIB = 1024
function formatSize(size: number | undefined): string {
  if (!size) return ''
  if (size >= MIB) return (size / MIB).toFixed(1) + ' MB'
  if (size >= KIB) return (size / KIB).toFixed(1) + ' KB'
  return size + ' B'
}

/**
 * File attachment row — link hits `/api/v1/files/<id>/download` which 302s
 * to a fresh 1-day presigned MinIO GET URL (cookie auth carries through).
 */
export function FileBlockView({ block }: { block: FileBlock }) {
  const href = `/api/v1/files/${encodeURIComponent(block.fileId)}/download`
  return (
    <a
      href={href}
      className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2 text-sm hover:border-smsg-500 dark:border-gray-700 dark:bg-gray-900"
      download={block.name}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className="text-lg">📎</span>
        <span className="font-medium text-smsg-900">{block.name}</span>
      </span>
      <span className="text-xs text-gray-500">
        {block.mime ? `${block.mime} · ` : ''}
        {formatSize(block.size)}
      </span>
    </a>
  )
}
