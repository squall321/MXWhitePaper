import { useEffect, useRef, useState } from 'react'
import type { IframeBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'

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
        '임베드 편집',
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('충돌 — 새로고침 필요')
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
        placeholder="임베드 URL (사내 화이트리스트만 표시됩니다)"
        aria-label="임베드 URL"
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px]">
        <input
          type="text"
          value={local.title ?? ''}
          onChange={(e) =>
            schedule({ ...local, title: e.target.value || undefined })
          }
          placeholder="제목 (선택)"
          aria-label="임베드 제목"
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
          placeholder="높이"
          aria-label="높이 (px)"
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        />
      </div>
      <p className="text-[11px] text-amber-700">
        ⚠ 사내 화이트리스트가 아닌 도메인은 저장 후 표시되지 않을 수 있습니다.
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
          URL을 입력하면 미리보기가 나타납니다.
        </div>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
