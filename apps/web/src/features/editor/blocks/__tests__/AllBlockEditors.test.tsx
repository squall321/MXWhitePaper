/**
 * Smoke test for every custom Block editor in features/editor/blocks/.
 *
 * Goal: each editor (chart, code, calculator, container, …) can be mounted
 * with a representative sample block without throwing, and the documented
 * "primary action" surface (e.g. "+ 행 추가", "샘플 데이터", "예시 채우기",
 * variant pickers, …) is present in the rendered markup. Together with the
 * ChartBlockEditor / KpiCardsBlockEditor / etc. unit tests already present,
 * this gives the safety net the design doc asks for.
 *
 * Text-only block types (paragraph, heading-4, list, quote) use the shared
 * InlineTextBlockEditor / ListBlockEditor and are covered separately. They
 * are intentionally NOT included here.
 *
 * No Playwright. No jsdom. We use renderToStaticMarkup — the same SSR-only
 * harness the rest of the editor unit tests use.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEditorStore } from '@/features/editor/state'

import { CalloutVariantPicker } from '../CalloutVariantPicker'
import { ChartBlockEditorWrapper } from '../ChartBlockEditorWrapper'
import { CodeBlockEditor } from '../CodeBlockEditor'
import {
  AccordionBlockEditor,
  ColumnsBlockEditor,
  TabsBlockEditor,
} from '../ContainerBlockEditors'
import { DashboardEmbedBlockEditor } from '../DashboardEmbedBlockEditor'
import { DataSourceBlockEditor } from '../DataSourceBlockEditor'
import { DocLinkCardBlockEditor } from '../DocLinkCardBlockEditor'
import { FileBlockEditor } from '../FileBlockEditor'
import { FlowBlockEditor } from '../FlowBlockEditor'
import { GalleryBlockEditor } from '../GalleryBlockEditor'
import { GanttBlockEditor } from '../GanttBlockEditor'
import { IframeBlockEditor } from '../IframeBlockEditor'
import { ImageBlockEditor } from '../ImageBlockEditor'
import { KpiCardsBlockEditor } from '../KpiCardsBlockEditor'
import { MathBlockEditorWrapper } from '../MathBlockEditorWrapper'
import { OrgChartBlockEditor } from '../OrgChartBlockEditor'
import { TableBlockEditor } from '../TableBlockEditor'
import { VideoBlockEditor } from '../VideoBlockEditor'
import { CalculatorBlockEditor } from '../CalculatorBlockEditor'
import { WhiteboardBlockEditor } from '../WhiteboardBlockEditor'

import type {
  AccordionBlock,
  CalculatorBlock,
  CalloutBlock,
  ChartBlock,
  CodeBlock,
  ColumnsBlock,
  DashboardEmbedBlock,
  DataSourceBlock,
  DocLinkCardBlock,
  FileBlock,
  FlowBlock,
  GalleryBlock,
  GanttBlock,
  IframeBlock,
  ImageBlock,
  KpiCardsBlock,
  MathBlock,
  OrgChartBlock,
  TableBlock,
  TabsBlock,
  VideoBlock,
  WhiteboardBlock,
} from '@/types/document'

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

const ID = (n: number) =>
  `01EDITOREDITOR000000000${String(n).padStart(3, '0')}`.slice(0, 26)

const SLUG = 'demo-doc'

/**
 * Build a deterministic sample block per editor + the human-readable label
 * that should appear in the rendered output. Each entry describes ONE
 * editor's contract.
 */
