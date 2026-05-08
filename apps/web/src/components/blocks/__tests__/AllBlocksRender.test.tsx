/**
 * Golden snapshot test for the read-mode rendering of every Block type
 * declared in DocumentJSON v1.0. This catches subtle regressions where a
 * schema change or a renderer refactor silently breaks one block type.
 *
 * Strategy:
 *   - Build a representative payload for each of the 26 block types.
 *   - Mount via the central <BlockRenderer /> (the same dispatcher used in
 *     production) wrapped in MemoryRouter + QueryClientProvider so the
 *     network-touching renderers (data-source, doc-link-card, image, …)
 *     don't blow up on import.
 *   - Render with renderToStaticMarkup (already used elsewhere in this repo,
 *     no jsdom required) and snapshot the resulting HTML.
 *   - Assert the HTML is non-empty so the boundary's "표시할 수 없습니다"
 *     fallback shape is detected as a regression.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BlockRenderer } from '../BlockRenderer'
import { useEditorStore } from '@/features/editor/state'
import type { Block } from '@/types/document'

/** Make a fresh client per test so no cached query state leaks across blocks. */
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

/** Stable, schema-valid ULID-shaped IDs (Crockford base32, 26 chars). */
const ID = (n: number) => `01TESTBLOCK000000000000${String(n).padStart(3, '0')}`.slice(0, 26)

const BLOCKS: Record<string, Block> = {
  paragraph: { type: 'paragraph', id: ID(1), text: 'Hello, [[onboarding|온보딩]]!' },
  'heading-4': { type: 'heading-4', id: ID(2), title: '소제목', meta: { level: 3 } },
  list: {
    type: 'list',
    id: ID(3),
    style: 'check',
    items: ['첫째', '둘째', '셋째'],
  },
  quote: { type: 'quote', id: ID(4), text: '단순함은 미덕이다.', cite: 'Anon' },
  callout: { type: 'callout', id: ID(5), variant: 'info', title: '안내', text: '검토 필요' },
  code: {
    type: 'code',
    id: ID(6),
    language: 'typescript',
    filename: 'demo.ts',
    code: 'export const x = 1\n',
  },
  math: { type: 'math', id: ID(7), expression: 'a^2 + b^2 = c^2', display: 'block' },
  table: {
    type: 'table',
    id: ID(8),
    headers: ['항목', '값'],
    rows: [
      ['A', '1'],
      ['B', '2'],
    ],
  },
  'kpi-cards': {
    type: 'kpi-cards',
    id: ID(9),
    items: [
      { label: '매출', value: '1.2M', delta: '+3%', trend: 'up' },
      { label: 'NPS', value: 71 },
    ],
  },
  chart: {
    type: 'chart',
    id: ID(10),
    chartType: 'line',
    title: 'Q1',
    data: {
      labels: ['Jan', 'Feb'],
      series: [{ name: 'Revenue', values: [10, 20] }],
    },
  },
  gantt: {
    type: 'gantt',
    id: ID(11),
    tasks: [
      { name: '설계', start: '2026-01-01', end: '2026-01-15', progress: 100 },
      { name: '개발', start: '2026-01-10', end: '2026-02-15', progress: 40 },
    ],
  },
  flow: {
    type: 'flow',
    id: ID(12),
    engine: 'mermaid',
    source: 'graph LR\n  A[Start] --> B[End]',
  },
  'org-chart': {
    type: 'org-chart',
    id: ID(13),
    layout: 'tree',
    root: {
      id: 'r',
      label: 'Root',
      role: 'CEO',
      children: [{ id: 'c1', label: 'Lead', role: 'Lead' }],
    },
  },
  iframe: {
    type: 'iframe',
    id: ID(14),
    src: 'https://docs.example.com/page',
    title: 'docs',
    height: 360,
  },
  video: {
    type: 'video',
    id: ID(15),
    url: 'https://intra.example.com/v.mp4',
    title: '소개 영상',
    provider: 'intra',
  },
  image: {
    type: 'image',
    id: ID(16),
    imageId: '01TESTIMAGE000000000000016',
    caption: '캡션',
    alt: '대체 텍스트',
    width: 'md',
  },
  gallery: {
    type: 'gallery',
    id: ID(17),
    layout: 'grid',
    items: [
      { imageId: '01TESTIMAGE000000000000A01', caption: '1' },
      { imageId: '01TESTIMAGE000000000000A02', caption: '2' },
    ],
  },
  file: {
    type: 'file',
    id: ID(18),
    fileId: '01TESTFILE0000000000000018',
    name: 'sample.pdf',
    size: 1024 * 64,
    mime: 'application/pdf',
  },
  'doc-link-card': {
    type: 'doc-link-card',
    id: ID(19),
    slug: 'kpi-dashboard-guide',
    showSummary: true,
  },
  'glossary-ref': { type: 'glossary-ref', id: ID(20), term: 'ASP' },
  columns: {
    type: 'columns',
    id: ID(21),
    columns: [
      [{ type: 'paragraph', id: ID(101), text: '왼쪽' }],
      [{ type: 'paragraph', id: ID(102), text: '오른쪽' }],
    ],
  },
  tabs: {
    type: 'tabs',
    id: ID(22),
    tabs: [
      { label: '개요', blocks: [{ type: 'paragraph', id: ID(103), text: '탭 1' }] },
      { label: '상세', blocks: [{ type: 'paragraph', id: ID(104), text: '탭 2' }] },
    ],
  },
  accordion: {
    type: 'accordion',
    id: ID(23),
    items: [
      { label: '항목 1', blocks: [{ type: 'paragraph', id: ID(105), text: '본문 1' }] },
      { label: '항목 2', blocks: [{ type: 'paragraph', id: ID(106), text: '본문 2' }] },
    ],
  },
  'data-source': {
    type: 'data-source',
    id: ID(24),
    endpoint: '/api/v1/widgets/kpi/finance-daily',
    params: { period: 'Q1' },
    render: 'kpi-cards',
    refreshInterval: 120,
  },
  'dashboard-embed': {
    type: 'dashboard-embed',
    id: ID(25),
    provider: 'grafana',
    panelId: 'mx-overview',
  },
  calculator: {
    type: 'calculator',
    id: ID(26),
    label: '결과',
    inputs: [
      { name: 'a', label: 'A', kind: 'number', default: 2 },
      { name: 'b', label: 'B', kind: 'number', default: 3 },
    ],
    formula: 'a + b',
  },
}

