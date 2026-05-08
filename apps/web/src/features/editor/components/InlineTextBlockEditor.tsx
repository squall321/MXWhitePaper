import { useEffect, useRef, useState } from 'react'
import type { Slug, Ulid } from '@/types/document'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'

/**
 * InlineTextBlockEditor — contentEditable for text-only blocks
 * (paragraph, heading-4, quote, callout). Saves on blur OR after 800ms idle.
 *
 * Inline formatting: the user can apply bold / italic / code / link via the
 * floating `InlineFormattingToolbar` (or Ctrl+B / Ctrl+I / Ctrl+E / Ctrl+K).
 * The browser's execCommand puts <b><i><code><a> elements into our editable
 * div; on save we round-trip those into the schema's markdown-lite syntax
 * (`**bold**`, `*italic*`, `` `code` ``, `[[slug]]`) so reads + exports keep
 * working with no schema change.
 *
 * Conflict policy: on 412 we just clear the conflict marker — the
 * applyServerSnapshot fix in `state.ts` makes sure `draft` keeps its full
 * shape so the next render isn't a white screen.
 */
interface Props {
  slug: Slug
  blockId: Ulid
  blockType: 'paragraph' | 'heading-4' | 'quote' | 'callout'
  /** Current text from the doc snapshot (markdown-lite). */
  initialText: string
  /** Variant (callout) — preserved on save so we don't accidentally drop it. */
  variant?: 'info' | 'warn' | 'danger' | 'tip'
  /** Heading level (only used when blockType === 'heading-4'). */
  level?: 2 | 3 | 4
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
  level,
  className,
  placeholder = '텍스트를 입력하세요…',
}: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const ref = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(initialText.length === 0)
  const dirtyRef = useRef(false)
  const debounceRef = useRef<number | null>(null)

  // Initial population. We render markdown-lite as actual HTML so the user
  // sees WYSIWYG while editing (e.g. **bold** shows as bold). On save we
  // serialize HTML back to markdown-lite.
  useEffect(() => {
    if (!ref.current) return
    if (dirtyRef.current) return // don't clobber an in-progress edit
    const html = mdLiteToHtml(initialText)
    if (ref.current.innerHTML !== html) {
      ref.current.innerHTML = html
      setEmpty(initialText.length === 0)
    }
  }, [initialText])

  const persist = async () => {
    if (!etag || !dirtyRef.current || !ref.current) return
    const text = htmlToMdLite(ref.current.innerHTML)
    try {
      // Schema quirk: heading-4 stores its text under `title`, every other
      // text block uses `text`. Keep the field name aligned per type.
      const patch =
        blockType === 'callout'
          ? ({ type: 'callout' as const, id: blockId, variant: variant ?? 'info', text } as never)
          : blockType === 'heading-4'
            ? ({
                type: 'heading-4' as const,
                id: blockId,
                title: text,
                ...(level ? { meta: { level } } : {}),
              } as never)
            : blockType === 'quote'
              ? ({ type: 'quote' as const, id: blockId, text } as never)
              : ({ type: 'paragraph' as const, id: blockId, text } as never)
      const result = await patchBlock(slug, blockId, patch, etag, '블록 텍스트 수정')
      apply(result.document, result.etag)
      dirtyRef.current = false
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  const onInput = () => {
    setEmpty((ref.current?.textContent?.length ?? 0) === 0)
    dirtyRef.current = true
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist()
    }, 800)
  }

  // Inline-formatting keyboard shortcuts. Browser already handles Ctrl+B/I/U
  // natively on contentEditable; we add Ctrl+E (code) and Ctrl+K (link) and
  // re-fire input so the debounce save kicks in.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    if (k === 'e') {
      e.preventDefault()
      wrapSelectionTag('code')
      ref.current?.dispatchEvent(new InputEvent('input', { bubbles: true }))
    } else if (k === 'k') {
      e.preventDefault()
      const sel = window.getSelection()?.toString() ?? ''
      const initial = sel.startsWith('http') || sel.startsWith('[[') ? sel : ''
      const url = window.prompt(
        '링크 URL — 외부는 https://… , 위키 내부는 [[slug]] 형식',
        initial,
      )
      if (url) {
        if (url.startsWith('[[') && url.endsWith(']]')) {
          document.execCommand('insertText', false, url)
        } else {
          document.execCommand('createLink', false, url)
        }
        ref.current?.dispatchEvent(new InputEvent('input', { bubbles: true }))
      }
    }
    // Ctrl+B / Ctrl+I / Ctrl+U are already wired by the browser on
    // contentEditable; they fire input events on their own.
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
      onKeyDown={onKeyDown}
      data-placeholder={placeholder}
      className={
        (className ?? '') +
        ' outline-none focus:ring-2 focus:ring-smsg-300 focus:ring-offset-2 rounded ' +
        (empty
          ? 'before:content-[attr(data-placeholder)] before:text-gray-400 before:pointer-events-none'
          : '')
      }
    />
  )
}

