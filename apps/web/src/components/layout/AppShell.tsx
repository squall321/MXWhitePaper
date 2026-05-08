import { useState, type ReactNode } from 'react'
import { TopBar } from './TopBar'
import { OrgTree } from '@/features/org/components/OrgTree'
import { Drawer } from '@/components/ui/Drawer'

interface AppShellProps {
  children: ReactNode
  /**
   * Optional left-column content. Pages set this to override the default
   * (`<OrgTree />` on home, `null` on document/orgs pages). When `null`
   * desktop shows a single column for the left slot — main content widens.
   * When `undefined` (prop omitted) we fall back to the default OrgTree.
   */
  left?: ReactNode | null
  /** Optional right-column content (TOC, related docs, RecentRail). */
  right?: ReactNode
  /** Sprint 6: TopBar search input asks the App to open the palette. */
  onOpenPalette?: (q?: string) => void
}

const DEFAULT_LEFT = <OrgTreeBlock />

/**
 * Responsive shell with slot-based sidebars.
 *
 *   - desktop  ≥ 1024px : columns adjust based on which slots are filled.
 *       both filled : `[280 | 1fr | 280]`
 *       left only   : `[280 | 1fr]`
 *       right only  : `[1fr | 280]`
 *       neither     : `[1fr]`
 *   - tablet   ≥ 768px  : drops the right rail; left collapses to 240.
 *   - mobile   < 768px  : single column. Left tree → Drawer triggered by
 *                         the TopBar hamburger. Right rail → bottom Drawer
 *                         triggered by the floating button.
 *
 * On a page with `left = null` (DocumentReader, Orgs) the desktop left column
 * disappears entirely; the org tree is still reachable via the hamburger
 * button on every breakpoint, so users can pop it in as a Drawer.
 */
export function AppShell({ children, left, right, onOpenPalette }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)

  // Resolve the actual node to render.
  // - undefined → use default OrgTree (preserve historical behavior for pages
  //   that haven't opted into slot-based layout yet).
  // - null      → page explicitly opted out; no left column on desktop.
  const leftNode: ReactNode = left === undefined ? DEFAULT_LEFT : left
  const hasLeft = leftNode != null
  const hasRight = right != null

  const gridCls = hasLeft
    ? 'grid-cols-1 md:grid-cols-[var(--layout-tablet-sidebar-w)_1fr]' +
      (hasRight ? ' lg:grid-cols-[var(--layout-sidebar-w)_1fr_var(--layout-toc-w)]' : ' lg:grid-cols-[var(--layout-sidebar-w)_1fr]')
    : hasRight
      ? 'grid-cols-1 lg:grid-cols-[1fr_var(--layout-toc-w)]'
      : 'grid-cols-1'

  return (
    <div className="min-h-screen bg-white text-smsg-900">
      <a href="#main" className="skip-to-content">본문으로 건너뛰기</a>

      {/* TopBar 는 fixed → 본문 stacking context 와 완전 분리. 절대 침입 못 함. */}
      <TopBar
        onOpenPalette={onOpenPalette}
        onOpenNav={() => setNavOpen(true)}
      />

      <div className={`grid min-h-[calc(100vh-var(--header-h))] pt-[var(--header-h)] ${gridCls}`}>
        {/* Left tree — visible md+ only when the page provides a left slot. */}
        {hasLeft && (
          <aside className="hidden border-r border-gray-200 bg-white md:block">
            <div className="sticky top-[var(--header-h)] max-h-[calc(100vh-var(--header-h))] overflow-y-auto py-3">
              {leftNode}
            </div>
          </aside>
        )}

        <main
          id="main"
          tabIndex={-1}
          // `isolate` 로 본문 영역을 별도 stacking context 로 만들어 위젯
          // (Mantine/Recharts/Mermaid 등)이 자체 z-index 를 박아도 헤더 위로
          // 새어 나오지 않게 한다.
          className="min-w-0 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 isolate"
        >
          <div className="mx-auto w-full max-w-readable lg:max-w-prose">{children}</div>
        </main>

        {/* Right rail — visible lg+ only. md hides; mobile uses Drawer. */}
        {hasRight && (
          <aside className="hidden border-l border-gray-200 bg-white lg:block">
            <div className="sticky top-[var(--header-h)] max-h-[calc(100vh-var(--header-h))] overflow-y-auto py-3">
              {right}
            </div>
          </aside>
        )}
      </div>

      {/* Floating 목차 button on mobile when the page has supplied right-rail content. */}
      {hasRight && (
        <button
          type="button"
          onClick={() => setTocOpen(true)}
          aria-label="목차 열기"
          className="fixed bottom-4 right-4 z-drawer rounded-full bg-smsg-700 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-smsg-900 lg:hidden"
        >
          목차
        </button>
      )}

      {/* Mobile left drawer — Org tree is always available via hamburger. */}
      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        side="left"
        ariaLabel="조직 트리"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">조직</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setNavOpen(false)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-2" onClick={() => setNavOpen(false)}>
          <OrgTree />
        </div>
      </Drawer>

      {/* Mobile right drawer — TOC / RightRail content. */}
      {hasRight && (
        <Drawer
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          side="bottom"
          ariaLabel="목차"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">목차</h2>
            <button
              type="button"
              aria-label="닫기"
              onClick={() => setTocOpen(false)}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="p-3">{right}</div>
        </Drawer>
      )}
    </div>
  )
}

/** Default OrgTree block reused by HomePage and as the AppShell fallback. */
function OrgTreeBlock() {
  return (
    <>
      <h2 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        조직
      </h2>
      <OrgTree />
    </>
  )
}
