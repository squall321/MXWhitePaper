import { useEffect, useRef, useState } from 'react'
import type { FlowBlock } from '@/types/document'
import { useResolvedTheme, type ResolvedTheme } from '@/features/theme/useResolvedTheme'
import { WidgetExportMenu } from './WidgetExportMenu'
import { useT } from '@/lib/i18n'

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default)
  }
  return mermaidPromise
}

/**
 * Apply theme to mermaid singleton. Re-call on every render path that
 * cares about theme — mermaid stores `theme` on its global config, so the
 * latest `initialize()` wins for subsequent `render()` calls.
 */
function applyMermaidTheme(m: typeof import('mermaid').default, theme: ResolvedTheme) {
  m.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
  })
}

/** Shape we accept from `block.source` when `engine === 'excalidraw'`. */
export interface ExcalidrawScene {
  elements: unknown[]
  appState?: Record<string, unknown>
  files?: unknown
}

/**
 * Parse the raw `block.source` string into an Excalidraw scene object.
 * Returns either `{ ok: true, scene }` or `{ ok: false, kind, message }`
 * so the UI can show two distinct failure modes:
 *   - `kind: 'parse'` — invalid JSON
 *   - `kind: 'shape'` — JSON ok but no `elements: []` array
 * Exported as a pure helper so vitest can exercise the validation paths
 * without booting the lazy excalidraw chunk.
 */
export function parseExcalidrawScene(
  source: string,
):
  | { ok: true; scene: ExcalidrawScene }
  | { ok: false; kind: 'parse' | 'shape'; message: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (e) {
    return { ok: false, kind: 'parse', message: String((e as Error).message ?? e) }
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { elements?: unknown }).elements)
  ) {
    return { ok: false, kind: 'shape', message: 'missing elements array' }
  }
  return { ok: true, scene: parsed as ExcalidrawScene }
}

let excalidrawPromise: Promise<typeof import('@excalidraw/excalidraw')> | null = null

/**
 * Lazy-load only the headless `exportToSvg` path from
 * `@excalidraw/excalidraw`. We do NOT need the full editor canvas — the
 * widget renders as a static SVG just like mermaid. The package is
 * heavy (~4 MB), so it sits behind an `import()` so the main bundle is
 * unaffected when no doc carries an excalidraw flow.
 */
function loadExcalidraw() {
  if (!excalidrawPromise) {
    excalidrawPromise = import('@excalidraw/excalidraw')
  }
  return excalidrawPromise
}

/**
 * `flow` block — two engines, both rendered as static SVG:
 *
 * - `mermaid` — DSL string compiled by the `mermaid` package.
 * - `excalidraw` — scene JSON (`{ elements, appState?, files? }`) rendered
 *   via `@excalidraw/excalidraw`'s headless `exportToSvg`.
 *
 * Both renderers honour the active theme, lazy-load their engines, and
 * expose PNG/SVG download via WidgetExportMenu.
 */
export function FlowBlockView({ block }: { block: FlowBlock }) {
  if (block.engine === 'mermaid') return <MermaidFlow block={block} />
  return <ExcalidrawFlow block={block} />
}

function MermaidFlow({ block }: { block: FlowBlock }) {
  const t = useT()
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 8)}`)
  const theme = useResolvedTheme()

  useEffect(() => {
    let cancelled = false
    setErr(null)
    // Theme changed → mermaid caches by id; bump id so it re-renders cleanly.
    idRef.current = `mermaid-${Math.random().toString(36).slice(2, 8)}`
    loadMermaid()
      .then(async (m) => {
        try {
          applyMermaidTheme(m, theme)
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
  }, [block.source, theme])

  if (err) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('block.flow.mermaidError', { err })}
      </div>
    )
  }
  if (!svg) {
    return <div className="text-xs text-gray-500 dark:text-gray-400">{t('block.flow.rendering')}</div>
  }
  return (
    <div
      className="group relative overflow-x-auto rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900"
      data-export-root="flow"
    >
      <WidgetExportMenu formats={['png', 'svg']} filename="flow" />
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

/**
 * Excalidraw scene JSON renderer. The block's `source` is parsed to
 * `{ elements, appState?, files? }` (the standard Excalidraw scene
 * format you get from File → Save / clipboard). `exportToSvg` returns a
 * fully-formed `<svg>` we inject the same way mermaid does.
 *
 * Dark mode flips `appState.theme = 'dark'`; the lib paints dark canvas.
 */
function ExcalidrawFlow({ block }: { block: FlowBlock }) {
  const t = useT()
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const theme = useResolvedTheme()

  useEffect(() => {
    let cancelled = false
    setErr(null)
    setSvgMarkup(null)

    const parsed = parseExcalidrawScene(block.source)
    if (!parsed.ok) {
      // For 'parse' we surface the raw JSON.parse message; for 'shape' we
      // surface an empty err — the render block keys on a sentinel and
      // prints the localized "missing elements" string.
      setErr(parsed.kind === 'parse' ? parsed.message : '__SHAPE__')
      return
    }
    const scene = parsed.scene

    loadExcalidraw()
      .then(async (mod) => {
        try {
          const svgEl = await mod.exportToSvg({
            elements: scene.elements as Parameters<typeof mod.exportToSvg>[0]['elements'],
            appState: {
              ...(scene.appState ?? {}),
              theme: theme === 'dark' ? 'dark' : 'light',
              exportBackground: true,
              exportWithDarkMode: theme === 'dark',
            } as Parameters<typeof mod.exportToSvg>[0]['appState'],
            files: (scene.files ?? null) as Parameters<typeof mod.exportToSvg>[0]['files'],
            exportPadding: 16,
          })
          if (cancelled) return
          // Strip width/height so the SVG scales with our container — the
          // viewBox preserves aspect ratio. Otherwise excalidraw bakes
          // pixel sizes that look tiny inside the wrapper.
          svgEl.removeAttribute('width')
          svgEl.removeAttribute('height')
          svgEl.setAttribute('style', 'max-width:100%;height:auto')
          setSvgMarkup(svgEl.outerHTML)
        } catch (e) {
          if (!cancelled) setErr(String((e as Error).message ?? e))
        }
      })
      .catch((e) => !cancelled && setErr(String(e)))

    return () => {
      cancelled = true
    }
  }, [block.source, theme, t])

  if (err) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {err === '__SHAPE__'
          ? t('block.flow.excalidrawShape')
          : t('block.flow.excalidrawError', { err })}
      </div>
    )
  }
  if (!svgMarkup) {
    return <div className="text-xs text-gray-500 dark:text-gray-400">{t('block.flow.rendering')}</div>
  }
  return (
    <div
      className="group relative overflow-x-auto rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900"
      data-export-root="flow"
      data-flow-engine="excalidraw"
    >
      <WidgetExportMenu formats={['png', 'svg']} filename="flow" />
      <div dangerouslySetInnerHTML={{ __html: svgMarkup }} />
    </div>
  )
}
