import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KeyboardShortcutsModal } from '../components/KeyboardShortcutsModal'

describe('<KeyboardShortcutsModal />', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <KeyboardShortcutsModal open={false} onClose={() => {}} />,
    )
    expect(html).toBe('')
  })

  it('renders the four section groups when open', () => {
    const html = renderToStaticMarkup(
      <KeyboardShortcutsModal open onClose={() => {}} />,
    )
    expect(html).toContain('단축키 안내')
    expect(html).toContain('기본')
    expect(html).toContain('편집')
    expect(html).toContain('텍스트 서식')
    expect(html).toContain('이동')
    // a couple of representative shortcuts
    expect(html).toContain('⌘ S')
    expect(html).toContain('Esc')
    expect(html).toContain('?')
  })
})
