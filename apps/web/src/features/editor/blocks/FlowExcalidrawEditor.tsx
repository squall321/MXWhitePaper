import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useT } from '@/lib/i18n'
import { useResolvedTheme } from '@/features/theme/useResolvedTheme'
import { parseExcalidrawScene, type ExcalidrawScene } from '@/components/blocks/FlowBlock'

/**
 * Sprint-7 — Inline Excalidraw editor for FlowBlock.
 *
 * Mounts the `@excalidraw/excalidraw` canvas component lazily so the
 * ~4 MB lib only loads when the user actually opens an excalidraw block
 * for editing (the read-only viewer already does the same). The canvas
 * is wrapped in a Suspense boundary; while it boots we show a localized
 * loading note.
 *
 * Persistence: Excalidraw fires `onChange` on virtually every pointer
 * tick, so we debounce 800 ms (same as MermaidFlowEditor) before sending
 * a `patchBlock` with the serialised `{elements, appState, files}`
 * scene. Engine stays `excalidraw` (never silently rewritten — that was
 * FLOW-02 in D1).
 *
 * On parse failure: surface a localized warning and start from an empty
 * scene. The server document is not touched until the user actually
 * draws something — so a corrupted source can still be recovered by
 * closing the editor without modifying.
 */

/**
 * Lazy chunk loader for the canvas component. Same `excalidraw` chunk
 * already used by the viewer (see vite.config manualChunks), so Rollup
 * dedupes — the editor doesn't double the bundle. The wrapper component
 * is needed because react-lazy() only accepts default exports.
 */
const ExcalidrawCanvas = lazy(async () => {
  const mod = await import('@excalidraw/excalidraw')
  // Side-effect import — the canvas relies on its CSS being present.
  await import('@excalidraw/excalidraw/index.css')
  return { default: mod.Excalidraw }
})

interface Props {
  slug: Slug
  block: FlowBlock
}

const PERSIST_MS = 800

const EMPTY_SCENE: ExcalidrawScene = { elements: [], appState: {}, files: {} }

/** Exposed for unit tests — see FlowExcalidrawEditor.test.ts. */
export function serialiseScene(scene: ExcalidrawScene): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'mxwp-editor',
    elements: scene.elements,
    appState: scene.appState ?? {},
    files: scene.files ?? {},
  })
}

export function FlowExcalidrawEditor({ slug, block }: Props) {
  const t = useT()
  const theme = useResolvedTheme()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  // Parse the stored source once per `block.source` reference change. If
  // parse fails we surface a recovery banner and start from an empty
  // scene; the parse error message persists until the next successful
  // save (so the user knows what happened).
  const initial = useMemo(() => {
    const parsed = parseExcalidrawScene(block.source)
    if (parsed.ok) return { scene: parsed.scene, parseError: null as string | null }
    return { scene: EMPTY_SCENE, parseError: parsed.message || 'invalid scene' }
  }, [block.source])

  const [scene, setScene] = useState<ExcalidrawScene>(initial.scene)
  const [parseError, setParseError] = useState<string | null>(initial.parseError)
  const [savingAt, setSavingAt] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const persistTimer = useRef<number | null>(null)
  const lastSentRef = useRef<string>('')
  const savedOnceRef = useRef(false)

  // If a different tab edits this block (or a snapshot reload happens)
  // we want to pick up the new source — but only when the user hasn't
  // started editing locally yet. After savedOnce flips true, the editor
  // owns the live scene until unmount.
  useEffect(() => {
    if (savedOnceRef.current) return
    setScene(initial.scene)
    setParseError(initial.parseError)
  }, [initial])

  useEffect(() => {
    return () => {
      if (persistTimer.current != null) window.clearTimeout(persistTimer.current)
    }
  }, [])

  const persist = useCallback(
    async (next: ExcalidrawScene) => {
      if (!etag) return
      const serialised = serialiseScene(next)
      if (serialised === lastSentRef.current) return
      lastSentRef.current = serialised
      setSavingAt(Date.now())
      try {
        const result = await patchBlock(
          slug,
          block.id,
          { ...block, engine: 'excalidraw', source: serialised },
          etag,
          t('editor.flow.changeLog'),
        )
        apply(result.document, result.etag)
        setSavedAt(Date.now())
        setError(null)
        // Once the first patch lands we cleared any parse error too —
        // the new source is whatever the user has on screen.
        setParseError(null)
        savedOnceRef.current = true
      } catch (err) {
        if (isPreconditionFailed(err)) {
          setConflict(null)
          setError(t('editor.common.conflict'))
        } else {
          setError((err as Error).message)
        }
      } finally {
        setSavingAt(null)
      }
    },
    [slug, block, etag, apply, setConflict, t],
  )

  const onCanvasChange = useCallback(
    (elements: readonly unknown[], appState: unknown, files: unknown) => {
      const next: ExcalidrawScene = {
        elements: [...elements],
        appState: (appState ?? {}) as Record<string, unknown>,
        files: files ?? {},
      }
      setScene(next)
      if (persistTimer.current != null) window.clearTimeout(persistTimer.current)
      persistTimer.current = window.setTimeout(() => {
        void persist(next)
      }, PERSIST_MS)
    },
    [persist],
  )

  const onReset = useCallback(() => {
    setScene(EMPTY_SCENE)
    setParseError(null)
    if (persistTimer.current != null) window.clearTimeout(persistTimer.current)
    void persist(EMPTY_SCENE)
  }, [persist])

  const savingText = savingAt
    ? t('editor.flow.excalidrawSaving')
    : savedAt
      ? t('editor.flow.excalidrawSavedAt', {
          time: new Date(savedAt).toLocaleTimeString(),
        })
      : ''

  return (
    <div
      className="space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
      data-flow-block-editor
      data-block-id={block.id}
      data-engine="excalidraw"
    >
      {parseError && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <span>{t('editor.flow.excalidrawParseError')}</span>
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-amber-500 bg-white/80 px-2 py-0.5 text-[11px] font-medium hover:bg-white dark:bg-amber-900/40 dark:hover:bg-amber-900/60"
          >
            {t('editor.flow.excalidrawReset')}
          </button>
        </div>
      )}
      <div
        data-flow-excalidraw-host
        // Min height so the canvas has room; resize-y lets the author
        // grow the area for complex diagrams. The lib reads container
        // size via ResizeObserver so this works without explicit relays.
        className="relative h-[480px] min-h-[320px] resize-y overflow-hidden rounded border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
      >
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-xs text-gray-500 dark:text-gray-400">
              {t('editor.flow.excalidrawLoading')}
            </div>
          }
        >
          <ExcalidrawCanvas
            initialData={{
              elements: (scene.elements ?? []) as never,
              appState: {
                ...(scene.appState as Record<string, unknown>),
                viewBackgroundColor:
                  ((scene.appState as { viewBackgroundColor?: string } | undefined)
                    ?.viewBackgroundColor as string | undefined) ?? '#ffffff',
              } as never,
              files: (scene.files ?? null) as never,
              scrollToContent: true,
            }}
            theme={theme === 'dark' ? 'dark' : 'light'}
            onChange={onCanvasChange}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: true,
                clearCanvas: true,
                export: { saveFileToDisk: false },
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
              },
            }}
          />
        </Suspense>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
        <span data-flow-excalidraw-status aria-live="polite">
          {savingText}
        </span>
        {error && (
          <span role="status" aria-live="polite" className="text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
