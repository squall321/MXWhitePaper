import { useEffect, useRef, useState } from 'react'
import type { Slug, Ulid } from '@/types/document'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'

/**
 * InlineTextBlockEditor — minimal contentEditable for text-only blocks
 * (paragraph, heading-4, quote, callout). Saves on blur OR after 800ms idle.
 *
 * Why not BlockNote? Because the user explicitly rejected the slash-menu
 * UX. This editor is dumb on purpose: type, blur to save. Block-add lives
 * outside this component (`BlockHoverInserter` rails).
 *
 * Conflict policy: on 412 we just clear the conflict marker — the
 * applyServerSnapshot fix in `state.ts` makes sure `draft` keeps its full
 * shape so the next render isn't a white screen.
 */
interface Props {
  slug: Slug
  blockId: Ulid
  blockType: 'paragraph' | 'heading-4' | 'quote' | 'callout'
  /** Current text from the doc snapshot. */
  initialText: string
  /** Variant (callout) — preserved on save so we don't accidentally drop it. */
  variant?: 'info' | 'warn' | 'danger' | 'tip'
  /** Style classes applied to the editable surface. */
  className?: string
  /** Placeholder shown when empty. */
  placeholder?: string
}

export function InlineTextBlockEditor({
  slug,
  blockId,
  blockType,
  initialText,
  variant,
  className,
  placeholder = '텍스트를 입력하세요…',
}: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const ref = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const debounceRef = useRef<number | null>(null)

  // Keep DOM in sync when the snapshot text changes (e.g. another tab).
  // We don't want to clobber an in-progress edit, so only sync when not dirty.
  useEffect(() => {
    if (!dirty && ref.current && ref.current.innerText !== initialText) {
      ref.current.innerText = initialText
      setText(initialText)
    }
  }, [initialText, dirty])

  const persist = async () => {
    if (!etag || !dirty) return
    try {
      // Schema quirk: heading-4 stores its text under `title`, every other
      // text block uses `text`. Keep the field name aligned per type.
      const patch =
        blockType === 'callout'
          ? ({ type: 'callout' as const, id: blockId, variant: variant ?? 'info', text } as never)
          : blockType === 'heading-4'
            ? ({ type: 'heading-4' as const, id: blockId, title: text } as never)
            : blockType === 'quote'
              ? ({ type: 'quote' as const, id: blockId, text } as never)
              : ({ type: 'paragraph' as const, id: blockId, text } as never)
      const result = await patchBlock(slug, blockId, patch, etag, '블록 텍스트 수정')
      apply(result.document, result.etag)
      setDirty(false)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  const onInput = () => {
    const next = ref.current?.innerText ?? ''
    setText(next)
    setDirty(true)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist()
    }, 800)
  }

  return (
    <div
      ref={ref}
      data-inline-text-editor
      data-block-id={blockId}
      data-block-type={blockType}
      role="textbox"
      aria-multiline="true"
      aria-label="블록 텍스트 편집"
      contentEditable
      suppressContentEditableWarning
      onInput={onInput}
      onBlur={() => void persist()}
      data-placeholder={placeholder}
      className={
        (className ?? '') +
        ' outline-none focus:ring-2 focus:ring-smsg-300 focus:ring-offset-2 rounded ' +
        (text.length === 0
          ? 'before:content-[attr(data-placeholder)] before:text-gray-400 before:pointer-events-none'
          : '')
      }
    >
      {initialText}
    </div>
  )
}
