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
import { InlineTextBlockEditor } from '@/features/editor/components/InlineTextBlockEditor'
import { ListBlockEditor } from '@/features/editor/components/ListBlockEditor'
import { ImageBlockEditor } from '@/features/editor/blocks/ImageBlockEditor'
import { GalleryBlockEditor } from '@/features/editor/blocks/GalleryBlockEditor'
import { ChartBlockEditorWrapper } from '@/features/editor/blocks/ChartBlockEditorWrapper'
import { MathBlockEditorWrapper } from '@/features/editor/blocks/MathBlockEditorWrapper'
import { DataSourceBlockEditor } from '@/features/editor/blocks/DataSourceBlockEditor'
import { DashboardEmbedBlockEditor } from '@/features/editor/blocks/DashboardEmbedBlockEditor'
import { CalculatorBlockEditor } from '@/features/editor/blocks/CalculatorBlockEditor'
import { OrgChartBlockEditor } from '@/features/editor/blocks/OrgChartBlockEditor'
import { FlowBlockEditor } from '@/features/editor/blocks/FlowBlockEditor'
import { GanttBlockEditor } from '@/features/editor/blocks/GanttBlockEditor'
import { KpiCardsBlockEditor } from '@/features/editor/blocks/KpiCardsBlockEditor'
import { TableBlockEditor } from '@/features/editor/blocks/TableBlockEditor'
import { CodeBlockEditor } from '@/features/editor/blocks/CodeBlockEditor'
import { CalloutVariantPicker } from '@/features/editor/blocks/CalloutVariantPicker'
import { VideoBlockEditor } from '@/features/editor/blocks/VideoBlockEditor'
import { IframeBlockEditor } from '@/features/editor/blocks/IframeBlockEditor'
import { FileBlockEditor } from '@/features/editor/blocks/FileBlockEditor'
import { DocLinkCardBlockEditor } from '@/features/editor/blocks/DocLinkCardBlockEditor'
import {
  AccordionBlockEditor,
  ColumnsBlockEditor,
  TabsBlockEditor,
} from '@/features/editor/blocks/ContainerBlockEditors'
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
    // Text-only blocks: inline contentEditable so users can just click and
    // type without invoking the slash menu.
    if (block.type === 'paragraph') {
      // Page-break sentinel: render the visual marker instead of an editor —
      // the user shouldn't accidentally type into the page-break block.
      if (block.meta?.note === 'page-break-before') {
        return <ParagraphBlockView block={block} />
      }
      return (
        <InlineTextBlockEditor
          slug={editorSlug}
          blockId={block.id}
          blockType="paragraph"
          initialText={block.text}
          className="text-[15px] leading-7 text-smsg-900 min-h-[1.5rem] py-1"
          placeholder="글을 입력하세요…"
        />
      )
    }
    if (block.type === 'heading-4') {
      // Schema-stored level lives in meta.level; default 4 keeps prior docs
      // looking the same.
      const lvl = (block.meta?.level ?? 4) as 2 | 3 | 4
      const cls =
        lvl === 2
          ? 'text-2xl font-semibold text-smsg-900'
          : lvl === 3
            ? 'text-xl font-semibold text-smsg-900'
            : 'text-lg font-semibold text-gray-700'
      return (
        <InlineTextBlockEditor
          slug={editorSlug}
          blockId={block.id}
          blockType="heading-4"
          level={lvl}
          initialText={block.title}
          className={`${cls} min-h-[1.5rem] py-1`}
          placeholder="제목을 입력하세요…"
        />
      )
    }
    if (block.type === 'quote') {
      return (
        <div className="border-l-4 border-smsg-300 pl-3 italic text-gray-700">
          <InlineTextBlockEditor
            slug={editorSlug}
            blockId={block.id}
            blockType="quote"
            initialText={block.text}
            placeholder="인용문…"
          />
        </div>
      )
    }
    if (block.type === 'callout') {
      const variant = block.variant ?? 'info'
      const tone =
        variant === 'warn'
          ? 'border-amber-300 bg-amber-50'
          : variant === 'tip'
            ? 'border-emerald-300 bg-emerald-50'
            : variant === 'danger'
              ? 'border-red-300 bg-red-50'
              : 'border-smsg-300 bg-smsg-50'
      return (
        <div className={`rounded-md border-l-4 px-3 py-2 ${tone}`}>
          <CalloutVariantPicker slug={editorSlug} block={block} />
          <InlineTextBlockEditor
            slug={editorSlug}
            blockId={block.id}
            blockType="callout"
            initialText={block.text}
            variant={variant}
            placeholder="콜아웃 텍스트…"
          />
        </div>
      )
    }
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
    if (block.type === 'gantt') {
      return <GanttBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'kpi-cards') {
      return <KpiCardsBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'table') {
      return <TableBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'code') {
      return <CodeBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'video') {
      return <VideoBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'iframe') {
      return <IframeBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'file') {
      return <FileBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'doc-link-card') {
      return <DocLinkCardBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'tabs') {
      return <TabsBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'accordion') {
      return <AccordionBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'columns') {
      return <ColumnsBlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'list') {
      return <ListBlockEditor slug={editorSlug} block={block} />
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
