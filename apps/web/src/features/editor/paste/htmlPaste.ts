/**
 * htmlPaste — pure HTML → DocumentJSON Block[] parser.
 *
 * Used when the user pastes rich content from Word / Notion / web. We can't
 * lean on the browser's `DOMParser` because the workspace runs vitest with the
 * default `node` environment (no jsdom / happy-dom). So this module ships a
 * minimal, dependency-free HTML tokenizer + tree builder. It's NOT a full
 * spec-compliant parser — just the subset users actually paste:
 *
 *   - Block tags: p, h1..h6, ul, ol, li, table, thead, tbody, tr, th, td,
 *                 blockquote, pre, code, img, br, hr.
 *   - Inline tags: a, strong, b, em, i, s, del, u, code, span.
 *   - Containers: div, section, article, figure, figcaption, header, footer,
 *                 main → recursed into transparently.
 *   - Hostile tags: form, button, script, style, svg, iframe → dropped.
 *
 * Output: an ordered list of DocumentJSON Block objects with fresh ULIDs,
 * plus an array of human-readable warnings (rendered nowhere by default; the
 * caller chooses whether to surface them).
 *
 * Image rehydration: the parser stashes the original `src` URL on the image
 * block at `meta.note = "src:<url>"`. A separate helper (rehydrateImageBlocks
 * in `./imageRehydrate`) pulls those down post-paste.
 */

import { ulid } from '../ulid'
import type {
  Block,
  CodeBlock,
  Heading4Block,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  TableBlock,
} from '@/types/document'

/** Tag names we silently drop along with all descendants. */
const DROP_TAGS = new Set([
  'script',
  'style',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'svg',
  'noscript',
  'meta',
  'link',
  'head',
])

/** Block-level tags we recognise as paragraph-ish containers (transparent). */
const PASSTHROUGH_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'figure',
  'body',
  'html',
  'span',
])

/** Void / self-closing tags. Must not be pushed onto the open-tag stack. */
const VOID_TAGS = new Set([
  'br',
  'hr',
  'img',
  'wbr',
  'meta',
  'link',
  'input',
  'area',
  'base',
  'col',
  'embed',
  'source',
  'track',
])

interface HtmlNode {
  type: 'el' | 'text'
  tag?: string
  attrs?: Record<string, string>
  children: HtmlNode[]
  /** Text content (for type === 'text'). */
  text?: string
}

interface ParseContext {
  warnings: string[]
}

export interface HtmlToBlocksResult {
  blocks: Block[]
  warnings: string[]
}

/**
 * Public entry point.
 *
 * Input: an HTML fragment (pasted from clipboard `text/html`).
 * Output: zero or more DocumentJSON Block[] + accumulated warnings.
 *
 * Pure function — no DOM, no fetch, no ULID counter side effects beyond
 * the ulid() helper itself.
 */
export function htmlToBlocks(html: string): HtmlToBlocksResult {
  const ctx: ParseContext = { warnings: [] }
  const cleaned = preClean(html)
  const root = parseHtml(cleaned, ctx)
  const blocks: Block[] = []
  emitFromChildren(root.children, blocks, ctx)
  return { blocks, warnings: ctx.warnings }
}

/* ── Pre-clean ─────────────────────────────────────────────────────────── */

/**
 * Strip Word's MS-Office gunk + comments + doctype before tokenising.
 * Word likes to dump `<!--StartFragment-->`, `<!--EndFragment-->`,
 * `<o:p>`, conditional comments, and a giant CSS reset in `<style>`. We
 * drop those wholesale.
 */
function preClean(html: string): string {
  let s = html
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<\?xml[\s\S]*?\?>/g, '')
  s = s.replace(/<!doctype[^>]*>/gi, '')
  // `<o:p>` and friends — Word's Office namespace tags.
  s = s.replace(/<\/?o:[a-z][^>]*>/gi, '')
  s = s.replace(/<\/?w:[a-z][^>]*>/gi, '')
  s = s.replace(/<\/?v:[a-z][^>]*>/gi, '')
  return s
}

/* ── Tokenizer + tree builder ──────────────────────────────────────────── */

/**
 * Hand-rolled HTML parser. Pushes opening tags onto a stack, pops on close.
 * Tolerates malformed input by auto-closing the last open tag when a stray
 * close-tag arrives. Drops content of `<script>` / `<style>` / etc.
 */
