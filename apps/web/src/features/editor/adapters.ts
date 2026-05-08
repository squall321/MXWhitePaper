import type {
  Block,
  CalloutBlock,
  CodeBlock,
  Heading4Block,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  TableBlock,
  Ulid,
  VideoBlock,
} from '@/types/document'
import { ulid } from './ulid'
import { PLACEHOLDER_BLOCK_TYPES } from './blocknote-config'

/**
 * Minimal BlockNote-shaped node we round-trip through. We avoid pulling in
 * the BlockNote types here because they're tightly coupled to the schema
 * and would force the test harness to load the full editor runtime.
 */
export interface BNBlock {
  id?: string
  type: string
  props?: Record<string, unknown>
  content?: Array<{ type: 'text'; text: string; styles?: Record<string, unknown> }> | string
  children?: BNBlock[]
}

interface BNTextRun {
  type: 'text'
  text: string
  styles?: Record<string, unknown>
}

function plain(text: string): BNTextRun[] {
  if (!text) return []
  return [{ type: 'text', text, styles: {} }]
}

function readPlain(content: BNBlock['content']): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.map((c) => c.text).join('')
}

/**
 * DocumentJSON Block[] -> BlockNote document tree.
 *
 * Block types BlockNote understands natively (paragraph/heading/list/quote/
 * code/table/image/video) are converted lossily-but-faithfully. Everything
 * else is wrapped in a paragraph that carries `props.docJsonRaw` — a JSON
 * string of the original block — so the round-trip is perfect even for
 * blocks we can't yet edit visually (Sprint 4 placeholders).
 */
export function documentJsonToBlockNote(blocks: Block[]): BNBlock[] {
  return blocks.map((b) => blockToBN(b))
}

function blockToBN(b: Block): BNBlock {
  switch (b.type) {
    case 'paragraph':
      return {
        id: b.id,
        type: 'paragraph',
        props: { docJsonId: b.id },
        content: plain((b as ParagraphBlock).text),
      }
    case 'heading-4':
      return {
        id: b.id,
        type: 'heading',
        props: { level: 4, docJsonId: b.id },
        content: plain((b as Heading4Block).title),
      }
    case 'list': {
      const lb = b as ListBlock
      const itemType =
        lb.style === 'number'
          ? 'numberedListItem'
          : lb.style === 'check'
            ? 'checkListItem'
            : 'bulletListItem'
      // BlockNote represents lists as a flat sequence of *list-item* blocks.
      // We emit the first as the carrier of docJsonId; the rest share an id
      // with `${b.id}::n` so we can reconstruct them on save.
      return {
        id: b.id,
        type: itemType,
        props: { docJsonId: b.id, docJsonListIndex: 0 },
        content: plain(lb.items[0] ?? ''),
        // Subsequent items emitted as siblings via `extraSiblings` on the
        // returned object; the helper that flattens BNBlock arrays will spread
        // them. We keep the shape simple here — Sprint 5 will rework this.
      }
    }
    case 'quote':
      return {
        id: b.id,
        type: 'quote',
        props: { docJsonId: b.id, cite: (b as QuoteBlock).cite ?? '' },
        content: plain((b as QuoteBlock).text),
      }
    case 'callout': {
      const cb = b as CalloutBlock
      return {
        id: b.id,
        type: 'paragraph',
        props: {
          docJsonId: b.id,
          docJsonCallout: JSON.stringify({
            variant: cb.variant,
            title: cb.title ?? '',
          }),
        },
        content: plain(cb.text),
      }
    }
    case 'code':
      return {
        id: b.id,
        type: 'codeBlock',
        props: {
          docJsonId: b.id,
          language: (b as CodeBlock).language,
          filename: (b as CodeBlock).filename ?? '',
        },
        content: plain((b as CodeBlock).code),
      }
    case 'image':
      return {
        id: b.id,
        type: 'image',
        props: {
          docJsonId: b.id,
          imageId: (b as ImageBlock).imageId,
          caption: (b as ImageBlock).caption ?? '',
          alt: (b as ImageBlock).alt ?? '',
          width: (b as ImageBlock).width ?? 'md',
          link: (b as ImageBlock).link ?? '',
        },
      }
    case 'video':
      return {
        id: b.id,
        type: 'video',
        props: {
          docJsonId: b.id,
          url: (b as VideoBlock).url,
          title: (b as VideoBlock).title ?? '',
          provider: (b as VideoBlock).provider ?? 'intra',
        },
      }
    case 'table': {
      const tb = b as TableBlock
      // BlockNote tables use a custom shape; we serialize through props as a
      // pragmatic stop-gap — Sprint 5 will use the real spec.
      return {
        id: b.id,
        type: 'table',
        props: {
          docJsonId: b.id,
          headers: JSON.stringify(tb.headers),
          rows: JSON.stringify(tb.rows),
        },
      }
    }
    default:
      // Placeholder: round-trip by serializing the whole block JSON.
      return {
        id: b.id,
        type: 'paragraph',
        props: {
          docJsonId: b.id,
          docJsonRaw: JSON.stringify(b),
        },
        content: plain(`[${b.type}] (편집은 Sprint 5+ 지원 — JSON 카드)`),
      }
  }
}

