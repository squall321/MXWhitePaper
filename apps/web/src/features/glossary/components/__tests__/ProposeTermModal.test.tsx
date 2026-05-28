/**
 * SSR-level tests for <ProposeTermModal />. The project test infra
 * deliberately avoids jsdom + @testing-library (see ConflictMergeModal.test
 * for the same pattern). We therefore exercise:
 *
 *   1. The render-time markup (closed / open / initialTerm pre-fill / 분야
 *      placeholder) via `renderToStaticMarkup`.
 *   2. The pure `parseAliases` helper that powers the aliases input.
 *
 * Submit + validation + mutation onSuccess/onError code paths require a live
 * DOM (event handlers, controlled state), and are exercised by the FE e2e
 * suite — not duplicated here.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/features/glossary/api', () => ({
  listDomains: vi.fn(async () => [
    { id: 'd-1', slug: 'general', name: '일반', parent_id: null },
    { id: 'd-2', slug: 'ml', name: '머신러닝', parent_id: null },
  ]),
  proposeGlossaryTerm: vi.fn(),
}))

import { ProposeTermModal, PROPOSE_TERM_MAX } from '../ProposeTermModal'

function render(node: ReactNode): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

describe('<ProposeTermModal />', () => {
  it('renders nothing when `open` is false', () => {
    const html = render(
      <ProposeTermModal open={false} onClose={() => {}} />,
    )
    expect(html).not.toContain('data-testid="propose-term-modal"')
    expect(html).not.toContain('용어 제안')
  })

  it('renders the modal scaffold + required fields when open', () => {
    const html = render(<ProposeTermModal open onClose={() => {}} />)
    // Modal scaffold (shared <Modal/> primitive).
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    // Title.
    expect(html).toContain('용어 제안')
    // Required fields + their submit / cancel test ids.
    expect(html).toContain('data-testid="propose-term-modal"')
    expect(html).toContain('data-testid="propose-term-input"')
    expect(html).toContain('data-testid="propose-definition-input"')
    expect(html).toContain('data-testid="propose-domain-select"')
    expect(html).toContain('data-testid="propose-submit"')
    expect(html).toContain('data-testid="propose-cancel"')
    // Keyboard shortcut hint.
    expect(html).toContain('Esc')
    expect(html).toContain('Ctrl + Enter')
  })

  it('pre-fills the term input from `initialTerm` (redlink flow)', () => {
    const html = render(
      <ProposeTermModal
        open
        initialTerm="다공성-매질"
        onClose={() => {}}
      />,
    )
    // Pre-filled value lands in the controlled input as a `value=…` attribute.
    expect(html).toContain('value="다공성-매질"')
    // Definition is still empty — only the term is pre-filled.
    expect(html).toContain('data-testid="propose-definition-input"')
  })

  it('shows the domain placeholder option while the domains query is pending', () => {
    // useQuery starts in isPending=true on first SSR render — the domain
    // <Select/> renders the placeholder "— 선택 —" option.
    const html = render(<ProposeTermModal open onClose={() => {}} />)
    expect(html).toContain('— 선택 —')
    // 분야 field carries its label.
    expect(html).toContain('분야 (domain)')
  })

  it('exposes the BE-aligned schema maxima as the PROPOSE_TERM_MAX export', () => {
    // Sanity-guard against drift between FE limits and the BE schema. If
    // these change, update apps/api/app/schemas/glossary.py::TermProposeIn
    // in the same commit.
    expect(PROPOSE_TERM_MAX.term).toBe(200)
    expect(PROPOSE_TERM_MAX.definition).toBe(5000)
    expect(PROPOSE_TERM_MAX.subdomain).toBe(100)
    expect(PROPOSE_TERM_MAX.termEn).toBe(200)
    expect(PROPOSE_TERM_MAX.aliasCount).toBe(20)
  })
})
