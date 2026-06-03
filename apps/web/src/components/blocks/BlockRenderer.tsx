import { Suspense, lazy, type ReactNode } from 'react'
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
import { WhiteboardBlockView } from './WhiteboardBlock'
import { FormBlockView } from './FormBlock'
import { PdfBlockView } from './PdfBlock'
import { QuizBlockView } from './QuizBlock'
import { ImageAnnotationBlockView } from './ImageAnnotationBlock'
import { SpreadsheetBlockView } from './SpreadsheetBlock'
import { BibliographyBlockView } from './BibliographyBlock'
import { FigureIndexBlockView } from './FigureIndexBlock'
import { PivotTableBlockView } from './PivotTableBlock'
import { SlicerBlockView } from './SlicerBlock'
import { TimelineBlockView } from './TimelineBlock'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { InlineTextBlockEditor } from '@/features/editor/components/InlineTextBlockEditor'
import { ListBlockEditor } from '@/features/editor/components/ListBlockEditor'
// ImageBlockEditor stays eager — it's the most-frequently-used editor branch
// (every figure block hits it) and lazy-loading on every paint flashes the
// fallback. The heavier editors below are split off behind React.lazy so they
// only ship when a user actually opens that block in edit mode.
import { ImageBlockEditor } from '@/features/editor/blocks/ImageBlockEditor'
import { CalloutVariantPicker } from '@/features/editor/blocks/CalloutVariantPicker'
import { VideoBlockEditor } from '@/features/editor/blocks/VideoBlockEditor'
import { IframeBlockEditor } from '@/features/editor/blocks/IframeBlockEditor'
import { FileBlockEditor } from '@/features/editor/blocks/FileBlockEditor'
import { DocLinkCardBlockEditor } from '@/features/editor/blocks/DocLinkCardBlockEditor'
import { TableBlockEditor } from '@/features/editor/blocks/TableBlockEditor'
import { CodeBlockEditor } from '@/features/editor/blocks/CodeBlockEditor'
import { SpacerBlockEditor } from '@/features/editor/blocks/SpacerBlockEditor'
import { Heading4BlockEditor } from '@/features/editor/blocks/Heading4BlockEditor'
import { QuoteBlockEditor } from '@/features/editor/blocks/QuoteBlockEditor'
import {
  AccordionBlockEditor,
  ColumnsBlockEditor,
  TabsBlockEditor,
} from '@/features/editor/blocks/ContainerBlockEditors'
import { BlockBoundary } from './BlockBoundary'
import { BlockCollapseWrapper } from '@/features/editor/components/BlockCollapseWrapper'
import { COLLAPSIBLE_BLOCK_TYPES } from '@/features/editor/components/BlockResizeWrapper'
import { RestrictedBlockPlaceholder } from './RestrictedBlockPlaceholder'
import { LockBadge } from '@/features/editor/components/LockBadge'
import { ReactionBar } from '@/features/reactions/ReactionBar'
import { useAuthStore } from '@/features/auth/store'

/**
 * Returns true when `userRole` may see a block whose `meta.permission` is
 * the given level. Mirrors the BE matrix in document_service.scrub_blocks.
 *
 *   permission='admin'    → only role 'admin'
 *   permission='editor'   → 'editor' | 'owner' | 'admin'
 *   permission='all'/none → everyone (including 'reader')
 *
 * Unknown roles are treated as readers (most-restrictive default).
 */
export function canSeeBlock(
  block: { meta?: { permission?: 'all' | 'editor' | 'admin' } } | null | undefined,
  userRole: string | null | undefined,
): boolean {
  const required = block?.meta?.permission
  if (!required || required === 'all') return true
  const role = (userRole ?? '').toLowerCase()
  if (required === 'admin') return role === 'admin'
  // required === 'editor'
  return role === 'editor' || role === 'owner' || role === 'admin'
}