function parseHtml(src: string, ctx: ParseContext): HtmlNode {
  const root: HtmlNode = { type: 'el', tag: '#root', children: [] }
  const stack: HtmlNode[] = [root]
  let i = 0

  const top = (): HtmlNode => stack[stack.length - 1]!
  const pushText = (txt: string) => {
    if (!txt.length) return
    const parent = top()
    // Inside dropped tags (script/style) the tokenizer skips `<` until the
    // matching close tag, so we won't see content from them here.
    parent.children.push({ type: 'text', children: [], text: txt })
  }

  while (i < src.length) {
    const ch = src[i]
    if (ch === '<') {
      // Comment — already stripped in preClean, but allow stray ones.
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4)
        if (end < 0) break
        i = end + 3
        continue
      }
      // Closing tag.
      if (src[i + 1] === '/') {
        const end = src.indexOf('>', i + 2)
        if (end < 0) break
        const tag = src.slice(i + 2, end).trim().toLowerCase().split(/\s/)[0] ?? ''
        i = end + 1
        // Pop until we find the matching tag (or hit root).
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k]!.tag === tag) {
            stack.length = k
            break
          }
        }
        continue
      }
      // Opening tag.
      const end = findTagEnd(src, i + 1)
      if (end < 0) break
      const raw = src.slice(i + 1, end)
      const { tag, attrs, selfClose } = parseTag(raw)
      i = end + 1
      const lower = tag.toLowerCase()

      // Drop entire subtree for hostile tags.
      if (DROP_TAGS.has(lower)) {
        if (lower === 'svg') {
          ctx.warnings.push('svg dropped')
        }
        if (selfClose || VOID_TAGS.has(lower)) continue
        // Skip until matching close.
        const skipEnd = findCloseTag(src, i, lower)
        if (skipEnd < 0) {
          // No close tag — skip to EOF.
          i = src.length
          continue
        }
        i = skipEnd
        continue
      }

      const node: HtmlNode = {
        type: 'el',
        tag: lower,
        attrs,
        children: [],
      }
      top().children.push(node)
      if (!selfClose && !VOID_TAGS.has(lower)) {
        stack.push(node)
      }
      continue
    }
    // Plain text — accumulate until next `<`.
    const next = src.indexOf('<', i)
    const slice = next < 0 ? src.slice(i) : src.slice(i, next)
    pushText(decodeEntities(slice))
    i = next < 0 ? src.length : next
  }

  return root
}

/**
 * Find the index of the next `>` that's not inside a quoted attribute value.
 * Returns -1 if none.
 */
function findTagEnd(src: string, from: number): number {
  let q: '"' | "'" | null = null
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      continue
    }
    if (c === '>') return i
  }
  return -1
}

/**
 * Find the index AFTER a matching `</tag>`. Used to skip entire subtrees of
 * dropped tags (script/style/svg). Case-insensitive on the tag name.
 */
function findCloseTag(src: string, from: number, tag: string): number {
  const re = new RegExp(`</${tag}\\s*>`, 'i')
  re.lastIndex = from
  // String.prototype.search returns the index — we add the length manually.
  const sub = src.slice(from)
  const m = sub.match(re)
  if (!m || m.index === undefined) return -1
  return from + m.index + m[0].length
}

/**
 * Split `<tagname attr="…" …>` (the inside-the-angle-brackets text) into
 * `{ tag, attrs, selfClose }`. Attribute parsing supports double-quoted,
 * single-quoted, and unquoted values, plus boolean attrs.
 */
function parseTag(raw: string): {
  tag: string
  attrs: Record<string, string>
  selfClose: boolean
} {
  let s = raw.trim()
  let selfClose = false
  if (s.endsWith('/')) {
    selfClose = true
    s = s.slice(0, -1).trim()
  }
  // Tag name = first whitespace-delimited token.
  const nameEnd = s.search(/[\s/>]/)
  const tag = (nameEnd < 0 ? s : s.slice(0, nameEnd)).toLowerCase()
  const rest = nameEnd < 0 ? '' : s.slice(nameEnd)
  const attrs: Record<string, string> = {}
  // Attribute regex: name = value pattern.
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rest))) {
    const name = m[1]?.toLowerCase()
    if (!name) continue
    const value = m[3] ?? m[4] ?? m[5] ?? ''
    attrs[name] = decodeEntities(value)
  }
  return { tag, attrs, selfClose }
}