const CASES: Array<{
  type: string
  label: string
  Editor: (props: any) => JSX.Element
  block: any
  /**
   * A substring (or list of substrings) the rendered HTML must contain. We
   * verify ALL of them — they collectively describe the editor's "primary
   * action / surface" so a regression that strips a button is caught.
   */
  expect: string | string[]
}> = [
  {
    type: 'callout',
    label: 'CalloutVariantPicker',
    Editor: CalloutVariantPicker,
    block: {
      type: 'callout',
      id: ID(1),
      variant: 'info',
      text: '검토 필요',
    } satisfies CalloutBlock,
    expect: ['정보', '경고', '팁', '위험'],
  },
  {
    type: 'chart',
    label: 'ChartBlockEditorWrapper',
    Editor: ChartBlockEditorWrapper,
    block: {
      type: 'chart',
      id: ID(2),
      chartType: 'line',
      title: 'Q1',
      data: { labels: ['A', 'B'], series: [{ name: 'rev', values: [1, 2] }] },
    } satisfies ChartBlock,
    expect: '샘플 데이터',
  },
  {
    type: 'code',
    label: 'CodeBlockEditor',
    Editor: CodeBlockEditor,
    block: {
      type: 'code',
      id: ID(3),
      language: 'typescript',
      filename: 'demo.ts',
      code: 'export const x = 1',
    } satisfies CodeBlock,
    expect: 'aria-label="언어"',
  },
  {
    type: 'tabs',
    label: 'TabsBlockEditor',
    Editor: TabsBlockEditor,
    block: {
      type: 'tabs',
      id: ID(4),
      tabs: [
        { label: '개요', blocks: [] },
        { label: '상세', blocks: [] },
      ],
    } satisfies TabsBlock,
    expect: '개요',
  },
  {
    type: 'accordion',
    label: 'AccordionBlockEditor',
    Editor: AccordionBlockEditor,
    block: {
      type: 'accordion',
      id: ID(5),
      items: [{ label: 'FAQ', blocks: [] }],
    } satisfies AccordionBlock,
    expect: 'FAQ',
  },
  {
    type: 'columns',
    label: 'ColumnsBlockEditor',
    Editor: ColumnsBlockEditor,
    block: {
      type: 'columns',
      id: ID(6),
      columns: [[], []],
    } satisfies ColumnsBlock,
    expect: '컬럼 1',
  },
  {
    type: 'dashboard-embed',
    label: 'DashboardEmbedBlockEditor',
    Editor: DashboardEmbedBlockEditor,
    block: {
      type: 'dashboard-embed',
      id: ID(7),
      provider: 'grafana',
      panelId: 'mx-overview',
    } satisfies DashboardEmbedBlock,
    expect: 'dashboard-uid/panel-id',
  },
  {
    type: 'data-source',
    label: 'DataSourceBlockEditor',
    Editor: DataSourceBlockEditor,
    block: {
      type: 'data-source',
      id: ID(8),
      endpoint: '/api/v1/widgets/kpi/finance-daily',
      render: 'kpi-cards',
    } satisfies DataSourceBlock,
    expect: '/widgets/kpi/finance-daily',
  },
  {
    type: 'doc-link-card',
    label: 'DocLinkCardBlockEditor',
    Editor: DocLinkCardBlockEditor,
    block: {
      type: 'doc-link-card',
      id: ID(9),
      slug: 'kpi-dashboard-guide',
      showSummary: true,
    } satisfies DocLinkCardBlock,
    expect: '문서 검색',
  },
  {
    type: 'file',
    label: 'FileBlockEditor',
    Editor: FileBlockEditor,
    block: {
      type: 'file',
      id: ID(10),
      fileId: '01TESTFILE0000000000000010',
      name: 'sample.pdf',
      size: 1024,
      mime: 'application/pdf',
    } satisfies FileBlock,
    expect: 'sample.pdf',
  },
  {
    type: 'flow',
    label: 'FlowBlockEditor',
    Editor: FlowBlockEditor,
    block: {
      type: 'flow',
      id: ID(11),
      engine: 'mermaid',
      source: 'graph LR\n  A-->B',
    } satisfies FlowBlock,
    expect: 'aria-label="flow source"',
  },
  {
    type: 'gallery',
    label: 'GalleryBlockEditor',
    Editor: GalleryBlockEditor,
    block: {
      type: 'gallery',
      id: ID(12),
      layout: 'grid',
      items: [{ imageId: '01TESTIMAGE000000000000A01', caption: '1' }],
    } satisfies GalleryBlock,
    expect: '이미지 삭제',
  },
  {
    type: 'gantt',
    label: 'GanttBlockEditor',
    Editor: GanttBlockEditor,
    block: {
      type: 'gantt',
      id: ID(13),
      tasks: [
        { name: '설계', start: '2026-01-01', end: '2026-01-15', progress: 50 },
      ],
    } satisfies GanttBlock,
    expect: '+ 작업 추가',
  },
  {
    type: 'iframe',
    label: 'IframeBlockEditor',
    Editor: IframeBlockEditor,
    block: {
      type: 'iframe',
      id: ID(14),
      src: 'https://docs.example.com/page',
      title: 'docs',
      height: 360,
    } satisfies IframeBlock,
    expect: 'docs.example.com/page',
  },
  {
    type: 'image',
    label: 'ImageBlockEditor',
    Editor: ImageBlockEditor,
    block: {
      type: 'image',
      id: ID(15),
      imageId: '01TESTIMAGE000000000000I01',
      caption: '캡션',
      alt: '대체 텍스트',
      width: 'md',
    } satisfies ImageBlock,
    expect: '캡션',
  },
  {
    type: 'kpi-cards',
    label: 'KpiCardsBlockEditor',
    Editor: KpiCardsBlockEditor,
    block: {
      type: 'kpi-cards',
      id: ID(16),
      items: [{ label: '매출', value: 100 }],
    } satisfies KpiCardsBlock,
    expect: '+ KPI 추가',
  },
  {
    type: 'math',
    label: 'MathBlockEditorWrapper',
    Editor: MathBlockEditorWrapper,
    block: {
      type: 'math',
      id: ID(17),
      expression: 'a + b = c',
      display: 'block',
    } satisfies MathBlock,
    expect: 'LaTeX',
  },
  {
    type: 'org-chart',
    label: 'OrgChartBlockEditor',
    Editor: OrgChartBlockEditor,
    block: {
      type: 'org-chart',
      id: ID(18),
      layout: 'tree',
      root: { id: 'r', label: 'Root', children: [] },
    } satisfies OrgChartBlock,
    expect: 'Root',
  },
  {
    type: 'table',
    label: 'TableBlockEditor',
    Editor: TableBlockEditor,
    block: {
      type: 'table',
      id: ID(19),
      headers: ['항목', '값'],
      rows: [['A', '1']],
    } satisfies TableBlock,
    expect: '항목',
  },
  {
    type: 'video',
    label: 'VideoBlockEditor',
    Editor: VideoBlockEditor,
    block: {
      type: 'video',
      id: ID(20),
      url: 'https://youtu.be/dQw4w9WgXcQ',
      title: 'Demo',
      provider: 'youtube',
    } satisfies VideoBlock,
    expect: 'youtube',
  },
  {
    type: 'calculator',
    label: 'CalculatorBlockEditor',
    Editor: CalculatorBlockEditor,
    block: {
      type: 'calculator',
      id: ID(21),
      label: '결과',
      inputs: [
        { name: 'a', label: 'A', kind: 'number', default: 1 },
        { name: 'b', label: 'B', kind: 'number', default: 1 },
      ],
      formula: 'a + b',
    } satisfies CalculatorBlock,
    expect: 'formula',
  },
  {
    type: 'whiteboard',
    label: 'WhiteboardBlockEditor',
    Editor: WhiteboardBlockEditor,
    block: {
      type: 'whiteboard',
      id: ID(22),
      viewbox: { w: 600, h: 400 },
      elements: [],
    } satisfies WhiteboardBlock,
    expect: ['data-whiteboard-canvas', '펜', '지우개'],
  },
]

describe('All custom block editors — smoke', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    // Editors short-circuit network if etag is empty, so they render the
    // form UI without trying to PATCH.
    useEditorStore.setState({ slug: SLUG, etag: 'etag-test' })
  })

  for (const c of CASES) {
    it(`${c.label} renders ${c.type} block + exposes its primary surface`, () => {
      const html = renderToStaticMarkup(
        harness(<c.Editor slug={SLUG} block={c.block} />),
      )
      expect(html.length).toBeGreaterThan(0)
      const expects = Array.isArray(c.expect) ? c.expect : [c.expect]
      for (const needle of expects) {
        expect(html, `${c.label} missing "${needle}"`).toContain(needle)
      }
    })
  }
})
