import { useEffect, useRef, useState } from 'react'
import type { IframeBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  block: IframeBlock
}

type Mode = 'url' | 'html'

const HTML_MAX = 500_000

/**
 * IframeBlockEditor — pick a mode (URL or inline HTML) and edit accordingly.
 *
 * URL mode  : paste an external URL. The BE host whitelist still applies.
 * HTML mode : paste / drop a self-contained HTML document. Renders via
 *             iframe `srcdoc` with `sandbox="allow-scripts"` so the embed
 *             can run JS but cannot reach the parent DOM, cookies, etc.
 *
 * Saves debounce 800 ms. Only one of `src` / `html` lives on the block at
 * any time — switching modes clears the unused field on save so we don't
 * carry stale data round-trip.
 */
export function IframeBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<IframeBlock>(block)
  const [mode, setMode] = useState<Mode>(block.html ? 'html' : 'url')
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLocal(block)
    if (block.html) setMode('html')
    else if (block.src) setMode('url')
  }, [block])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const schedule = (next: IframeBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: IframeBlock) => {
    if (!etag) return
    try {
      // When switching modes we explicitly null out the other field so
      // the BE merge drops it and the read view picks the right path.
      const patchBody: Record<string, unknown> = {
        title: next.title,
        height: next.height,
      }
      if (mode === 'html') {
        patchBody.html = next.html ?? ''
        patchBody.src = null
      } else {
        patchBody.src = next.src ?? ''
        patchBody.html = null
      }
      const result = await patchBlock(
        slug,
        block.id,
        patchBody as Partial<IframeBlock>,
        etag,
        t('editor.iframe.changeLog'),
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError(t('editor.common.conflict'))
      } else {
        setError((err as Error).message)
      }
    }
  }

  const onPickFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.html') && !file.name.toLowerCase().endsWith('.htm')) {
      setError(t('editor.iframe.fileNotHtml'))
      return
    }
    if (file.size > HTML_MAX) {
      setError(t('editor.iframe.fileTooLarge', { max: HTML_MAX }))
      return
    }
    const text = await file.text()
    schedule({ ...local, html: text })
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    if (next === 'html') {
      schedule({ ...local, src: undefined })
    } else {
      schedule({ ...local, html: undefined })
    }
  }

  const height = local.height ?? 360

  return (
    <div
      data-iframe-block-editor
      data-block-id={block.id}
      className="my-3 space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
    >
      {/* Mode tabs */}
      <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5 text-xs">
        <button
          type="button"
          onClick={() => switchMode('url')}
          aria-pressed={mode === 'url'}
          className={`rounded px-3 py-1 ${
            mode === 'url'
              ? 'bg-smsg-700 text-white'
              : 'text-gray-700 hover:bg-smsg-50'
          }`}
        >
          {t('editor.iframe.modeUrl')}
        </button>
        <button
          type="button"
          onClick={() => switchMode('html')}
          aria-pressed={mode === 'html'}
          className={`rounded px-3 py-1 ${
            mode === 'html'
              ? 'bg-smsg-700 text-white'
              : 'text-gray-700 hover:bg-smsg-50'
          }`}
        >
          {t('editor.iframe.modeHtml')}
        </button>
      </div>

      {mode === 'url' ? (
        <input
          type="url"
          value={local.src ?? ''}
          onChange={(e) => schedule({ ...local, src: e.target.value })}
          placeholder={t('editor.iframe.urlPlaceholder')}
          aria-label={t('editor.iframe.urlLabel')}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        />
      ) : (
        <div className="space-y-1.5">
          <textarea
            value={local.html ?? ''}
            onChange={(e) => schedule({ ...local, html: e.target.value })}
            placeholder={t('editor.iframe.htmlPlaceholder')}
            aria-label={t('editor.iframe.htmlLabel')}
            spellCheck={false}
            rows={10}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 font-mono text-[11px] leading-5 text-gray-800 focus:border-smsg-500 focus:outline-none"
          />
          <div className="flex items-center justify-between text-[11px] text-gray-500">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-dashed border-smsg-300 px-2 py-0.5 text-smsg-700 hover:bg-smsg-100">
              <input
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void onPickFile(f)
                }}
              />
              {t('editor.iframe.uploadFile')}
            </label>
            <span>
              {(local.html?.length ?? 0).toLocaleString()} / {HTML_MAX.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_auto]">
        <input
          type="text"
          value={local.title ?? ''}
          onChange={(e) =>
            schedule({ ...local, title: e.target.value || undefined })
          }
          placeholder={t('editor.iframe.titlePlaceholder')}
          aria-label={t('editor.iframe.titleLabel')}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        />
        <input
          type="number"
          min={120}
          max={1200}
          value={height}
          onChange={(e) =>
            schedule({ ...local, height: Number(e.target.value) || undefined })
          }
          placeholder={t('editor.iframe.heightPlaceholder')}
          aria-label={t('editor.iframe.heightLabel')}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          aria-pressed={showPreview}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-smsg-50"
        >
          {showPreview
            ? t('editor.iframe.hidePreview')
            : t('editor.iframe.showPreview')}
        </button>
      </div>

      <p className="text-[11px] text-amber-700">
        {mode === 'html'
          ? t('editor.iframe.warningHtml')
          : t('editor.iframe.warning')}
      </p>

      {showPreview && mode === 'url' &&
        (local.src ? (
          <iframe
            src={local.src}
            title={local.title ?? 'embed preview'}
            height={height}
            className="w-full rounded border border-gray-200 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-center text-xs text-gray-500">
            {t('editor.iframe.urlHint')}
          </div>
        ))}
      {showPreview && mode === 'html' &&
        (local.html ? (
          <iframe
            srcDoc={local.html}
            title={local.title ?? 'embed preview'}
            height={height}
            className="w-full rounded border border-gray-200 bg-white"
            sandbox="allow-scripts"
          />
        ) : (
          <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-center text-xs text-gray-500">
            {t('editor.iframe.htmlHint')}
          </div>
        ))}
      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