/**
 * Wrap the current selection in `<tag>` (used for inline-code since
 * execCommand has no native equivalent). No-op if collapsed.
 */
function wrapSelectionTag(tag: string) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  const el = document.createElement(tag)
  try {
    el.appendChild(range.extractContents())
    range.insertNode(el)
    const after = document.createRange()
    after.setStartAfter(el)
    after.collapse(true)
    sel.removeAllRanges()
    sel.addRange(after)
  } catch {
    /* partial-element selection — ignore */
  }
}

/**
 * Convert markdown-lite text into HTML for display inside the contentEditable.
 *   `**bold**` → <strong>bold</strong>
 *   `*italic*` → <em>italic</em>
 *   `` `code` `` → <code>code</code>
 *   `[[slug]]`   → kept verbatim (the renderer's WikiLink handles them on
 *                  read; while editing we keep the raw form so the user can
 *                  see what they're typing).
 *
 * Plain text is escaped so no stray `<` becomes a tag mid-edit.
 */
export function mdLiteToHtml(src: string): string {
  if (src.length === 0) return ''
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src.startsWith('**', i)) {
      const close = src.indexOf('**', i + 2)
      if (close > i + 2) {
        out += `<strong>${escapeHtml(src.slice(i + 2, close))}</strong>`
        i = close + 2
        continue
      }
    }
    if (src[i] === '`') {
      const close = src.indexOf('`', i + 1)
      if (close > i + 1) {
        out += `<code>${escapeHtml(src.slice(i + 1, close))}</code>`
        i = close + 1
        continue
      }
    }
    if (src[i] === '*' && src[i + 1] !== '*') {
      let close = -1
      for (let j = i + 1; j < src.length; j++) {
        if (src[j] === '*' && src[j + 1] !== '*' && src[j - 1] !== '*') {
          close = j
          break
        }
      }
      if (close > i + 1) {
        out += `<em>${escapeHtml(src.slice(i + 1, close))}</em>`
        i = close + 1
        continue
      }
    }
    out += escapeHtml(src[i] ?? '')
    i++
  }
  return out
}

/**
 * Convert the contentEditable's HTML back into markdown-lite. Walks the DOM
 * tree because regex on innerHTML is fragile (whitespace, attribute order,
 * Chrome's habit of inserting <span style> for execCommand bold).
 *
 * Mapping:
 *   <strong>/<b>          → **…**
 *   <em>/<i>              → *…*
 *   <code>                → `…`
 *   <a href="X">label</a> → [[X]] when X looks like a wiki slug, else label
 *                          plus an inline `(url)` suffix so the URL is
 *                          preserved (the markdown-lite parser doesn't
 *                          render <a>, but exports/HTML preview can).
 *   <br>, <div>, <p>      → newline (Chrome inserts <div> per Enter)
 *   underline / strikethrough → stripped (no md-lite syntax). Users can
 *                          reapply via the toolbar; we keep them visual but
 *                          drop on save to stay round-trippable.
 */
export function htmlToMdLite(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return walk(tmp).replace(/ /g, ' ').trim()
}

function walk(node: Node): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? ''
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as HTMLElement
    const tag = el.tagName.toLowerCase()
    const inner = walk(el)
    switch (tag) {
      case 'strong':
      case 'b':
        out += inner.length ? `**${inner}**` : ''
        break
      case 'em':
      case 'i':
        out += inner.length ? `*${inner}*` : ''
        break
      case 'code':
        out += inner.length ? `\`${inner}\`` : ''
        break
      case 'a': {
        const href = el.getAttribute('href') ?? ''
        if (/^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/.test(href)) {
          // Wiki slug — collapse to [[slug]] (display label is irrelevant).
          out += `[[${href}]]`
        } else if (href.startsWith('[[') && href.endsWith(']]')) {
          out += href
        } else if (href.length > 0) {
          // Plain external link — keep the label; the URL is preserved as a
          // markdown-style suffix the export pipeline can pick up.
          out += `${inner}(${href})`
        } else {
          out += inner
        }
        break
      }
      case 'br':
        out += '\n'
        break
      case 'div':
      case 'p':
        // Chrome wraps each Enter line in <div>; emit a newline before the
        // content unless we're at the very start.
        if (out.length > 0 && !out.endsWith('\n')) out += '\n'
        out += inner
        break
      default:
        // For unknown tags (span style="font-weight:bold" from execCommand)
        // detect inline style hints and fall back to plain text otherwise.
        if (
          tag === 'span' &&
          /font-weight:\s*(bold|[6-9]00)/i.test(el.getAttribute('style') ?? '')
        ) {
          out += `**${inner}**`
        } else if (
          tag === 'span' &&
          /font-style:\s*italic/i.test(el.getAttribute('style') ?? '')
        ) {
          out += `*${inner}*`
        } else {
          out += inner
        }
        break
    }
  }
  return out
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