// Lazy-loaded heavy block editors. Each chunk is named so the manualChunks
// rules in vite.config.ts can land them in dedicated bundles.
const GalleryBlockEditor = lazy(() =>
  import('@/features/editor/blocks/GalleryBlockEditor').then((m) => ({ default: m.GalleryBlockEditor })),
)
const ChartBlockEditorWrapper = lazy(() =>
  import('@/features/editor/blocks/ChartBlockEditorWrapper').then((m) => ({ default: m.ChartBlockEditorWrapper })),
)
const MathBlockEditorWrapper = lazy(() =>
  import('@/features/editor/blocks/MathBlockEditorWrapper').then((m) => ({ default: m.MathBlockEditorWrapper })),
)
const DataSourceBlockEditor = lazy(() =>
  import('@/features/editor/blocks/DataSourceBlockEditor').then((m) => ({ default: m.DataSourceBlockEditor })),
)
const DashboardEmbedBlockEditor = lazy(() =>
  import('@/features/editor/blocks/DashboardEmbedBlockEditor').then((m) => ({ default: m.DashboardEmbedBlockEditor })),
)
const CalculatorBlockEditor = lazy(() =>
  import('@/features/editor/blocks/CalculatorBlockEditor').then((m) => ({ default: m.CalculatorBlockEditor })),
)
const OrgChartBlockEditor = lazy(() =>
  import('@/features/editor/blocks/OrgChartBlockEditor').then((m) => ({ default: m.OrgChartBlockEditor })),
)
const WhiteboardBlockEditor = lazy(() =>
  import('@/features/editor/blocks/WhiteboardBlockEditor').then((m) => ({ default: m.WhiteboardBlockEditor })),
)
const FormBlockEditor = lazy(() =>
  import('@/features/editor/blocks/FormBlockEditor').then((m) => ({ default: m.FormBlockEditor })),
)
const FlowBlockEditor = lazy(() =>
  import('@/features/editor/blocks/FlowBlockEditor').then((m) => ({ default: m.FlowBlockEditor })),
)
const SlicerBlockEditor = lazy(() =>
  import('@/features/editor/blocks/SlicerBlockEditor').then((m) => ({ default: m.SlicerBlockEditor })),
)
const TimelineBlockEditor = lazy(() =>
  import('@/features/editor/blocks/TimelineBlockEditor').then((m) => ({ default: m.TimelineBlockEditor })),
)
const GanttBlockEditor = lazy(() =>
  import('@/features/editor/blocks/GanttBlockEditor').then((m) => ({ default: m.GanttBlockEditor })),
)
const KpiCardsBlockEditor = lazy(() =>
  import('@/features/editor/blocks/KpiCardsBlockEditor').then((m) => ({ default: m.KpiCardsBlockEditor })),
)
const FigureIndexBlockEditor = lazy(() =>
  import('@/features/editor/blocks/FigureIndexBlockEditor').then((m) => ({ default: m.FigureIndexBlockEditor })),
)
const PdfBlockEditor = lazy(() =>
  import('@/features/editor/blocks/PdfBlockEditor').then((m) => ({ default: m.PdfBlockEditor })),
)
const ImageAnnotationBlockEditor = lazy(() =>
  import('@/features/editor/blocks/ImageAnnotationBlockEditor').then((m) => ({
    default: m.ImageAnnotationBlockEditor,
  })),
)
const QuizBlockEditor = lazy(() =>
  import('@/features/editor/blocks/QuizBlockEditor').then((m) => ({ default: m.QuizBlockEditor })),
)
const SpreadsheetBlockEditor = lazy(() =>
  import('@/features/editor/blocks/SpreadsheetBlockEditor').then((m) => ({
    default: m.SpreadsheetBlockEditor,
  })),
)
const BibliographyBlockEditor = lazy(() =>
  import('@/features/editor/blocks/BibliographyBlockEditor').then((m) => ({
    default: m.BibliographyBlockEditor,
  })),
)

/** Tiny placeholder shown while a lazy block-editor chunk is fetched. */
function BlockEditorSkeleton() {
  return (
    <div
      className="my-2 h-24 w-full animate-pulse rounded border border-gray-200 bg-gray-50"
      aria-hidden="true"
    />
  )
}

/** Wrap a lazy block-editor in <Suspense> so the parent never sees a thrown
 *  promise. Keeps BlockRenderer's dispatch logic readable. */
