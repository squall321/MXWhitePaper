import type { PdfBlock } from '@/types/document'

/**
 * PdfBlockView — inline PDF preview using the browser-native viewer.
 *
 * Wraps an `<iframe>` pointed at `/api/v1/files/:file_id/download#page=N`.
 * Chrome / Edge / Safari / Firefox all render PDFs natively, exposing the
 * built-in page navigation, zoom, and print/download chrome — so we don't
 * need to ship pdf.js. The fragment (`#page=N`) is the standard "open
 * parameters" hint understood by every modern viewer.
 *
 * The "다운로드" anchor below is a guaranteed fallback for cases where the
 * embedded viewer is disabled (rare CSP setups, mobile Safari quirks).
 */
export function PdfBlockView({ block }: { block: PdfBlock }) {
  const height = block.height_px ?? 600
  const page = block.page ?? 1
  const baseUrl = `/api/v1/files/${encodeURIComponent(block.file_id)}/download`
  // `#page=N` is the standard PDF Open Parameters hint — viewer reads the
  // fragment locally without re-fetching, so jumping pages is free.
  const src = page > 1 ? `${baseUrl}#page=${page}` : baseUrl
  const titleText = block.title || 'PDF 문서'

  return (
    <figure
      data-pdf-block
      data-block-id={block.id}
      className="my-3 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900"
    >
      <figcaption className="mb-1 flex items-center justify-between gap-2 px-1 text-xs text-gray-600">
        <span className="flex items-center gap-1.5 font-medium text-smsg-900 dark:text-gray-100">
          <span aria-hidden className="text-base leading-none">📕</span>
          <span>{titleText}</span>
        </span>
        <a
          href={baseUrl}
          download
          className="rounded border border-smsg-300 px-2 py-0.5 text-[11px] text-smsg-700 hover:bg-smsg-100 dark:border-smsg-500 dark:bg-gray-900 dark:text-smsg-300 dark:hover:bg-gray-800"
          aria-label={`${titleText} 다운로드`}
        >
          다운로드
        </a>
      </figcaption>
      <iframe
        src={src}
        title={titleText}
        height={height}
        className="w-full rounded bg-gray-100 dark:bg-gray-800"
      />
    </figure>
  )
}
