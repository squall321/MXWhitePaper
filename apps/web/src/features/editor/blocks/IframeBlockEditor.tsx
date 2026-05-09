import { useEffect, useRef, useState } from 'react'
import type { IframeBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  block: IframeBlock
}

/**
 * IframeBlockEditor — paste a URL, set title + height, see the live sandbox.
 * Saves are debounced 800 ms.
 *
 * The BE enforces the whitelist; we just relay whatever the user types.
 * A small sandbox warning banner reminds the editor that not every domain
 * will render once saved.
 */
export function IframeBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<IframeBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLocal(block)
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
      const result = await patchBlock(
        slug,
        block.id,
        { src: next.src, title: next.title, height: next.height },
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

  const height = local.height ?? 360

  return (
    <div
      data-iframe-block-editor
      data-block-id={block.id}
      className="my-3 space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
    >
      <input
        type="url"
        value={local.src}
        onChange={(e) => schedule({ ...local, src: e.target.value })}
        placeholder={t('editor.iframe.urlPlaceholder')}
        aria-label={t('editor.iframe.urlLabel')}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px]">
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
      </div>
      <p className="text-[11px] text-amber-700">
        {t('editor.iframe.warning')}
      </p>

      {local.src ? (
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
      )}
      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
