import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the registry network call.
vi.mock('@/features/search/api', () => ({
  listWidgets: vi.fn(async () => [
    {
      type: 'kpi.finance-daily',
      name: '재무 일일 KPI',
      description: '일별 매출/영업이익 KPI',
      category: 'finance',
    },
    { type: 'sales.weekly', name: '주간 매출' },
  ]),
}))

// Stub the api client used by the read-mode preview.
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: { data: { headers: ['x'], rows: [['1']] } } })),
  },
}))

import { DataSourceBlockEditor } from '../DataSourceBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { DataSourceBlock } from '@/types/document'

const block: DataSourceBlock = {
  type: 'data-source',
  id: '01TESTBLOCK00000000000DS01',
  endpoint: '',
  render: 'table',
  refreshInterval: 60,
}

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>
}

describe('<DataSourceBlockEditor />', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
  })

  it('renders the registry select with Korean labels', () => {
    const html = renderToStaticMarkup(
      withProviders(<DataSourceBlockEditor slug="test" block={block} />),
    )
    expect(html).toContain('위젯 선택…')
    expect(html).toContain('렌더 모드')
    // Refresh slider hint.
    expect(html).toContain('갱신 주기')
    // Render mode options.
    expect(html).toContain('표')
    expect(html).toContain('차트')
    expect(html).toContain('KPI 카드')
  })

  it('renders the live preview using the current endpoint state', () => {
    const html = renderToStaticMarkup(
      withProviders(
        <DataSourceBlockEditor
          slug="test"
          block={{ ...block, endpoint: '/widgets/kpi/finance-daily' }}
        />,
      ),
    )
    // Editor surfaces the endpoint as an editable input, the preview shows it
    // again as a code badge in the read-mode card.
    expect(html).toContain('/widgets/kpi/finance-daily')
  })
})