describe('<BlockRenderer /> read-mode coverage — every block type', () => {
  beforeEach(() => {
    // Force read mode regardless of any prior test that flipped fullEdit.
    useEditorStore.getState().reset()
  })

  // 26 explicit cases — one per SSOT block type.
  for (const [type, block] of Object.entries(BLOCKS)) {
    it(`renders ${type} without throwing and produces non-empty HTML`, () => {
      const html = renderToStaticMarkup(harness(<BlockRenderer block={block} />))
      // Defence: a thrown render that gets caught by BlockBoundary still
      // returns markup, but it contains the visible error string. The
      // boundary path means "I tried to render and crashed" — so we treat
      // its presence as a hard failure for golden coverage.
      expect(html).not.toContain('이 블록을 표시할 수 없습니다')
      expect(html.length).toBeGreaterThan(0)
      // Normalise non-deterministic bits before snapshotting:
      //   - DashboardEmbedBlock stamps wall-clock time (`요청 HH:MM:SS`)
      //   - FlowBlock generates a random mermaid id
      //   - useId-ish strings (recharts, mermaid) — rare but possible
      const stable = html
        // DashboardEmbedBlock — `요청 HH:MM:SS` OR `요청 N시 N분 N초` (locale-dep.)
        .replace(/요청 [^<]+/g, '요청 STABLE')
        // FlowBlock — random mermaid id like `mermaid-abc123`
        .replace(/mermaid-[a-z0-9]+/g, 'mermaid-XXXXXX')
      expect(stable).toMatchSnapshot(type)
    })
  }
})
