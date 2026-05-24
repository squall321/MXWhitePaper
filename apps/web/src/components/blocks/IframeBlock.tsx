import type { IframeBlock } from '@/types/document'

/**
 * Iframe block — supports two modes:
 *
 *   1. External URL (`src`): renders the page in a sandboxed iframe.
 *      The BE enforces a whitelist of allowed hosts; the FE still
 *      narrows the sandbox to scripts/forms/popups (no top-level
 *      navigation, no parent storage access).
 *
 *   2. Inline HTML (`html`): renders a self-contained page via iframe
 *      `srcdoc`. We strip the BE-side whitelist requirement (no host
 *      involved) and tighten the sandbox to JUST `allow-scripts` —
 *      the embed can run JS to draw a chart, listen for clicks, etc.,
 *      but it CAN'T touch the parent DOM, cookies, localStorage, or
 *      navigate the top frame. Same-origin is intentionally denied so
 *      the iframe is treated as a foreign origin even though it shares
 *      the document's domain.
 */
export function IframeBlockView({ block }: { block: IframeBlock }) {
  const height = block.height ?? 360
  const title = block.title ?? 'embedded content'

  if (block.html) {
    return (
      <figure className="rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
        {block.title && (
          <figcaption className="mb-1 text-xs text-gray-500">{block.title}</figcaption>
        )}
        <iframe
          srcDoc={block.html}
          title={title}
          height={height}
          className="w-full rounded"
          sandbox="allow-scripts"
          loading="lazy"
        />
      </figure>
    )
  }
  if (block.src) {
    return (
      <figure className="rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
        {block.title && (
          <figcaption className="mb-1 text-xs text-gray-500">{block.title}</figcaption>
        )}
        <iframe
          src={block.src}
          title={title}
          height={height}
          className="w-full rounded"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          loading="lazy"
        />
      </figure>
    )
  }
  return (
    <figure
      className="flex min-h-[120px] items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-600 dark:bg-gray-800"
      data-empty-iframe-block
    >
      비어있는 임베드 — URL 또는 HTML을 입력하세요
    </figure>
  )
}
