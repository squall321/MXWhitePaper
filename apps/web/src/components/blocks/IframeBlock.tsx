import type { IframeBlock } from '@/types/document'

/**
 * Iframe block — renders the URL in a sandboxed iframe at the requested
 * height. The BE is responsible for whitelist enforcement; we still set
 * a defensive `sandbox` attribute.
 */
export function IframeBlockView({ block }: { block: IframeBlock }) {
  const height = block.height ?? 360
  return (
    <figure className="rounded border border-gray-200 bg-white p-2">
      {block.title && (
        <figcaption className="mb-1 text-xs text-gray-500">{block.title}</figcaption>
      )}
      <iframe
        src={block.src}
        title={block.title ?? 'embedded content'}
        height={height}
        className="w-full rounded"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </figure>
  )
}
