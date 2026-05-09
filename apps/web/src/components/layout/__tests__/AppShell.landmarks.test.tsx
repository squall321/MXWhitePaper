import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '../AppShell'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v))
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
  clear(): void {
    this.data.clear()
  }
  key(i: number): string | null {
    return Array.from(this.data.keys())[i] ?? null
  }
  get length(): number {
    return this.data.size
  }
}

const originalWindow = (globalThis as { window?: unknown }).window
beforeAll(() => {
  ;(globalThis as { window?: unknown }).window = {
    localStorage: new MemoryStorage(),
  }
})
afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window
  } else {
    ;(globalThis as { window?: unknown }).window = originalWindow
  }
})

/**
 * Cycle 7 landmark / a11y smoke test for the AppShell. Asserts the major
 * landmarks exist so screen-reader users can navigate the page structure
 * without the visual hierarchy.
 */
describe('AppShell landmarks', () => {
  it('renders the skip-to-content link, <main role="main">, and an aria-labelled <aside role="complementary">', () => {
    const qc = new QueryClient()
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <AppShell right={<div>toc</div>}>
            <h1>hello</h1>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(html).toContain('class="skip-to-content"')
    expect(html).toContain('id="main"')
    expect(html).toContain('role="main"')
    expect(html).toContain('role="complementary"')
  })
})