function lazyEditor(node: ReactNode): ReactNode {
  return <Suspense fallback={<BlockEditorSkeleton />}>{node}</Suspense>
}

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
  // Block-level visibility gate (Cycle: block permissions). The BE already
  // scrubs forbidden blocks for non-admin readers — this is the FE belt to
  // BE braces, and also covers the editor-mode case where the doc was
  // fetched as admin but the block requires admin to view.
  // Subscribe so the gate re-renders on logout/role change. Fall back to
  // `getState()` because the React SSR path used by some renderers may
  // return the initial server snapshot (user=null) even after the test or
  // app has set a user — using the live snapshot keeps the matrix correct
  // in both server and client renders.
  const subscribed = useAuthStore((s) => s.user?.role ?? null)
  const userRole = subscribed ?? useAuthStore.getState().user?.role ?? null
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  if (!canSeeBlock(block, userRole)) {
    return <RestrictedBlockPlaceholder required={block?.meta?.permission === 'admin' ? 'admin' : 'editor'} />
  }

  // For "tall" blocks (chart/table/code/gallery/gantt/flow/kpi-cards/
  // calculator/dashboard-embed/math/org-chart) we wrap with a small "접기"
  // toggle. Read mode → local state; edit mode → meta.collapsed via patchBlock.
  // Other types (paragraph, callout, container blocks, etc.) pass through.
  const wrapWithCollapse = block && typeof block.type === 'string' && COLLAPSIBLE_BLOCK_TYPES.has(block.type)
  const inner = (
    <BlockBoundary blockType={block?.type}>
      {isFullEditing && <LockBadgeWithSlug block={block} />}
      <BlockRendererInner block={block} />
      {/* Cycle 0021 — block-level reactions. Sibling overlay (does not touch
          BlockHoverInserter). Hidden in editing mode to avoid clashing with
          the slash menu / hover rails. */}
      {!isFullEditing && <BlockReactionsOverlay block={block} />}
    </BlockBoundary>
  )
  if (!wrapWithCollapse) return inner
  return (
    <BlockCollapseWrapperWithSlug block={block}>
      {inner}
    </BlockCollapseWrapperWithSlug>
  )
}

/** Cycle 0021 — sibling overlay that mounts a compact ReactionBar on each
 *  block. Hidden when no slug is available (e.g. inside templates / preview
 *  surfaces) and when the block has no stable id. `collapseEmpty` keeps the
 *  visual surface area near zero until somebody actually reacts. */
function BlockReactionsOverlay({ block }: { block: Block }) {
  const editorSlug = useEditorStore((s) => s.slug)
  if (!editorSlug) return null
  if (!block || typeof (block as { id?: unknown }).id !== 'string') return null
  return (
    <div className="mt-1.5">
      <ReactionBar
        slug={editorSlug}
        blockId={(block as { id: string }).id}
        variant="compact"
        collapseEmpty
      />
    </div>
  )
}

/** Adapter so LockBadge can read `slug` from the editor store. */
function LockBadgeWithSlug({ block }: { block: Block }) {
  const editorSlug = useEditorStore((s) => s.slug)
  if (!editorSlug || !block || typeof (block as { id?: unknown }).id !== 'string') return null
  return <LockBadge slug={editorSlug} block={block} />
}

/**
 * Tiny adapter so the wrapper can read `slug` from the editor store without
 * forcing every BlockRenderer caller to plumb it through.
 */