/* ── Entity decoding ───────────────────────────────────────────────────── */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  bull: '•',
  raquo: '»',
  laquo: '«',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const num = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      if (!Number.isFinite(num) || num < 0) return m
      try {
        return String.fromCodePoint(num)
      } catch {
        return m
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m
  })
}

/* ── Block emission ────────────────────────────────────────────────────── */

/**
 * Walk a list of HTML children, emitting Block[] entries. Recurses into
 * passthrough containers (div / section / article …) so users who paste
 * nested `<div><p>…</p></div>` from Notion still get clean paragraphs.
 */
function emitFromChildren(
  nodes: HtmlNode[],
  out: Block[],
  ctx: ParseContext,
): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      // Top-level text — wrap in a paragraph if it has anything visible.
      const txt = node.text ?? ''
      if (txt.trim().length === 0) continue
      out.push(makeParagraph(txt))
      continue
    }
    emitFromElement(node, out, ctx)
  }
}

function emitFromElement(
  node: HtmlNode,
  out: Block[],
  ctx: ParseContext,
): void {
  const tag = node.tag ?? ''

  // Headings — Word/Notion both emit h1..h6.
  if (/^h[1-6]$/.test(tag)) {
    const depth = parseInt(tag.slice(1), 10)
    // h1/h2 → level 2 (the largest visible heading inside a section);
    // h3 → 3, h4+ → 4. Sections aren't blocks so we never emit a section.
    const level: 2 | 3 | 4 = depth <= 2 ? 2 : depth === 3 ? 3 : 4
    const block: Heading4Block = {
      type: 'heading-4',
      id: ulid(),
      title: inlineTextOf(node),
      meta: { level },
    }
    out.push(block)
    return
  }

  if (tag === 'p') {
    // `<p>` containing only an `<img>` → image block. Notion does this.
    const onlyImg = onlyImageChild(node)
    if (onlyImg) {
      const img = imageFromEl(onlyImg)
      if (img) out.push(img)
      return
    }
    // `<p>` containing only an `<a>` → still a paragraph but with the link
    // converted via inlineTextOf — markdown-lite preserves the URL.
    const text = inlineTextOf(node)
    if (text.length === 0) return
    out.push(makeParagraph(text))
    return
  }

  if (tag === 'ul' || tag === 'ol') {
    const block = listFromEl(node, tag === 'ol' ? 'number' : 'bullet')
    if (block) out.push(block)
    return
  }

  if (tag === 'table') {
    const block = tableFromEl(node)
    if (block) out.push(block)
    return
  }

  if (tag === 'blockquote') {
    const block: QuoteBlock = {
      type: 'quote',
      id: ulid(),
      text: inlineTextOf(node),
    }
    if (block.text.length > 0) out.push(block)
    return
  }

  if (tag === 'pre') {
    const block = codeFromPre(node)
    if (block) out.push(block)
    return
  }

  if (tag === 'img') {
    const block = imageFromEl(node)
    if (block) out.push(block)
    return
  }

  if (tag === 'hr') {
    // Schema has no horizontal-rule block — drop with no warning (it's not
    // meaningful for Word/Notion paste flows).
    return
  }

  if (tag === 'br') {
    // Stray top-level <br> — drop.
    return
  }

  if (tag === 'figure') {
    // `<figure>` may wrap an `<img>` + `<figcaption>`. Try to extract both.
    const img = node.children.find((c) => c.type === 'el' && c.tag === 'img')
    const cap = node.children.find((c) => c.type === 'el' && c.tag === 'figcaption')
    if (img) {
      const block = imageFromEl(img)
      if (block) {
        if (cap) {
          const capText = inlineTextOf(cap)
          if (capText.length > 0) block.caption = capText
        }
        out.push(block)
        return
      }
    }
    // Fallback: figure with no img — recurse into children.
    emitFromChildren(node.children, out, ctx)
    return
  }

  // Pass-through containers — div / section / article / span at top level.
  if (PASSTHROUGH_TAGS.has(tag)) {
    emitFromChildren(node.children, out, ctx)
    return
  }

  // Inline-only tag dropped at the top level (a, strong, em, code, …) →
  // wrap as a paragraph so we don't lose the content.
  const text = inlineTextOf(node)
  if (text.trim().length > 0) {
    out.push(makeParagraph(text))
  }
}

