import { useEffect, useRef, useState } from 'react'
import type { ParagraphBlock, Slug, Ulid } from '@/types/document'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'
import { htmlToBlocks } from '../paste/htmlPaste'
import {
  detectLang,
  useSpellcheckPref,
} from '@/features/spellcheck/preferencesStore'
import {
  WikiLinkAutocomplete,
  detectWikiTrigger,
  buildWikiLinkInsertion,
  type WikiLinkHit,
} from './WikiLinkAutocomplete'

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
  /**
   * Browser-native spellcheck on the contentEditable surface. Defaults to
   * `true` and is gated by the user's `mxwp:spellcheck-prefs:v1` preference
   * — passing `false` here forces it off regardless of the global toggle.
   */
  spellCheck?: boolean
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
  spellCheck = true,
}: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const spellPrefEnabled = useSpellcheckPref((s) => s.enabled)
  const spellPrefAutoLang = useSpellcheckPref((s) => s.autoDetectLang)
  // Effective spellcheck — both the prop AND the global pref must allow it.
  const effectiveSpellCheck = spellCheck && spellPrefEnabled
  // Auto-detect lang from current text; when auto-detect is off, fall back
  // to the user's UI language… but UI language is read by the parent so we
  // just pass `undefined` (browser uses its own heuristic).
  const langAttr = spellPrefAutoLang ? detectLang(initialText) : undefined

  const ref = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(initialText.length === 0)
  const dirtyRef = useRef(false)
  const debounceRef = useRef<number | null>(null)

  // ── Wiki-link autocomplete (`[[…` trigger) ─────────────────────────────
  // When the user types `[[` followed by a query inside this editable, we
  // open a floating popup with /search hits. State holds the caret rect
  // (for positioning) and the current query string. `null` = popup closed.
  // The popup forwards keyboard events back through `autocompleteKeyRef`
  // so it can intercept ↑↓/Enter/Tab/Esc before our own onKeyDown runs.
  const [autocomplete, setAutocomplete] = useState<{
    anchor: { left: number; bottom: number }
    query: string
  } | null>(null)
  const autocompleteKeyRef = useRef<((e: KeyboardEvent) => boolean) | null>(null)

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
    // Re-evaluate the wiki-link trigger on every input. Cheap (single
    // textContent walk to the caret) and keeps the popup state in sync with
    // backspace / delete edits inside the bracket span.
    updateWikiTrigger()
  }

  /**
   * Inspect the text before the caret inside this editable. If there's an
   * unclosed `[[` the popup opens (or updates its query). Otherwise the
   * popup closes. Pure DOM read — no network call here, the popup itself
   * debounces the fetch.
   */
  function updateWikiTrigger() {
    const editable = ref.current
    if (!editable) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!editable.contains(range.endContainer)) return
    // Build a range from editable-start to caret, then read its plain text.
    // `cloneRange` keeps the live selection intact.
    const probe = range.cloneRange()
    probe.setStart(editable, 0)
    probe.setEnd(range.endContainer, range.endOffset)
    const textBeforeCaret = probe.toString()
    const trig = detectWikiTrigger(textBeforeCaret)
    if (!trig) {
      if (autocomplete !== null) setAutocomplete(null)
      return
    }
    // Position the popup under the caret. Collapsed ranges have a zero-width
    // bounding rect; that's still enough to pin the popup horizontally.
    const caretRect = range.getBoundingClientRect()
    // Some Chromium builds report `left=0, top=0` when the caret is at the
    // very start of an empty editable — fall back to the editable's box.
    const fallbackRect = editable.getBoundingClientRect()
    const left = caretRect.left || fallbackRect.left
    const bottom = caretRect.bottom || fallbackRect.bottom
    setAutocomplete({ anchor: { left, bottom }, query: trig.query })
  }

  /**
   * Commit a hit from the autocomplete. Replaces the `[[query` typed so far
   * with `[[slug|query]]` (or `[[slug]]` when the query is empty / matches
   * the slug) and places the caret right after the closing brackets.
   *
   * Implemented via the Selection API: we locate the trigger's offset by
   * counting characters in the editable's plain-text view, then expand the
   * range back over those characters and replace via `execCommand`.
   */
  function commitWikiHit(hit: WikiLinkHit) {
    const editable = ref.current
    if (!editable) {
      setAutocomplete(null)
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      setAutocomplete(null)
      return
    }
    const range = sel.getRangeAt(0)
    if (!editable.contains(range.endContainer)) {
      setAutocomplete(null)
      return
    }
    const probe = range.cloneRange()
    probe.setStart(editable, 0)
    probe.setEnd(range.endContainer, range.endOffset)
    const textBeforeCaret = probe.toString()
    const trig = detectWikiTrigger(textBeforeCaret)
    if (!trig) {
      setAutocomplete(null)
      return
    }
    // Extend the selection backwards by (caret - trig.start) chars so the
    // about-to-be-inserted text replaces the literal `[[query` typed so far.
    // `selection.modify` walks across text-node boundaries natively which is
    // exactly what we want — the `[[` and the query might live in sibling
    // spans after `insertText` formatting events.
    const toDelete = textBeforeCaret.length - trig.start
    sel.collapse(range.endContainer, range.endOffset)
    for (let n = 0; n < toDelete; n++) {
      sel.modify('extend', 'backward', 'character')
    }
    const inserted = buildWikiLinkInsertion(hit.slug, trig.query)
    try {
      document.execCommand('insertText', false, inserted)
    } catch {
      // Worst-case fallback — write the text directly via the range.
      const r = sel.getRangeAt(0)
      r.deleteContents()
      r.insertNode(document.createTextNode(inserted))
      r.collapse(false)
    }
    dirtyRef.current = true
    setAutocomplete(null)
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  // Inline-formatting keyboard shortcuts. Browser already handles Ctrl+B/I/U
  // natively on contentEditable; we add Ctrl+E (code) and Ctrl+K (link) and
  // re-fire input so the debounce save kicks in.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Wiki-link autocomplete eats arrows / Enter / Tab / Esc when its popup
    // is open. The handler returns true when it consumed the event so we can
    // stop processing here without disturbing the existing shortcuts below.
    if (autocomplete && autocompleteKeyRef.current) {
      const consumed = autocompleteKeyRef.current(e.nativeEvent)
      if (consumed) return
    }
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

  /**
   * Rich-paste handler for the inline contentEditable surface.
   *
   *  - Single-block parse  → paste inline as plain text (so bold/italic from
   *    Word survives; the browser's native paste does that for us — we just
   *    forward execCommand insertHTML for the inline subset of the source).
   *  - Multi-block parse   → emit `mxwp:paste-multi-blocks` so the parent
   *    `SimpleStackEditor` can insert each block at the section level.
   *
   * Plain text and CSV pastes fall through to the browser default (typing
   * a CSV into a paragraph is unusual; we don't want to surprise users with
   * a table modal mid-sentence).
   */
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData('text/html')
    if (!html) return
    // Skip the parser for trivial single-span Slack-style pastes — they have
    // no block-level tags so htmlToBlocks would emit a single paragraph
    // anyway, and the native paste already preserves inline formatting.
    if (
      !/<(p|h[1-6]|ul|ol|li|table|tr|blockquote|pre|img|figure|hr|div)\b/i.test(
        html,
      )
    ) {
      return
    }
    const { blocks } = htmlToBlocks(html)
    if (blocks.length === 0) return
    if (blocks.length === 1 && blocks[0]!.type === 'paragraph') {
      // Single paragraph — paste inline with markdown-lite collapsed back to
      // HTML so bold / italic survive. Prevent the default to avoid double-
      // pasting the same content.
      e.preventDefault()
      const paste = blocks[0] as ParagraphBlock
      const inlineHtml = mdLiteToHtml(paste.text)
      try {
        document.execCommand('insertHTML', false, inlineHtml)
      } catch {
        document.execCommand('insertText', false, paste.text)
      }
      ref.current?.dispatchEvent(new InputEvent('input', { bubbles: true }))
      return
    }
    // Multi-block — hand off to the parent section editor.
    e.preventDefault()
    const root = ref.current?.closest('[data-simple-stack-editor]') as HTMLElement | null
    const sectionId = root?.getAttribute('data-section-id') ?? null
    if (!sectionId) return
    window.dispatchEvent(
      new CustomEvent('mxwp:paste-multi-blocks', {
        detail: { blocks, sectionId },
      }),
    )
  }

  return (
    <>
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
        spellCheck={effectiveSpellCheck}
        lang={langAttr}
        onInput={onInput}
        onBlur={() => {
          // Defer persist + popup-close so an autocomplete mousedown (which
          // blurs us) can still complete its onClick → commitWikiHit path.
          window.setTimeout(() => {
            void persist()
            // Close the popup unless focus has already moved back into the
            // editable (commitWikiHit refocuses via the input event).
            if (!ref.current?.contains(document.activeElement)) {
              setAutocomplete(null)
            }
          }, 0)
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        data-placeholder={placeholder}
        className={
          (className ?? '') +
          ' outline-none focus:ring-2 focus:ring-smsg-300 focus:ring-offset-2 rounded ' +
          (empty
            ? 'before:content-[attr(data-placeholder)] before:text-gray-400 before:pointer-events-none'
            : '')
        }
      />
      {autocomplete && (
        <WikiLinkAutocomplete
          anchor={autocomplete.anchor}
          query={autocomplete.query}
          excludeSlug={slug}
          onPick={commitWikiHit}
          onClose={() => setAutocomplete(null)}
          onKeyDownRef={autocompleteKeyRef}
        />
      )}
    </>
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
 *   `**bold**`   → <strong>bold</strong>
 *   `~~strike~~` → <s>strike</s>
 *   `` `code` `` → <code>code</code>
 *   `*italic*`   → <em>italic</em>
 *   `[[slug]]`   → kept verbatim (the renderer's WikiLink handles them on
 *                  read; while editing we keep the raw form so the user can
 *                  see what they're typing).
 *
 * Token order: 2-char delimiters first (`**`, `~~`) so `*` and `~` don't
 * accidentally match a single char inside a stronger run. Code (` ` `) is
 * a hard fence — once opened it consumes everything to the next backtick,
 * so `~~` inside `` `…` `` stays literal.
 *
 * Plain text is escaped so no stray `<` becomes a tag mid-edit.
 */
export function mdLiteToHtml(src: string): string {
  if (src.length === 0) return ''
  let out = ''
  let i = 0
  while (i < src.length) {
    // Variable token visual hint — render `{{name}}` (with optional `|fallback`)
    // as a pill so editors immediately recognise it. Note this is a paint-only
    // transform: `htmlToMdLite` walks the DOM and the inner text restores the
    // literal `{{…}}` source on save (no special-case needed in the serializer
    // because the textContent of the span IS the literal).
    if (src.startsWith('{{', i)) {
      const close = src.indexOf('}}', i + 2)
      if (close > i + 2) {
        const body = src.slice(i + 2, close)
        const pipe = body.indexOf('|')
        const name = pipe >= 0 ? body.slice(0, pipe) : body
        if (/^[A-Za-z0-9_-]+$/.test(name)) {
          // Inline style ensures the pill is visible even if Tailwind's JIT
          // didn't pre-extract the class (innerHTML strings aren't scanned).
          out += `<span class="mxwp-var-token" data-mxwp-var="${escapeHtml(name)}" style="background:#dbeafe;border-radius:4px;padding:0 4px;">${escapeHtml(`{{${body}}}`)}</span>`
          i = close + 2
          continue
        }
      }
    }
    if (src.startsWith('**', i)) {
      const close = src.indexOf('**', i + 2)
      if (close > i + 2) {
        out += `<strong>${escapeHtml(src.slice(i + 2, close))}</strong>`
        i = close + 2
        continue
      }
    }
    if (src.startsWith('~~', i)) {
      const close = src.indexOf('~~', i + 2)
      if (close > i + 2) {
        out += `<s>${escapeHtml(src.slice(i + 2, close))}</s>`
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
 *   <s>/<del>/<strike>    → ~~…~~  (also: <span style="text-decoration:
 *                          line-through"> emitted by some browsers'
 *                          execCommand('strikeThrough'))
 *   <a href="X">label</a> → [[X]] when X looks like a wiki slug, else label
 *                          plus an inline `(url)` suffix so the URL is
 *                          preserved (the markdown-lite parser doesn't
 *                          render <a>, but exports/HTML preview can).
 *   <br>, <div>, <p>      → newline (Chrome inserts <div> per Enter)
 *   underline             → stripped (no md-lite syntax). Users can reapply
 *                          via the toolbar; we keep it visual but drop on
 *                          save to stay round-trippable.
 */
export function htmlToMdLite(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  // Replace NBSP (U+00A0) with a regular space. Use the \u escape so
  // no-irregular-whitespace stays happy.
  return walkNodeForMdLite(tmp).replace(/\u00A0/g, ' ').trim()
}

/**
 * Exported for unit tests so they can build a fake-Node tree without needing
 * jsdom/happy-dom. The tree must satisfy the subset of the DOM Node interface
 * used here: `childNodes`, `nodeType`, `textContent`, `tagName`, `getAttribute`.
 */
export function walkNodeForMdLite(node: Node): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? ''
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as HTMLElement
    const tag = el.tagName.toLowerCase()
    const inner = walkNodeForMdLite(el)
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
      case 's':
      case 'del':
      case 'strike':
        out += inner.length ? `~~${inner}~~` : ''
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
        } else if (
          tag === 'span' &&
          /text-decoration(?:-line)?:\s*[^;]*line-through/i.test(
            el.getAttribute('style') ?? '',
          )
        ) {
          // Some Chromium builds emit <span style="text-decoration:line-through">
          // for execCommand('strikeThrough'). Normalize to ~~…~~ on save.
          out += inner.length ? `~~${inner}~~` : ''
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
