import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/store'
import { logout } from '@/features/auth/api'
import { deriveStatus, useConnectionStore } from '@/features/auth/connectionStore'
import { IconButton } from '@/components/ui/IconButton'
import { Badge } from '@/components/ui/Badge'
import { NetworkStatusPill } from '@/components/NetworkStatusPill'
import { NotificationBell } from '@/features/notifications/components/NotificationBell'
import { useLocale } from '@/lib/i18n'
import { LanguageSwitcher } from './LanguageSwitcher'

interface TopBarProps {
  onOpenPalette?: (q?: string) => void
  /** Mobile-only — opens the nav drawer (org tree). */
  onOpenNav?: () => void
  /** Profile menu hooks — provided by AppShell so the modals/drawers live
   *  alongside the rest of the chrome. */
  onOpenSettings?: () => void
  onOpenFavorites?: () => void
  onOpenRecent?: () => void
  onOpenHelp?: () => void
}

/**
 * Sticky page header — Samsung Blue. Layout:
 *   mobile : [☰] [logo] [⌕] [+] [profile]
 *   tablet+: [logo] [search] | [primary +] | [secondary 조직] | [profile]
 *
 * Right-side actions are grouped by intent so the visual hierarchy maps to
 * how often each is reached. The Secondary group collapses to a "더 보기"
 * overflow menu below `lg`.
 */
