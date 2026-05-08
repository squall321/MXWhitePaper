import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'

/**
 * BlockNote schema configuration.
 *
 * Strategy for Sprint 4:
 *   - Inline rich text inside paragraph / heading-4 / quote / callout / list /
 *     table cell content is delegated to BlockNote's built-in blocks.
 *   - Custom DocumentJSON Block types (chart, gantt, calculator, etc.) are
 *     edited via a placeholder JSON-textarea card rendered by our own
 *     components — they do NOT live inside the BlockNote tree. This keeps the
 *     adapter surface small and avoids fighting BlockNote's serialization for
 *     widgets it doesn't understand.
 *
 * Future sprints will register dedicated custom-block specs here as Sprint 5+
 * adds full editors for chart/gantt/etc. Today the schema mirrors the default
 * set so that BlockNote can edit ParagraphBlock / Heading4Block / ListBlock /
 * QuoteBlock / CalloutBlock / TableBlock / CodeBlock content without us
 * having to write custom specs.
 */
export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    table: defaultBlockSpecs.table,
    codeBlock: defaultBlockSpecs.codeBlock,
    image: defaultBlockSpecs.image,
    video: defaultBlockSpecs.video,
  },
})

/**
 * Mapping between DocumentJSON block.type values and BlockNote block "types".
 * Used by `adapters.ts` to convert each side's representation.
 *
 * Block types absent here are rendered as JSON-card placeholders during edit.
 */
export const docToBlockNoteType: Readonly<Record<string, string>> = {
  paragraph: 'paragraph',
  'heading-4': 'heading',
  list: 'bulletListItem', // refined in adapter based on style
  quote: 'quote',
  callout: 'paragraph', // BlockNote has no native callout — keep as paragraph
  code: 'codeBlock',
  image: 'image',
  video: 'video',
  table: 'table',
}

/**
 * Block.type values that we render as a placeholder JSON-textarea card during
 * edit (Sprint 4). Sprint 5 will replace these with dedicated editors.
 */
export const PLACEHOLDER_BLOCK_TYPES = new Set([
  'chart',
  'gantt',
  'flow',
  'kpi-cards',
  'math',
  'iframe',
  'file',
  'doc-link-card',
  'glossary-ref',
  'columns',
  'tabs',
  'accordion',
  'data-source',
  'dashboard-embed',
  'calculator',
  'org-chart',
  'gallery',
])
