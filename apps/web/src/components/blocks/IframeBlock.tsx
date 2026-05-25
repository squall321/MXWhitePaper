import { useEffect, useRef, useState } from 'react'
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
 *
 * Cycle `iframe-placeholder-fallback` (2026-05-25): src-mode iframes get
 * a friendly placeholder overlay if `onLoad` hasn't fired within
 * LOAD_TIMEOUT_MS. Many external sites send X-Frame-Options: DENY or
 * a frame-ancestors CSP that browsers honour silently — the iframe just
 * renders as an empty box, leaving the user wondering. The placeholder
 * surfaces the URL + an "새 탭에서 열기" link so the embed is still
 * useful even when foreign hosts block it.
 */
const LOAD_TIMEOUT_MS = 4000

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
    return <SrcIframeWithFallback src={block.src} title={title} height={height} caption={block.title} />
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

function SrcIframeWithFallback({
  src,
  title,
  height,
  caption,
}: {
  src: string
  title: string
  height: number
  caption?: string
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'blocked'>('loading')
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    timerRef.current = window.setTimeout(() => {
      // onLoad가 4초 안에 발화 안 했으면 X-Frame-Options/CSP로 차단된
      // 것으로 가정. 일부 느린 사이트는 false-positive 가능 — 그래도
      // placeholder는 "새 탭" 버튼만 추가하고 iframe 자체는 가리지 않음.
      setStatus((prev) => (prev === 'loading' ? 'blocked' : prev))
    }, LOAD_TIMEOUT_MS)
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [src])
  const onLoad = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    setStatus('loaded')
  }
  const hostname = (() => {
    try {
      return new URL(src).hostname
    } catch {
      return src
    }
  })()
  const showPlaceholder = status !== 'loaded'
  return (
    <figure className="rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
      {caption && (
        <figcaption className="mb-1 text-xs text-gray-500">{caption}</figcaption>
      )}
      <div className="relative w-full">
        <iframe
          src={src}
          title={title}
          height={height}
          className="block w-full rounded"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          loading="lazy"
          onLoad={onLoad}
          data-iframe-status={status}
        />
        {showPlaceholder && (
          <div
            data-iframe-placeholder={status}
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded bg-gray-50/95 px-4 text-center text-sm text-gray-600 dark:bg-gray-800/95 dark:text-gray-300"
          >
            <span className="font-medium">
              {status === 'loading' ? '임베드 불러오는 중…' : '임베드를 표시할 수 없습니다'}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{hostname}</span>
            {status === 'blocked' && (
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="pointer-events-auto rounded border border-smsg-300 bg-white px-3 py-1 text-xs text-smsg-700 hover:bg-smsg-50 dark:border-smsg-500 dark:bg-gray-900 dark:text-smsg-300 dark:hover:bg-gray-800"
              >
                새 탭에서 열기 ↗
              </a>
            )}
          </div>
        )}
      </div>
    </figure>
  )
}
