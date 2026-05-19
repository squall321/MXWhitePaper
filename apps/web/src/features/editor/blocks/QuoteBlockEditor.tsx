import { useEffect, useRef, useState } from 'react'
import type { QuoteBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'

/**
 * QuoteBlockEditor — minimal editor for `quote` blocks.
 *
 * The block has two fields: `text` (required body) and `cite` (optional
 * attribution). Prior to pass-2 there was no dedicated editor; users had
 * to edit via the slash menu / json. Follows the SpacerBlockEditor pattern:
 * local state + debounced patchBlock.
 */
interface Props {
  slug: Slug
  block: QuoteBlock
}

const PERSIST_MS = 600

export function QuoteBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [text, setText] = useState<string>(block.text ?? '')
  const [cite, setCite] = useState<string>(block.cite ?? '')
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setText(block.text ?? '')
    setCite(block.cite ?? '')
  }, [block.text, block.cite])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const persist = async (nextText: string, nextCite: string) => {
    if (!etag) return
    try {
      const patch: Partial<QuoteBlock> = { text: nextText }
      // Only include `cite` when non-empty; explicit empty string would
      // round-trip as a visible "— " attribution.
      if (nextCite.trim()) patch.cite = nextCite
      else patch.cite = undefined
      const result = await patchBlock(
        slug,
        block.id,
        patch,
        etag,
        '인용 블록 편집',
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

  const schedule = (nextText: string, nextCite: string) => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(nextText, nextCite)
    }, PERSIST_MS)
  }

  const onTextChange = (value: string) => {
    setText(value)
    schedule(value, cite)
  }

  const onCiteChange = (value: string) => {
    setCite(value)
    schedule(text, value)
  }

  return (
    <div
      data-quote-block-editor
      data-block-id={block.id}
      className="my-2 border-l-4 border-smsg-500 bg-smsg-100/50 p-3"
    >
      <textarea
        aria-label="인용문 본문"
        data-quote-text
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="인용문…"
        rows={2}
        className="w-full resize-y rounded border border-gray-300 bg-white px-2 py-1 text-[15px] italic text-smsg-900"
      />
      <input
        aria-label="출처"
        data-quote-cite
        type="text"
        value={cite}
        onChange={(e) => onCiteChange(e.target.value)}
        placeholder="출처 (선택)"
        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600"
      />
      {error && (
        <p role="status" aria-live="polite" className="mt-1 text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