export function TopBar({
  onOpenPalette,
  onOpenNav,
  onOpenSettings,
  onOpenFavorites,
  onOpenRecent,
  onOpenHelp,
}: TopBarProps) {
  const { t } = useLocale()
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const canWrite = !!user && ['editor', 'owner', 'admin'].includes(role)
  const isAdmin = !!user && role === 'admin'
  const canSeeAnalytics = !!user && ['owner', 'admin'].includes(role)
  const location = useLocation()

  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)

  // Close the overflow menu when clicking outside.
  useEffect(() => {
    if (!overflowOpen) return
    const onDoc = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverflowOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [overflowOpen])

  const isActive = (target: string): boolean => {
    if (target === '/') return location.pathname === '/'
    return location.pathname === target || location.pathname.startsWith(target + '/')
  }

  return (
    <header
      data-testid="topbar"
      className="fixed inset-x-0 top-0 z-sticky isolate h-[var(--header-h)] bg-smsg-700 text-white shadow-md"
    >
      <div className="flex h-[var(--header-h)] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        {/* Mobile hamburger */}
        <IconButton
          aria-label={t('topbar.menu.label')}
          data-testid="topbar-nav"
          variant="ghost"
          size="md"
          onClick={onOpenNav}
          className="text-white hover:bg-white/15 md:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </IconButton>

        <Link
          to="/"
          className="flex items-center gap-2 font-semibold text-white hover:no-underline"
        >
          <span className="rounded bg-white px-1.5 py-0.5 text-sm font-bold text-smsg-700">
            MX
          </span>
          <span className="hidden text-base sm:inline">White Paper</span>
        </Link>

        {/* Desktop search input */}
        <div className="ml-2 hidden flex-1 sm:ml-6 sm:block sm:max-w-xl">
          <SearchTrigger onOpenPalette={onOpenPalette} />
        </div>

        <nav className="ml-auto flex items-center gap-1.5 text-sm sm:gap-3" aria-label={t('topbar.primaryNav')}>
          {/* Mobile search button */}
          <IconButton
            aria-label={t('topbar.search.label')}
            variant="ghost"
            size="md"
            onClick={() => onOpenPalette?.()}
            className="text-white hover:bg-white/15 sm:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </IconButton>

          {/* Secondary group — visible on lg+, collapsed into overflow on md/sm */}
          <div className="hidden items-center gap-1.5 lg:flex">
            <NavLinkPill to="/orgs" label={t('topbar.org')} active={isActive('/orgs')} />
            <NavLinkPill to="/recent" label={t('topbar.recent')} active={isActive('/recent')} />
            <NavLinkPill to="/reads" label={t('topbar.reads')} active={isActive('/reads')} />
            {canSeeAnalytics && (
              <NavLinkPill
                to="/analytics"
                label={t('topbar.analytics')}
                active={isActive('/analytics')}
              />
            )}
            {isAdmin && (
              <Link
                to="/admin/dashboard"
                data-testid="topbar-admin-dashboard"
                aria-current={isActive('/admin/dashboard') ? 'page' : undefined}
                className={`rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20 hover:no-underline ${
                  isActive('/admin/dashboard') ? 'bg-white/25' : ''
                }`}
                aria-label={t('topbar.adminDashboard.aria')}
              >
                {t('topbar.adminBadge')}
              </Link>
            )}
          </div>

          {/* Mobile/tablet: overflow "더 보기" menu */}
          <div ref={overflowRef} className="relative lg:hidden">
            <button
              type="button"
              data-testid="topbar-overflow"
              onClick={() => setOverflowOpen((v) => !v)}
              aria-label={t('topbar.more')}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              className="hidden h-9 items-center gap-1 rounded-md px-2 text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white sm:inline-flex"
            >
              {t('topbar.more')}
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {overflowOpen && (
              <div
                role="menu"
                className="absolute right-0 top-11 z-popover w-48 overflow-hidden rounded-lg border border-gray-200 bg-white text-smsg-900 shadow-lg animate-slide-up dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                <OverflowItem
                  to="/orgs"
                  label={t('topbar.orgFull')}
                  current={isActive('/orgs')}
                  onClick={() => setOverflowOpen(false)}
                />
                <OverflowItem
                  to="/recent"
                  label={t('topbar.recentFull')}
                  current={isActive('/recent')}
                  onClick={() => setOverflowOpen(false)}
                />
                {canSeeAnalytics && (
                  <OverflowItem
                    to="/analytics"
                    label={t('topbar.analytics')}
                    current={isActive('/analytics')}
                    onClick={() => setOverflowOpen(false)}
                  />
                )}
                {isAdmin && (
                  <OverflowItem
                    to="/admin/dashboard"
                    label={t('topbar.adminDashboard')}
                    current={isActive('/admin/dashboard')}
                    onClick={() => setOverflowOpen(false)}
                  />
                )}
              </div>
            )}
          </div>

          {/* Cross-doc compare entry — minimal icon link to /compare. */}
          <Link
            to="/compare"
            data-testid="topbar-compare"
            aria-current={isActive('/compare') ? 'page' : undefined}
            className={`hidden items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors sm:inline-flex ${
              isActive('/compare')
                ? 'bg-white/20 text-white'
                : 'text-white/85 hover:bg-white/15 hover:text-white'
            }`}
          >
            <span aria-hidden="true">📊</span>
            <span>비교</span>
          </Link>

          {/* Primary group: + 새 문서 (dropdown 으로 Word 가져오기 옵션 추가) */}
          {canWrite && (
            <NewDocMenu
              tNewDocLabel={t('topbar.newDoc')}
              tNewDocAria={t('topbar.newDoc.aria')}
              tNewDocBlank={t('topbar.newDoc')}
              tNewDocImport={t('topbar.newDoc.import')}
              isActiveNew={isActive('/docs/new')}
              isActiveImport={isActive('/docs/import')}
            />
          )}

          <NetworkStatusPill />

          <span className="mx-1 hidden h-5 w-px bg-white/25 sm:inline-block" aria-hidden="true" />

          {user && <NotificationBell />}

          <LanguageSwitcher />

          {user ? (
            <ProfileMenu
              onOpenSettings={onOpenSettings}
              onOpenFavorites={onOpenFavorites}
              onOpenRecent={onOpenRecent}
              onOpenHelp={onOpenHelp}
            />
          ) : (
            <Link
              to="/login"
              className="rounded px-2 py-1 text-white/90 transition-colors hover:bg-white/15 hover:text-white"
            >
              {t('topbar.login')}
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}

/**
 * 새 문서 작성 + Word 가져오기 옵션을 묶은 dropdown.
 *
 * 모바일: 아이콘 1개 → 누르면 메뉴 열림. Tablet+: 텍스트 버튼 + ▾ 화살표.
 */
function NewDocMenu({
  tNewDocLabel,
  tNewDocAria,
  tNewDocBlank,
  tNewDocImport,
  isActiveNew,
  isActiveImport,
}: {
  tNewDocLabel: string
  tNewDocAria: string
  tNewDocBlank: string
  tNewDocImport: string
  isActiveNew: boolean
  isActiveImport: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isAnyActive = isActiveNew || isActiveImport
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {/* Mobile: icon-only button */}
      <button
        type="button"
        aria-label={tNewDocAria}
        data-testid="topbar-new-doc"
        aria-current={isAnyActive ? 'page' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-11 w-11 place-items-center rounded-md bg-white text-smsg-700 transition-all duration-base hover:bg-smsg-100 hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus sm:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {/* Tablet+: text + caret */}
      <button
        type="button"
        data-testid="topbar-new-doc-text"
        aria-current={isAnyActive ? 'page' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="hidden items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-smsg-700 transition-all duration-base hover:-translate-y-px hover:bg-smsg-100 hover:shadow-md sm:inline-flex"
      >
        {tNewDocLabel}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-popover w-56 overflow-hidden rounded-lg border border-gray-200 bg-white text-smsg-900 shadow-lg animate-slide-up dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <Link
            to="/docs/new"
            role="menuitem"
            data-testid="topbar-new-doc-blank"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-smsg-50 hover:no-underline"
          >
            {tNewDocBlank}
          </Link>
          <Link
            to="/docs/import"
            role="menuitem"
            data-testid="topbar-new-doc-import"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-smsg-50 hover:no-underline"
          >
            {tNewDocImport}
          </Link>
        </div>
      )}
    </div>
  )
}

function NavLinkPill({
  to,
  label,
  active,
}: {
  to: string
  label: string
  active: boolean
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`rounded px-2 py-1 transition-colors ${
        active
          ? 'bg-white/20 text-white'
          : 'text-white/80 hover:bg-white/15 hover:text-white'
      }`}
    >
      {label}
    </Link>
  )
}

function OverflowItem({
  to,
  label,
  current,
  onClick,
}: {
  to: string
  label: string
  current: boolean
  onClick: () => void
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={`block px-4 py-2 text-sm hover:bg-smsg-50 hover:no-underline ${
        current ? 'bg-smsg-50 font-semibold text-smsg-900' : 'text-gray-700'
      }`}
    >
      {label}
    </Link>
  )
}

function SearchTrigger({ onOpenPalette }: { onOpenPalette?: (q?: string) => void }) {
  const { t } = useLocale()
  const [value, setValue] = useState('')
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/70">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="search"
        data-testid="topbar-search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => onOpenPalette?.(value)}
        onClick={() => onOpenPalette?.(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpenPalette?.(value)
        }}
        placeholder={t('topbar.search.placeholder')}
        aria-label={t('topbar.search.label')}
        className="w-full rounded-md bg-white/10 py-1.5 pl-8 pr-12 text-sm text-white placeholder-white/60 outline-none transition-colors duration-fast hover:bg-white/15 focus:bg-white/20 focus:shadow-focus"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/80 md:inline-block"
      >
        ⌘K
      </kbd>
    </div>
  )
}

interface ProfileMenuProps {
  onOpenSettings?: () => void
  onOpenFavorites?: () => void
  onOpenRecent?: () => void
  onOpenHelp?: () => void
}

function ProfileMenu({
  onOpenSettings,
  onOpenFavorites,
  onOpenRecent,
  onOpenHelp,
}: ProfileMenuProps) {
  const { t } = useLocale()
  const user = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  const initial = (user.name ?? user.email ?? '?').slice(0, 1).toUpperCase()

  function close() {
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="topbar-profile"
        onClick={() => setOpen((v) => !v)}
        className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-sm font-semibold transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:shadow-focus sm:h-9 sm:w-9"
        aria-label={t('topbar.profile.label')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-popover w-64 overflow-hidden rounded-lg border border-gray-200 bg-white text-smsg-900 shadow-lg animate-slide-up"
        >
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold">{user.name ?? user.email}</p>
            <p className="text-xs text-gray-500">{user.email}</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone="brand" dot>{user.role}</Badge>
              <ConnectionPill />
            </div>
          </div>

          <ProfileMenuSection title={t('topbar.profile.section.profile')}>
            <ProfileMenuItem
              label={t('topbar.profile.settings')}
              icon="⚙"
              onClick={() => {
                close()
                onOpenSettings?.()
              }}
              testId="profile-menu-settings"
            />
            <ProfileMenuItem
              label={t('topbar.profile.favorites')}
              icon="★"
              onClick={() => {
                close()
                onOpenFavorites?.()
              }}
              testId="profile-menu-favorites"
            />
            <ProfileMenuItem
              label={t('topbar.profile.recent')}
              icon="↻"
              onClick={() => {
                close()
                onOpenRecent?.()
              }}
              testId="profile-menu-recent"
            />
          </ProfileMenuSection>

          <ProfileMenuSection title={t('topbar.profile.section.other')}>
            <ProfileMenuItem
              label={t('topbar.profile.help')}
              icon="?"
              onClick={() => {
                close()
                onOpenHelp?.()
              }}
              testId="profile-menu-help"
            />
            <Link
              to="/reviews"
              role="menuitem"
              onClick={close}
              data-testid="profile-menu-reviews"
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-smsg-50 hover:no-underline"
            >
              <span aria-hidden="true" className="w-4 text-center text-smsg-700">
                ✓
              </span>
              내 리뷰 요청
            </Link>
            <Link
              to="/subscriptions"
              role="menuitem"
              onClick={close}
              data-testid="profile-menu-subscriptions"
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-smsg-50 hover:no-underline"
            >
              <span aria-hidden="true" className="w-4 text-center text-smsg-700">
                ◉
              </span>
              내 팔로잉
            </Link>
            <Link
              to="/snippets"
              role="menuitem"
              onClick={close}
              data-testid="profile-menu-snippets"
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-smsg-50 hover:no-underline"
            >
              <span aria-hidden="true" className="w-4 text-center text-smsg-700">
                📚
              </span>
              {t('topbar.profile.snippets')}
            </Link>
            <Link
              to="/me/api-tokens"
              role="menuitem"
              onClick={close}
              data-testid="profile-menu-api-tokens"
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-smsg-50 hover:no-underline"
            >
              <span aria-hidden="true" className="w-4 text-center text-smsg-700">
                🔑
              </span>
              개인 API 토큰
            </Link>
            <Link
              to="/orgs"
              role="menuitem"
              onClick={close}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-smsg-50 hover:no-underline sm:hidden"
            >
              <span aria-hidden="true" className="w-4 text-center text-smsg-700">
                ▤
              </span>
              {t('topbar.profile.orgTree')}
            </Link>
          </ProfileMenuSection>

          <div className="border-t border-gray-100">
            <button
              type="button"
              role="menuitem"
              data-testid="profile-menu-logout"
              onClick={async () => {
                close()
                await logout()
                navigate('/login')
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-smsg-50"
            >
              <span aria-hidden="true" className="text-gray-400">⎋</span>
              {t('topbar.profile.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileMenuSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-gray-100 py-1">
      <p className="px-4 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </p>
      {children}
    </div>
  )
}

function ProfileMenuItem({
  label,
  icon,
  onClick,
  testId,
}: {
  label: string
  icon: string
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-smsg-50"
    >
      <span aria-hidden="true" className="w-4 text-center text-smsg-700">
        {icon}
      </span>
      {label}
    </button>
  )
}

/**
 * Tiny pill that surfaces the axios-observed connection state.
 */
function ConnectionPill() {
  const { t } = useLocale()
  const lastSuccessAt = useConnectionStore((s) => s.lastSuccessAt)
  const lastFailureAt = useConnectionStore((s) => s.lastFailureAt)
  const consecutiveFailures = useConnectionStore((s) => s.consecutiveFailures)
  const status = deriveStatus({ lastSuccessAt, lastFailureAt, consecutiveFailures })

  const styles =
    status === 'online'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'reconnecting'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-700'
  const label =
    status === 'online'
      ? t('topbar.connection.online')
      : status === 'reconnecting'
        ? t('topbar.connection.reconnecting')
        : t('topbar.connection.offline')

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles}`}
      data-testid="connection-pill"
      data-status={status}
    >
      {label}
    </span>
  )
}