function makeParagraph(text: string): ParagraphBlock {
  return { type: 'paragraph', id: ulid(), text }
}

function onlyImageChild(node: HtmlNode): HtmlNode | null {
  let img: HtmlNode | null = null
  for (const c of node.children) {
    if (c.type === 'text') {
      if ((c.text ?? '').trim().length > 0) return null
      continue
    }
    if (c.tag === 'img') {
      if (img) return null
      img = c
      continue
    }
    return null
  }
  return img
}

/* ── List ──────────────────────────────────────────────────────────────── */

/**
 * Convert `<ul>` / `<ol>` into a `ListBlock`. Nested lists become indent
 * prefixes ("  " per depth) on subsequent items, matching the markdown-lite
 * convention used elsewhere in the editor.
 */
function listFromEl(node: HtmlNode, style: 'bullet' | 'number'): ListBlock | null {
  const items: string[] = []
  collectListItems(node, items, 0)
  if (items.length === 0) return null
  return {
    type: 'list',
    id: ulid(),
    style,
    items,
  }
}

function collectListItems(node: HtmlNode, out: string[], depth: number): void {
  for (const child of node.children) {
    if (child.type !== 'el') continue
    if (child.tag === 'li') {
      // Build the item text from inline children only (skip nested lists).
      const txt = inlineTextOf(child, /* skipLists */ true).trim()
      const prefix = '  '.repeat(depth)
      out.push(prefix + txt)
      // Recurse into nested lists for deeper items.
      for (const sub of child.children) {
        if (sub.type === 'el' && (sub.tag === 'ul' || sub.tag === 'ol')) {
          collectListItems(sub, out, depth + 1)
        }
      }
      continue
    }
    if (child.tag === 'ul' || child.tag === 'ol') {
      // Stray nested list (no parent <li>) — recurse with same depth.
      collectListItems(child, out, depth)
    }
  }
}

/* ── Table ─────────────────────────────────────────────────────────────── */

function tableFromEl(node: HtmlNode): TableBlock | null {
  const rows: string[][] = []
  let headers: string[] | null = null

  // First pass: walk explicit thead / tbody / direct tr's.
  const sections: HtmlNode[] = []
  for (const c of node.children) {
    if (c.type !== 'el') continue
    if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') {
      sections.push(c)
    } else if (c.tag === 'tr') {
      sections.push({ type: 'el', tag: 'tbody', children: [c] })
    }
  }

  for (const sec of sections) {
    const isThead = sec.tag === 'thead'
    for (const tr of sec.children) {
      if (tr.type !== 'el' || tr.tag !== 'tr') continue
      const cells: string[] = []
      let allTh = true
      for (const cell of tr.children) {
        if (cell.type !== 'el') continue
        if (cell.tag !== 'th' && cell.tag !== 'td') continue
        if (cell.tag !== 'th') allTh = false
        cells.push(inlineTextOf(cell).trim())
      }
      if (cells.length === 0) continue
      // Promote a row to the header row when:
      //   - it's inside <thead>, OR
      //   - it's the first row AND every cell is a <th>.
      if (headers === null && (isThead || allTh)) {
        headers = cells
        continue
      }
      rows.push(cells)
    }
  }

  if (!headers && rows.length > 0) {
    // No explicit header — promote the first data row.
    headers = rows.shift()!
  }
  if (!headers) return null
  // Pad rows to match header width.
  const width = headers.length
  const padded = rows.map((r) =>
    r.length === width ? r : r.length < width ? [...r, ...Array(width - r.length).fill('')] : r.slice(0, width),
  )
  return {
    type: 'table',
    id: ulid(),
    headers,
    rows: padded,
  }
}

/* ── Code ──────────────────────────────────────────────────────────────── */

