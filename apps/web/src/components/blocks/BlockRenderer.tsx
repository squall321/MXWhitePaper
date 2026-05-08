import type { Block } from '@/types/document'
import { ParagraphBlockView } from './ParagraphBlock'
import { Heading4BlockView } from './Heading4Block'
import { ListBlockView } from './ListBlock'
import { QuoteBlockView } from './QuoteBlock'
import { CalloutBlockView } from './CalloutBlock'
import { CodeBlockView } from './CodeBlock'
import { TableBlockView } from './TableBlock'
import { ImageBlockView } from './ImageBlock'
import { VideoBlockView } from './VideoBlock'
import { GalleryBlockView } from './GalleryBlock'
import { PlaceholderBlockView } from './PlaceholderBlock'
import { ChartBlockView } from './ChartBlock'
import { MathBlockView } from './MathBlock'
import { KpiCardsBlockView } from './KpiCardsBlock'
import { FlowBlockView } from './FlowBlock'
import { GanttBlockView } from './GanttBlock'
import { IframeBlockView } from './IframeBlock'
import { FileBlockView } from './FileBlock'
import { DocLinkCardBlockView } from './DocLinkCardBlock'
import { GlossaryRefBlockView } from './GlossaryRefBlock'
import { ColumnsBlockView } from './ColumnsBlock'
import { TabsBlockView } from './TabsBlock'
import { AccordionBlockView } from './AccordionBlock'
import { DataSourceBlockView } from './DataSourceBlock'
import { DashboardEmbedBlockView } from './DashboardEmbedBlock'
import { CalculatorBlockView } from './CalculatorBlock'
import { OrgChartBlockView } from './OrgChartBlock'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { ImageBlockEditor } from '@/features/editor/blocks/ImageBlockEditor'
import { GalleryBlockEditor } from '@/features/editor/blocks/GalleryBlockEditor'
import { ChartBlockEditorWrapper } from '@/features/editor/blocks/ChartBlockEditorWrapper'
import { MathBlockEditorWrapper } from '@/features/editor/blocks/MathBlockEditorWrapper'
import { DataSourceBlockEditor } from '@/features/editor/blocks/DataSourceBlockEditor'
import { DashboardEmbedBlockEditor } from '@/features/editor/blocks/DashboardEmbedBlockEditor'
import { CalculatorBlockEditor } from '@/features/editor/blocks/CalculatorBlockEditor'
import { OrgChartBlockEditor } from '@/features/editor/blocks/OrgChartBlockEditor'
import { FlowBlockEditor } from '@/features/editor/blocks/FlowBlockEditor'
import { KpiCardsBlockEditor } from '@/features/editor/blocks/KpiCardsBlockEditor'
import { BlockBoundary } from './BlockBoundary'

/**
 * BlockRenderer — discriminates on `block.type` and never throws on unknown
 * variants (the schema may grow ahead of the FE).
 *
 * Sprint 6 + Cycle 10 status:
 *   - All 26 SSOT block types now render in read mode.
 *   - Edit mode covers image, gallery, chart, math, data-source,
 *     dashboard-embed, calculator, org-chart. Other types fall back to the
 *     read view inside the full-edit pane (BlockNote handles them).
 *
 * Each block is wrapped in `<BlockBoundary>` so a single bad widget cannot
 * unmount the entire article (Hardening C).
 */
export function BlockRenderer({ block }: { block: Block }) {
  return (
    <BlockBoundary blockType={block?.type}>
      <BlockRendererInner block={block} />
    </BlockBoundary>
  )
}

function BlockRendererInner({ block }: { block: Block }) {
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  const editorSlug = useEditorStore((s) => s.slug)

  // If the block is malformed (no `type`), surface a friendly inline notice
  // instead of throwing on the discriminator.
  if (!block || typeof (block as { type?: unknown }).type !== 'string') {
    return (
      <div className="my-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        이 블록을 표시할 수 없습니다 (type=invalid).
      </div>
    )
  }

  if (isFullEditing && editorSlug) {
    if (block.type === 'image') {
      return <ImageBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'gallery') {
      return <GalleryBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'chart') {
      return <ChartBlockEditorWrapper slug={editorSlug} block={block} />
    }
    if (block.type === 'math') {
      return <MathBlockEditorWrapper slug={editorSlug} block={block} />
    }
    if (block.type === 'data-source') {
      return <DataSourceBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'dashboard-embed') {
      return <DashboardEmbedBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'calculator') {
      return <CalculatorBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'org-chart') {
      return <OrgChartBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'flow') {
      return <FlowBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'kpi-cards') {
      return <KpiCardsBlockEditor slug={editorSlug} block={block} />
    }
  }

  switch (block.type) {
    case 'paragraph':
      return <ParagraphBlockView block={block} />
    case 'heading-4':
      return <Heading4BlockView block={block} />
    case 'list':
      return <ListBlockView block={block} />
    case 'quote':
      return <QuoteBlockView block={block} />
    case 'callout':
      return <CalloutBlockView block={block} />
    case 'code':
      return <CodeBlockView block={block} />
    case 'table':
      return <TableBlockView block={block} />
    case 'image':
      return <ImageBlockView block={block} />
    case 'video':
      return <VideoBlockView block={block} />
    case 'gallery':
      return <GalleryBlockView block={block} />
    case 'chart':
      return <ChartBlockView block={block} />
    case 'math':
      return <MathBlockView block={block} />
    case 'kpi-cards':
      return <KpiCardsBlockView block={block} />
    case 'flow':
      return <FlowBlockView block={block} />
    case 'gantt':
      return <GanttBlockView block={block} />
    case 'iframe':
      return <IframeBlockView block={block} />
    case 'file':
      return <FileBlockView block={block} />
    case 'doc-link-card':
      return <DocLinkCardBlockView block={block} />
    case 'glossary-ref':
      return <GlossaryRefBlockView block={block} />
    case 'columns':
      return <ColumnsBlockView block={block} />
    case 'tabs':
      return <TabsBlockView block={block} />
    case 'accordion':
      return <AccordionBlockView block={block} />
    case 'data-source':
      return <DataSourceBlockView block={block} />
    case 'dashboard-embed':
      return <DashboardEmbedBlockView block={block} />
    case 'calculator':
      return <CalculatorBlockView block={block} />
    case 'org-chart':
      return <OrgChartBlockView block={block} />
    default:
      return (
        <PlaceholderBlockView
          block={block as Block}
          sprint="unknown"
        />
      )
  }
}
