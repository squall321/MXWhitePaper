import { useEffect, useRef, useState } from 'react'
import type { FlowBlock } from '@/types/document'

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const m = mod.default
      m.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })
      return m
    })
  }
  return mermaidPromise
}

/**
 * `flow` block: Mermaid DSL is rendered via the lazy-loaded `mermaid`
 * package (kept out of the main bundle). `excalidraw` payloads fall back
 * to a JSON dump for now (full Sprint-7 work).
 */
export function FlowBlockView({ block }: { block: FlowBlock }) {
  if (block.engine === 'mermaid') return <MermaidFlow block={block} />
  return (
    <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs">
      {block.source}
    </pre>
  )
}

function MermaidFlow({ block }: { block: FlowBlock }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 8)}`)

  useEffect(() => {
    let cancelled = false
    setErr(null)
    loadMermaid()
      .then(async (m) => {
        try {
          const out = await m.render(idRef.current, block.source)
          if (!cancelled) setSvg(out.svg)
        } catch (e) {
          if (!cancelled) setErr(String((e as Error).message ?? e))
        }
      })
      .catch((e) => !cancelled && setErr(String(e)))
    return () => {
      cancelled = true
    }
  }, [block.source])

  if (err) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
        Mermaid 렌더 실패: {err}
      </div>
    )
  }
  if (!svg) {
    return <div className="text-xs text-gray-500">flow 렌더링 중…</div>
  }
  return (
    <div
      className="overflow-x-auto rounded border border-gray-200 bg-white p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