function codeFromPre(node: HtmlNode): CodeBlock | null {
  // Common shape: `<pre><code class="language-ts">…</code></pre>`. Pick up
  // the language from the first `<code>` child; fall back to plain text.
  let lang = ''
  let raw = ''
  const codeEl = node.children.find((c) => c.type === 'el' && c.tag === 'code')
  if (codeEl && codeEl.attrs?.['class']) {
    const m = codeEl.attrs['class'].match(/language-([\w-]+)/)
    if (m) lang = m[1] ?? ''
  }
  raw = textContentRaw(codeEl ?? node)
  // Trim a single leading newline (`<pre>\n…</pre>` is a common Word habit).
  if (raw.startsWith('\n')) raw = raw.slice(1)
  if (raw.endsWith('\n')) raw = raw.slice(0, -1)
  if (raw.length === 0) return null
  return {
    type: 'code',
    id: ulid(),
    language: lang || 'text',
    code: raw,
  }
}

/* ── Image ─────────────────────────────────────────────────────────────── */

function imageFromEl(node: HtmlNode): ImageBlock | null {
  const src = node.attrs?.['src'] ?? ''
  if (!src) return null
  const alt = node.attrs?.['alt'] ?? ''
  const block: ImageBlock = {
    type: 'image',
    id: ulid(),
    imageId: '',
    caption: alt || undefined,
    alt: alt || undefined,
    meta: { note: `src:${src}` },
  }
  return block
}

/* ── Inline → markdown-lite ────────────────────────────────────────────── */

/**
 * Build the markdown-lite text of an element. Recursively walks children,
 * emitting `**…**` / `*…*` / `~~…~~` / `` `…` `` / `[label](url)` /
 * `[[slug]]` for known inline tags. Block tags inside (h1, p, etc.) are
 * flattened as plain text — this function is only used inside table cells,
 * list items, paragraphs, and headings, where the user expects inline-only
 * content.
 */
function inlineTextOf(node: HtmlNode, skipLists = false): string {
  let out = ''
  for (const child of node.children) {
    if (child.type === 'text') {
      out += escapeMdLite(collapseWhitespace(child.text ?? ''))
      continue
    }
    const tag = child.tag ?? ''
    if (skipLists && (tag === 'ul' || tag === 'ol')) continue
    const inner = inlineTextOf(child, skipLists)
    switch (tag) {
      case 'strong':
      case 'b':
        out += inner.length ? `**${inner}**` : ''
        break
      case 'em':
      case 'i':
        out += inner.length ? `*${inner}*` : ''
        break
      case 's':
      case 'del':
      case 'strike':
        out += inner.length ? `~~${inner}~~` : ''
        break
      case 'code':
        out += inner.length ? `\`${inner}\`` : ''
        break
      case 'a': {
        const href = child.attrs?.['href'] ?? ''
        if (!href) {
          out += inner
          break
        }
        // Internal wiki slug pattern (lowercase ASCII / digits / hyphen / Hangul).
        if (/^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/.test(href)) {
          out += `[[${href}]]`
        } else if (href.startsWith('[[') && href.endsWith(']]')) {
          out += href
        } else {
          out += `[${inner || href}](${href})`
        }
        break
      }
      case 'br':
        out += '\n'
        break
      case 'span':
      case 'u':
      case 'sub':
      case 'sup':
      case 'mark':
      case 'small':
      case 'font':
      case 'big':
        // Ignored styling — keep the text.
        out += inner
        break
      default:
        out += inner
    }
  }
  return out
}

/**
 * Collapse runs of whitespace to a single space, matching browser default
 * behaviour for inline content. Preserves leading/trailing space so adjacent
 * inline runs stay readable ("foo **bar**" instead of "foo**bar**").
 */
function collapseWhitespace(s: string): string {
  return s.replace(/[\t\n\r\f ]+/g, ' ')
}

/**
 * Escape characters that have meaning in our markdown-lite syntax so plain
 * text from Word doesn't accidentally turn into bold/italic/code.
 *
 * We escape `*` `~` `` ` `` `[` `]` — the round-trip parser handles `\*` etc.
 */
function escapeMdLite(s: string): string {
  return s.replace(/([*~`\\[\]])/g, '\\$1')
}

/**
 * Raw text content of an element subtree, with NO markdown-lite escaping
 * (used for `<pre><code>` where the code is literal).
 */
function textContentRaw(node: HtmlNode): string {
  let out = ''
  for (const child of node.children) {
    if (child.type === 'text') {
      out += child.text ?? ''
      continue
    }
    if (child.tag === 'br') {
      out += '\n'
      continue
    }
    out += textContentRaw(child)
  }
  return out
}
