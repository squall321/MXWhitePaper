import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// `useImage` triggers a TanStack Query call. Stub it so the static render
// works without a QueryClientProvider in scope.
vi.mock('@/features/upload/hooks/useImage', () => ({
  useImage: () => ({ data: undefined }),
}))

import {
  decideKeyAction,
  shouldShowAltWarning,
  ImageBlockEditor,
  SAMPLE_IMAGES,
} from '../ImageBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { ImageBlock } from '@/types/document'

const block: ImageBlock = {
  type: 'image',
  id: '01TESTBLOCK00000000000IMG1',
  imageId: '01TESTIMAGE0000000000000ZZ',
  caption: '',
  alt: '',
  width: 'md',
}

describe('decideKeyAction (caption/alt keyboard policy)', () => {
  it('Enter commits', () => {
    expect(decideKeyAction('Enter', 'a', '')).toBe('commit')
  })
  it('Tab commits and moves focus', () => {
    expect(decideKeyAction('Tab', 'a', '')).toBe('commit-and-tab')
  })
  it('Escape reverts', () => {
    expect(decideKeyAction('Escape', 'a', '')).toBe('revert')
  })
  it('letters are no-ops', () => {
    expect(decideKeyAction('a', '', '')).toBe('noop')
  })
})

describe('shouldShowAltWarning', () => {
  it('hides on initial render (savedOnce=false)', () => {
    expect(shouldShowAltWarning('', false)).toBe(false)
  })
  it('shows when alt is empty after first save', () => {
    expect(shouldShowAltWarning('', true)).toBe(true)
    expect(shouldShowAltWarning('   ', true)).toBe(true)
  })
  it('hides once alt has content', () => {
    expect(shouldShowAltWarning('hello', true)).toBe(false)
  })
})

describe('<ImageBlockEditor /> static render', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    // Bind the store so persist() has an etag (we never actually call it
    // in the static render, but guard against accidental network use).
    useEditorStore.setState({
      slug: 'test',
      etag: 'etag-1',
    })
  })

  it('renders a caption input with the placeholder', () => {
    const html = renderToStaticMarkup(
      <ImageBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('placeholder="캡션 입력..."')
    expect(html).toContain('aria-label="이미지 캡션"')
  })

  it('renders the alt input', () => {
    const html = renderToStaticMarkup(
      <ImageBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('aria-label="이미지 alt 텍스트"')
  })

  it('marks the freshly-inserted block for caption auto-focus via the store', () => {
    useEditorStore.getState().setPendingCaptionFocus(block.id)
    expect(useEditorStore.getState().pendingCaptionFocusBlockId).toBe(block.id)
    // The component reads this on mount; we just verify the wiring contract.
    const html = renderToStaticMarkup(
      <ImageBlockEditor slug="test" block={block} />,
    )
    // Static render won't focus, but the input still appears with the same
    // placeholder. (Behavioural focus assertion lives in the e2e suite.)
    expect(html).toContain('placeholder="캡션 입력..."')
  })

  it('does NOT show the alt warning before the first save', () => {
    const html = renderToStaticMarkup(
      <ImageBlockEditor slug="test" block={block} />,
    )
    expect(html).not.toContain('data-alt-warning')
  })
})

describe('SAMPLE_IMAGES gallery', () => {
  it('exports five built-in placeholder images', () => {
    expect(SAMPLE_IMAGES.length).toBe(5)
    for (const s of SAMPLE_IMAGES) {
      expect(s.id.length).toBeGreaterThan(0)
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.src.startsWith('data:image/svg+xml')).toBe(true)
    }
  })
})
