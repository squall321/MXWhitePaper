import { useState, type ReactNode } from 'react'
import { TopBar } from './TopBar'
import { Breadcrumb } from './Breadcrumb'
import { useGChord } from './useGChord'
import { MobileNavDrawer } from './MobileNavDrawer'
import { OrgTree } from '@/features/org/components/OrgTree'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { RailBoundary } from '@/components/blocks/BlockBoundary'
import { useFavoritesStore } from '@/features/favorites/store'
import { useRecentStore } from '@/features/recent/store'
import { useSettingsStore } from '@/features/settings/store'
import { KeyboardShortcutsModal } from '@/features/editor/components/KeyboardShortcutsModal'
import { Link } from 'react-router-dom'

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
 *   - mobile   < 768px  : single column. Left tree → tabbed Drawer triggered
 *                         by the TopBar hamburger. Right rail → bottom Drawer
 *                         triggered by the floating button.
 *
 * On a page with `left = null` (DocumentReader, Orgs) the desktop left column
 * disappears entirely; the org tree is still reachable via the hamburger
 * button on every breakpoint, so users can pop it in as a Drawer.
 */
export function AppShell({ children, left, right, onOpenPalette }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)

  // Wire vim-style "G then key" navigation chords.
  useGChord()

  // Resolve the actual node to render.
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

      <TopBar
        onOpenPalette={onOpenPalette}
        onOpenNav={() => setNavOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFavorites={() => setFavoritesOpen(true)}
        onOpenRecent={() => setRecentOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {/* Sticky breadcrumb directly under the TopBar (auto-hides on routes
          without a meaningful trail, e.g. /login which lives outside this
          shell anyway). */}
      <div className="fixed inset-x-0 top-[var(--header-h)] z-sticky">
        <Breadcrumb />
      </div>

      <div className={`grid min-h-[calc(100vh-var(--header-h))] pt-[calc(var(--header-h)+2rem)] ${gridCls}`}>
        {/* Left tree — visible md+ only when the page provides a left slot. */}
        {hasLeft && (
          <aside className="hidden border-r border-gray-200 bg-white md:block">
            <div className="sticky top-[calc(var(--header-h)+2rem)] max-h-[calc(100vh-var(--header-h)-2rem)] overflow-y-auto py-3">
              <RailBoundary name="조직 트리">{leftNode}</RailBoundary>
            </div>
          </aside>
        )}

        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 isolate"
        >
          <div className="mx-auto w-full max-w-readable lg:max-w-prose">{children}</div>
        </main>

        {/* Right rail — visible lg+ only. md hides; mobile uses Drawer. */}
        {hasRight && (
          <aside className="hidden border-l border-gray-200 bg-white lg:block">
            <div className="sticky top-[calc(var(--header-h)+2rem)] max-h-[calc(100vh-var(--header-h)-2rem)] overflow-y-auto py-3">
              <RailBoundary name="우측 패널">{right}</RailBoundary>
            </div>
          </aside>
        )}
      </div>

      {/* Floating "측면 패널" button on mobile when the page has supplied
          right-rail content. Renamed from "목차" since DocumentReader pushes
          custom content here too (VersionHistoryPanel, related docs, etc). */}
      {hasRight && (
        <button
          type="button"
          onClick={() => setTocOpen(true)}
          aria-label="측면 패널 열기"
          className="fixed bottom-4 right-4 z-drawer inline-flex items-center gap-1.5 rounded-full bg-smsg-700 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-smsg-900 lg:hidden"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z" fill="currentColor" />
          </svg>
          측면 패널
        </button>
      )}

      {/* Mobile left drawer — tabbed: 조직 / 즐겨찾기 / 최근. */}
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Mobile right drawer — TOC / RightRail content. */}
      {hasRight && (
        <Drawer
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          side="bottom"
          ariaLabel="측면 패널"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">측면 패널</h2>
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

      {/* Profile menu surfaces — Modal / Drawer hosted at the shell level. */}
      <KeyboardShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SettingsQuickModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <FavoritesDrawer open={favoritesOpen} onClose={() => setFavoritesOpen(false)} />
      <RecentDrawer open={recentOpen} onClose={() => setRecentOpen(false)} />
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

/**
 * Lightweight "환경설정" Modal opened from the profile menu. Mirrors a subset
 * of /settings — full page is the canonical surface; this modal is a quick
 * peek for the most common toggles + a deep-link to the full page.
 */
function SettingsQuickModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notifications = useSettingsStore((s) => s.notifications)
  const darkMode = useSettingsStore((s) => s.darkMode)
  const setOne = useSettingsStore((s) => s.set)

  return (
    <Modal open={open} onClose={onClose} title="빠른 환경설정" size="sm">
      <div className="space-y-3 px-5 py-4">
        <Toggle
          label="알림"
          checked={notifications}
          onChange={(v) => setOne('notifications', v)}
        />
        <Toggle
          label="다크 모드 (베타)"
          checked={darkMode}
          onChange={(v) => setOne('darkMode', v)}
        />
        <p className="text-xs text-gray-500">
          전체 옵션은 <Link to="/settings" onClick={onClose} className="text-link hover:underline">환경설정 페이지</Link>에서 확인하세요.
        </p>
      </div>
    </Modal>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-smsg-900">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-smsg-700' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

function FavoritesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useFavoritesStore((s) => s.items)
  const remove = useFavoritesStore((s) => s.remove)

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel="즐겨찾기">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">즐겨찾기</h2>
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          아직 즐겨찾기한 문서가 없어요. 문서 헤더의 별 아이콘을 눌러 추가하세요.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((it) => (
            <li key={it.slug} className="flex items-start gap-3 px-4 py-3 hover:bg-smsg-50">
              <Link
                to={`/docs/${encodeURIComponent(it.slug)}`}
                onClick={onClose}
                className="min-w-0 flex-1 hover:no-underline"
              >
                <p className="line-clamp-2 text-sm font-medium text-smsg-900">{it.title}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">{it.slug}</p>
              </Link>
              <button
                type="button"
                onClick={() => remove(it.slug)}
                aria-label={`${it.title} 즐겨찾기에서 제거`}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                title="제거"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}

function RecentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useRecentStore((s) => s.items)

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel="최근 활동">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">최근 활동</h2>
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">최근 본 문서가 없어요.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.slice(0, 20).map((it) => (
            <li key={it.slug}>
              <Link
                to={`/docs/${encodeURIComponent(it.slug)}`}
                onClick={onClose}
                className="block px-4 py-3 hover:bg-smsg-50 hover:no-underline"
              >
                <p className="line-clamp-2 text-sm font-medium text-smsg-900">{it.title}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">{it.slug}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}
