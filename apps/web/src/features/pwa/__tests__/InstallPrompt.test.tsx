import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  InstallPrompt,
  shouldShowInstallPill,
  triggerInstallPrompt,
  type BeforeInstallPromptEvent,
} from '../InstallPrompt'

/**
 * The component itself is lifecycle-driven (useEffect listens for
 * `beforeinstallprompt`), and the test runner has no DOM, so SSR sees
 * the initial state only — i.e. nothing rendered. We assert that
 * baseline AND drive the event/click logic through the exported pure
 * helpers (`shouldShowInstallPill`, `triggerInstallPrompt`).
 */

describe('<InstallPrompt /> SSR baseline', () => {
  it('renders nothing on the server (no stashed event yet)', () => {
    const html = renderToStaticMarkup(<InstallPrompt />)
    expect(html).toBe('')
  })
})

describe('shouldShowInstallPill()', () => {
  it('hides when running in standalone mode', () => {
    expect(shouldShowInstallPill(true, true)).toBe(false)
    expect(shouldShowInstallPill(true, false)).toBe(false)
  })
  it('hides when no event has been stashed yet', () => {
    expect(shouldShowInstallPill(false, false)).toBe(false)
  })
  it('shows when not standalone AND an event is ready', () => {
    expect(shouldShowInstallPill(false, true)).toBe(true)
  })
})

describe('triggerInstallPrompt()', () => {
  function makeFakeEvent(
    outcome: 'accepted' | 'dismissed' = 'accepted',
  ): BeforeInstallPromptEvent {
    return {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome, platform: 'web' }),
      preventDefault: vi.fn(),
    } as unknown as BeforeInstallPromptEvent
  }

  it('calls prompt() and resolves with the user choice', async () => {
    const evt = makeFakeEvent('accepted')
    const onSettled = vi.fn()
    const outcome = await triggerInstallPrompt(evt, onSettled)
    expect(evt.prompt).toHaveBeenCalledTimes(1)
    expect(outcome).toBe('accepted')
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('returns the dismissed outcome', async () => {
    const evt = makeFakeEvent('dismissed')
    const onSettled = vi.fn()
    const outcome = await triggerInstallPrompt(evt, onSettled)
    expect(outcome).toBe('dismissed')
    expect(onSettled).toHaveBeenCalled()
  })

  it("returns 'errored' if prompt() throws and still settles", async () => {
    const evt = {
      prompt: vi.fn().mockRejectedValue(new Error('blocked')),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    } as unknown as BeforeInstallPromptEvent
    const onSettled = vi.fn()
    const outcome = await triggerInstallPrompt(evt, onSettled)
    expect(outcome).toBe('errored')
    expect(onSettled).toHaveBeenCalledTimes(1)
  })
})

describe('beforeinstallprompt event flow (mocked)', () => {
  it('a captured event exposes the prompt + userChoice contract we rely on', async () => {
    // Synthesize what Chrome would dispatch and verify our helper can
    // drive it end-to-end. This is a contract test for the event shape.
    const evt = {
      type: 'beforeinstallprompt',
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({
        outcome: 'accepted' as const,
        platform: 'web',
      }),
    } as unknown as BeforeInstallPromptEvent
    const settled = vi.fn()
    const outcome = await triggerInstallPrompt(evt, settled)
    expect(outcome).toBe('accepted')
    expect(evt.prompt).toHaveBeenCalled()
    expect(settled).toHaveBeenCalled()
  })
})
