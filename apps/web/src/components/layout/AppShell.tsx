import { Suspense, lazy, useState, type ReactNode } from 'react'
import { TopBar } from './TopBar'
import { Breadcrumb } from './Breadcrumb'
import { useGChord } from './useGChord'
import { MobileNavDrawer } from './MobileNavDrawer'
import { OrgTree } from '@/features/org/components/OrgTree'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { RailBoundary } from '@/components/blocks/BlockBoundary'
import { EmailVerifyBanner } from '@/components/EmailVerifyBanner'
import { useFavoritesStore } from '@/features/favorites/store'
import { useRecentStore } from '@/features/recent/store'
import { useSettingsStore } from '@/features/settings/store'
import { Link } from 'react-router-dom'
import { useT } from '@/lib/i18n'

// Keyboard shortcuts modal is rarely opened (?-key) — defer the chunk until
// the first time the user actually opens it.
const KeyboardShortcutsModal = lazy(() =>
  import('@/features/editor/components/KeyboardShortcutsModal').then((m) => ({
    default: m.KeyboardShortcutsModal,
  })),
)

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
  const t = useT()
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
    <div className="min-h-screen bg-white text-smsg-900 dark:bg-gray-950 dark:text-gray-100">
      <a href="#main" className="skip-to-content">{t('shell.skipToContent')}</a>

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
          shell anyway). 100% 불투명 (bg-white/-gray-900) + border + shadow 로
          본문이 절대 비치지 않도록 한다. backdrop-blur 는 일부 GPU 에서 합성
          순서가 꼬여서 본문이 위에 보이는 사례가 있어 제거. */}
      <div className="fixed inset-x-0 top-[var(--header-h)] z-sticky border-b border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <Breadcrumb />
      </div>

      <div className={`grid min-h-[calc(100vh-var(--header-h))] pt-[calc(var(--header-h)+2rem)] ${gridCls}`}>
        {/* Left tree — visible md+ only when the page provides a left slot. */}
        {hasLeft && (
          <aside
            role="complementary"
            aria-label={t('shell.orgTree')}
            className="hidden border-r border-gray-200 bg-white md:block dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="sticky top-[calc(var(--header-h)+2rem)] max-h-[calc(100vh-var(--header-h)-2rem)] overflow-y-auto py-3">
              <RailBoundary name={t('shell.orgTree')}>{leftNode}</RailBoundary>
            </div>
          </aside>
        )}

        <main
          id="main"
          role="main"
          tabIndex={-1}
          className="min-w-0 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 isolate"
        >
          <div className="mx-auto w-full max-w-readable lg:max-w-prose">
            <EmailVerifyBanner />
            {children}
          </div>
        </main>

        {/* Right rail — visible lg+ only. md hides; mobile uses Drawer. */}
        {hasRight && (
          <aside
            role="complementary"
            aria-label={t('shell.rightPanel')}
            className="hidden border-l border-gray-200 bg-white lg:block dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="sticky top-[calc(var(--header-h)+2rem)] max-h-[calc(100vh-var(--header-h)-2rem)] overflow-y-auto py-3">
              <RailBoundary name={t('shell.rightPanel')}>{right}</RailBoundary>
            </div>
          </aside>
        )}
      </div>

      {/* Floating "측면 패널" button on mobile when the page has supplied
          right-rail content. Renamed from "목차" since DocumentReader pushes
          custom content here too (VersionHistoryPanel, related docs, etc).
          `bottom` uses a CSS calc that respects iOS safe-area + tries to
          stay above the visual viewport when the soft keyboard is open. */}
      {hasRight && (
        <button
          type="button"
          onClick={() => setTocOpen(true)}
          aria-label={t('shell.openSidePanel')}
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          className="fixed right-4 z-drawer inline-flex items-center gap-1.5 rounded-full bg-smsg-700 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-smsg-900 lg:hidden"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z" fill="currentColor" />
          </svg>
          {t('shell.sidePanel')}
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
          ariaLabel={t('shell.sidePanel')}
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{t('shell.sidePanel')}</h2>
            <button
              type="button"
              aria-label={t('common.close')}
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
      {helpOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
        </Suspense>
      )}
      <SettingsQuickModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <FavoritesDrawer open={favoritesOpen} onClose={() => setFavoritesOpen(false)} />
      <RecentDrawer open={recentOpen} onClose={() => setRecentOpen(false)} />
    </div>
  )
}

/** Default OrgTree block reused by HomePage and as the AppShell fallback. */
function OrgTreeBlock() {
  const t = useT()
  return (
    <>
      <h2 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('shell.org')}
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
  const t = useT()
  const notifications = useSettingsStore((s) => s.notifications)
  const darkMode = useSettingsStore((s) => s.darkMode)
  const setOne = useSettingsStore((s) => s.set)

  return (
    <Modal open={open} onClose={onClose} title={t('page.settings.quickTitle')} size="sm">
      <div className="space-y-3 px-5 py-4">
        <Toggle
          label={t('settings.notifications')}
          checked={notifications}
          onChange={(v) => setOne('notifications', v)}
        />
        <Toggle
          label={t('page.settings.quickDarkBeta')}
          checked={darkMode}
          onChange={(v) => setOne('darkMode', v)}
        />
        <p className="text-xs text-gray-500">
          {t('page.settings.quickFull')}{' '}
          <Link to="/settings" onClick={onClose} className="text-link hover:underline">
            {t('page.settings.quickFullLink')}
          </Link>
          {t('page.settings.quickFullSuffix')}
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
  const t = useT()
  const items = useFavoritesStore((s) => s.items)
  const remove = useFavoritesStore((s) => s.remove)

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('shell.favorites')}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{t('shell.favorites')}</h2>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          {t('shell.favoritesEmpty')}
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
                aria-label={t('shell.removeFavoriteAria', { title: it.title })}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                title={t('shell.removeFavoriteTitle')}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}

function RecentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const items = useRecentStore((s) => s.items)

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('shell.recent')}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{t('shell.recent')}</h2>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">{t('shell.recentEmpty')}</p>
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