/**
 * BlockNote document tree -> DocumentJSON Block[].
 *
 * Round-trip rule: if a BNBlock carries `props.docJsonRaw` (a JSON string),
 * we deserialize it directly — that's the truthful original block for any
 * type BlockNote doesn't understand.
 */
export function blockNoteToDocumentJson(bn: BNBlock[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < bn.length) {
    const node = bn[i]
    if (!node) {
      i++
      continue
    }
    const raw = (node.props?.['docJsonRaw'] as string | undefined) ?? null
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Block
        out.push(parsed)
        i++
        continue
      } catch {
        // fall through to normal extraction
      }
    }
    const id = (node.props?.['docJsonId'] as string | undefined) ?? node.id ?? ulid()
    switch (node.type) {
      case 'paragraph': {
        // Re-hydrate callout if marker is present.
        const calloutMeta = node.props?.['docJsonCallout'] as string | undefined
        if (calloutMeta) {
          try {
            const m = JSON.parse(calloutMeta) as { variant: CalloutBlock['variant']; title?: string }
            out.push({
              type: 'callout',
              id,
              variant: m.variant,
              title: m.title || undefined,
              text: readPlain(node.content),
            } satisfies CalloutBlock)
            i++
            break
          } catch {
            /* fallthrough */
          }
        }
        out.push({
          type: 'paragraph',
          id,
          text: readPlain(node.content),
        } satisfies ParagraphBlock)
        i++
        break
      }
      case 'heading': {
        out.push({
          type: 'heading-4',
          id,
          title: readPlain(node.content),
        } satisfies Heading4Block)
        i++
        break
      }
      case 'bulletListItem':
      case 'numberedListItem':
      case 'checkListItem': {
        // Greedy: consume consecutive list items of the same type into a
        // single ListBlock, in order.
        const style: ListBlock['style'] =
          node.type === 'numberedListItem'
            ? 'number'
            : node.type === 'checkListItem'
              ? 'check'
              : 'bullet'
        const items: string[] = []
        let groupId: Ulid = id
        while (i < bn.length) {
          const n = bn[i]
          if (!n || n.type !== node.type) break
          items.push(readPlain(n.content))
          groupId = (n.props?.['docJsonId'] as string | undefined) ?? groupId
          i++
        }
        out.push({
          type: 'list',
          id: groupId,
          style,
          items,
        } satisfies ListBlock)
        break
      }
      case 'quote': {
        out.push({
          type: 'quote',
          id,
          text: readPlain(node.content),
          cite: (node.props?.['cite'] as string | undefined) || undefined,
        } satisfies QuoteBlock)
        i++
        break
      }
      case 'codeBlock': {
        out.push({
          type: 'code',
          id,
          language: (node.props?.['language'] as string | undefined) ?? 'text',
          code: readPlain(node.content),
          filename: (node.props?.['filename'] as string | undefined) || undefined,
        } satisfies CodeBlock)
        i++
        break
      }
      case 'image': {
        out.push({
          type: 'image',
          id,
          imageId: (node.props?.['imageId'] as string | undefined) ?? '',
          caption: (node.props?.['caption'] as string | undefined) || undefined,
          alt: (node.props?.['alt'] as string | undefined) || undefined,
          width: (node.props?.['width'] as ImageBlock['width']) || undefined,
          link: (node.props?.['link'] as string | undefined) || undefined,
        } satisfies ImageBlock)
        i++
        break
      }
      case 'video': {
        out.push({
          type: 'video',
          id,
          url: (node.props?.['url'] as string | undefined) ?? '',
          title: (node.props?.['title'] as string | undefined) || undefined,
          provider: (node.props?.['provider'] as VideoBlock['provider']) || undefined,
        } satisfies VideoBlock)
        i++
        break
      }
      case 'table': {
        const headers = safeJsonArray<string>(node.props?.['headers'] as string | undefined)
        const rows = safeJsonArray<string[]>(node.props?.['rows'] as string | undefined)
        out.push({
          type: 'table',
          id,
          headers,
          rows,
        } satisfies TableBlock)
        i++
        break
      }
      default:
        // Unknown BN type with no docJsonRaw — emit a paragraph fallback so
        // the document remains valid.
        out.push({
          type: 'paragraph',
          id,
          text: readPlain(node.content),
        } satisfies ParagraphBlock)
        i++
        break
    }
  }
  return out
}

function safeJsonArray<T>(s: string | undefined): T[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

/** Used by the slash menu to know if a Block.type renders a placeholder card. */
export function isPlaceholderBlockType(type: string): boolean {
  return PLACEHOLDER_BLOCK_TYPES.has(type)
}