function BlockCollapseWrapperWithSlug({
  block,
  children,
}: {
  block: Block
  children: ReactNode
}) {
  const editorSlug = useEditorStore((s) => s.slug)
  return (
    <BlockCollapseWrapper block={block} slug={editorSlug ?? undefined}>
      {children}
    </BlockCollapseWrapper>
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
      return <Heading4BlockEditor slug={editorSlug} block={block} />
    }
    if (block.type === 'quote') {
      return <QuoteBlockEditor slug={editorSlug} block={block} />
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
      return lazyEditor(<GalleryBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'chart') {
      return lazyEditor(<ChartBlockEditorWrapper slug={editorSlug} block={block} />)
    }
    if (block.type === 'math') {
      return lazyEditor(<MathBlockEditorWrapper slug={editorSlug} block={block} />)
    }
    if (block.type === 'data-source') {
      return lazyEditor(<DataSourceBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'dashboard-embed') {
      return lazyEditor(<DashboardEmbedBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'calculator') {
      return lazyEditor(<CalculatorBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'org-chart') {
      return lazyEditor(<OrgChartBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'whiteboard') {
      return lazyEditor(<WhiteboardBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'form') {
      return lazyEditor(<FormBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'quiz') {
      return lazyEditor(<QuizBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'flow') {
      return lazyEditor(<FlowBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'slicer') {
      return lazyEditor(<SlicerBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'timeline') {
      return lazyEditor(<TimelineBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'gantt') {
      return lazyEditor(<GanttBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'kpi-cards') {
      return lazyEditor(<KpiCardsBlockEditor slug={editorSlug} block={block} />)
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
    if (block.type === 'pdf') {
      return lazyEditor(<PdfBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'image-annotation') {
      return lazyEditor(<ImageAnnotationBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'spreadsheet') {
      return lazyEditor(<SpreadsheetBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'bibliography') {
      return lazyEditor(<BibliographyBlockEditor slug={editorSlug} block={block} />)
    }
    if (block.type === 'figure-index') {
      return lazyEditor(<FigureIndexBlockEditor slug={editorSlug} block={block} />)
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
    if (block.type === 'spacer') {
      return <SpacerBlockEditor slug={editorSlug} block={block} />
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
    case 'table': {
      const cap = (block as { caption?: string }).caption
      if (!cap) return <TableBlockView block={block} />
      // Wrap in <figure> so CSS counters fire and the caption gets
      // "표 N:" prefix consistently with images/charts.
      return (
        <figure data-block-type="table" data-has-caption="true" className="my-2">
          <TableBlockView block={block} />
          <figcaption className="mt-1 text-center text-xs text-gray-500">
            <span className="figure-caption-text">{cap}</span>
          </figcaption>
        </figure>
      )
    }
    case 'image':
      return <ImageBlockView block={block} />
    case 'video':
      return <VideoBlockView block={block} />
    case 'gallery':
      return <GalleryBlockView block={block} />
    case 'chart': {
      const t = (block as { title?: string }).title
      if (!t) return <ChartBlockView block={block} />
      return (
        <figure data-block-type="chart" data-has-caption="true" className="my-2">
          <ChartBlockView block={block} />
          <figcaption className="mt-1 text-center text-xs text-gray-500">
            <span className="figure-caption-text">{t}</span>
          </figcaption>
        </figure>
      )
    }
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
    case 'whiteboard':
      return <WhiteboardBlockView block={block} />
    case 'form':
      return <FormBlockView block={block} />
    case 'pdf':
      return <PdfBlockView block={block} />
    case 'quiz':
      return <QuizBlockView block={block} />
    case 'image-annotation':
      return <ImageAnnotationBlockView block={block} />
    case 'spreadsheet':
      return <SpreadsheetBlockView block={block} />
    case 'bibliography':
      return <BibliographyBlockView block={block} />
    case 'figure-index':
      return <FigureIndexBlockView block={block as { title?: string; kinds?: ('image' | 'table' | 'chart')[]; options?: { stripe?: boolean } }} />
    case 'pivot-table':
      return <PivotTableBlockView block={block} />
    case 'slicer':
      return <SlicerBlockView block={block} />
    case 'timeline':
      return <TimelineBlockView block={block} />
    case 'spacer': {
      // Deliberate vertical breathing room. Defaults are tight in
      // SectionLayout (space-y-2 = 8px); spacer block adds 16/32/64/128px
      // on top depending on size.
      const size = (block as { size?: 'sm' | 'md' | 'lg' | 'xl' }).size ?? 'md'
      const h =
        size === 'sm' ? 'h-4'
        : size === 'lg' ? 'h-16'
        : size === 'xl' ? 'h-32'
        : 'h-8'
      return <div aria-hidden="true" className={h} data-block-type="spacer" />
    }
    default:
      return (
        <PlaceholderBlockView
          block={block as Block}
          sprint="unknown"
        />
      )
  }
}
