import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DashboardEmbedBlockEditor } from '../DashboardEmbedBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { DashboardEmbedBlock } from '@/types/document'

const block: DashboardEmbedBlock = {
  type: 'dashboard-embed',
  id: '01TESTBLOCK00000000000DBE1',
  provider: 'grafana',
  panelId: 'demo/panel-1',
  params: { from: 'now-24h' },
}

describe('<DashboardEmbedBlockEditor /> smoke', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
  })

  it('renders provider select + panel id input + params editor', () => {
    const html = renderToStaticMarkup(
      <DashboardEmbedBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('제공자')
    expect(html).toContain('Panel ID')
    expect(html).toContain('파라미터')
    // Existing params row is rendered.
    expect(html).toContain('aria-label="param 0 key"')
    expect(html).toContain('aria-label="param 0 value"')
    // The preview iframe is present (provider is grafana, panelId set).
    expect(html).toContain('<iframe')
  })
})
