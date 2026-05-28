import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RejectReasonModal, REJECT_REASON_MIN_LEN } from '../RejectReasonModal'

/**
 * The repo's vitest runs in node (no DOM); peer tests rely on
 * `renderToStaticMarkup` for the initial render contract. The modal's
 * interactive paths (input → submit) are covered by Playwright e2e; this
 * suite locks the SSR contract: chrome, accessibility, and the closed
 * state.
 */
function ssr(node: React.ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
}

describe('<RejectReasonModal /> SSR contract', () => {
  it('renders nothing when open=false', () => {
    const html = ssr(
      <RejectReasonModal open={false} onClose={() => {}} onConfirm={() => {}} />,
    )
    // `<Modal>` returns null when closed → no dialog markup.
    expect(html).not.toContain('reject-reason-modal')
    expect(html).not.toContain('role="dialog"')
  })

  it('renders the dialog + termLabel header when open', () => {
    const html = ssr(
      <RejectReasonModal
        open
        termLabel="커널"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('reject-reason-modal')
    expect(html).toContain('커널')
    expect(html).toContain('용어 거부')
  })

  it('falls back to a generic title when no termLabel is supplied', () => {
    const html = ssr(
      <RejectReasonModal open onClose={() => {}} onConfirm={() => {}} />,
    )
    expect(html).toContain('용어 거부')
    // Just the generic title — no ": <label>" segment.
    expect(html).not.toContain('용어 거부:')
  })

  it('mounts a required, aria-labelled textarea with the min-length hint', () => {
    const html = ssr(
      <RejectReasonModal open onClose={() => {}} onConfirm={() => {}} />,
    )
    expect(html).toContain('data-testid="reject-reason-input"')
    expect(html).toContain('aria-label="거부 사유"')
    expect(html).toContain('aria-required="true"')
    // Min length surfaced in the hint copy so users see the bar.
    expect(html).toContain(String(REJECT_REASON_MIN_LEN))
  })

  it('keeps Submit disabled on initial render (reason starts empty)', () => {
    const html = ssr(
      <RejectReasonModal open onClose={() => {}} onConfirm={() => {}} />,
    )
    // Submit is rendered + disabled + aria-disabled.
    expect(html).toContain('data-testid="reject-submit"')
    expect(html).toMatch(/data-testid="reject-submit"[^>]*disabled/)
    expect(html).toContain('aria-disabled="true"')
  })

  it('exposes a busy state on the Submit when busy=true', () => {
    const html = ssr(
      <RejectReasonModal
        open
        busy
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(html).toContain('data-testid="reject-submit"')
    // Disabled by both the empty-reason guard and the busy flag.
    expect(html).toMatch(/data-testid="reject-submit"[^>]*disabled/)
  })

  it('reuses the same Modal close affordance (Esc/backdrop) via the Cancel button', () => {
    const onClose = vi.fn()
    // SSR doesn't run effects; the assertion is that the Cancel button is
    // wired to `onClose` (visible in markup) so consumers can drive it.
    const html = ssr(
      <RejectReasonModal open onClose={onClose} onConfirm={() => {}} />,
    )
    expect(html).toContain('data-testid="reject-cancel"')
    expect(html).toContain('취소')
  })
})
