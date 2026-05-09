import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QrShare } from '../QrShare'

describe('<QrShare />', () => {
  it('renders the QR panel with the URL embedded in the SVG', () => {
    const html = renderToStaticMarkup(
      <QrShare url="https://example.com/share/abc123" />,
    )
    expect(html).toContain('data-testid="qr-share"')
    expect(html).toContain('https://example.com/share/abc123')
    expect(html).toContain('data-testid="qr-share-download"')
    expect(html).toContain('data-testid="qr-share-bigview"')
    expect(html).toContain('모바일에서 스캔')
  })

  it('shows the unsupported notice for over-long URLs', () => {
    const longUrl = `https://example.com/${'x'.repeat(2050)}`
    const html = renderToStaticMarkup(<QrShare url={longUrl} />)
    expect(html).toContain('data-testid="qr-share-unsupported"')
    expect(html).not.toContain('data-testid="qr-share"')
  })

  it('does not render the big-view modal until the user opens it', () => {
    const html = renderToStaticMarkup(
      <QrShare url="https://example.com/share/x" />,
    )
    expect(html).not.toContain('data-testid="qr-share-big-panel"')
  })
})
