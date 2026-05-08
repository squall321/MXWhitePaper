import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/store'
import { logout } from '@/features/auth/api'
import { deriveStatus, useConnectionStore } from '@/features/auth/connectionStore'
import { IconButton } from '@/components/ui/IconButton'
import { Badge } from '@/components/ui/Badge'
import { NetworkStatusPill } from '@/components/NetworkStatusPill'
import { NotificationBell } from '@/features/notifications/components/NotificationBell'

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
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const canWrite = !!user && ['editor', 'owner', 'admin'].includes(role)
  const isAdmin = !!user && role === 'admin'
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
          aria-label="메뉴 열기"
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

        <nav className="ml-auto flex items-center gap-1.5 text-sm sm:gap-3" aria-label="주요 메뉴">
          {/* Mobile search button */}
          <IconButton
            aria-label="검색"
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
            <NavLinkPill to="/orgs" label="조직" active={isActive('/orgs')} />
            <NavLinkPill to="/recent" label="최근" active={isActive('/recent')} />
            {isAdmin && (
              <Link
                to="/admin/orgs"
                aria-current={isActive('/admin/orgs') ? 'page' : undefined}
                className={`rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20 hover:no-underline ${
                  isActive('/admin/orgs') ? 'bg-white/25' : ''
                }`}
                aria-label="조직 관리"
              >
                ⚙ 조직
              </Link>
            )}
          </div>

          {/* Mobile/tablet: overflow "더 보기" menu */}
          <div ref={overflowRef} className="relative lg:hidden">
            <button
              type="button"
              data-testid="topbar-overflow"
              onClick={() => setOverflowOpen((v) => !v)}
              aria-label="더 보기"
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              className="hidden h-9 items-center gap-1 rounded-md px-2 text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white sm:inline-flex"
            >
              더 보기
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {overflowOpen && (
              <div
                role="menu"
                className="absolute right-0 top-11 z-popover w-48 overflow-hidden rounded-lg border border-gray-200 bg-white text-smsg-900 shadow-lg animate-slide-up"
              >
                <OverflowItem
                  to="/orgs"
                  label="조직"
                  current={isActive('/orgs')}
                  onClick={() => setOverflowOpen(false)}
                />
                <OverflowItem
                  to="/recent"
                  label="최근 본 문서"
                  current={isActive('/recent')}
                  onClick={() => setOverflowOpen(false)}
                />
                {isAdmin && (
                  <OverflowItem
                    to="/admin/orgs"
                    label="⚙ 조직 관리"
                    current={isActive('/admin/orgs')}
                    onClick={() => setOverflowOpen(false)}
                  />
                )}
              </div>
            )}
          </div>

          {/* Primary group: + 새 문서 */}
          {canWrite && (
            <>
              {/* Mobile: icon-only Link */}
              <Link
                to="/docs/new"
                aria-label="새 문서 작성"
                data-testid="topbar-new-doc"
                aria-current={isActive('/docs/new') ? 'page' : undefined}
                className="grid h-9 w-9 place-items-center rounded-md bg-white text-smsg-700 transition-all duration-base hover:bg-smsg-100 hover:no-underline hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus sm:hidden"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </Link>
              {/* Tablet+: text button */}
              <Link
                to="/docs/new"
                data-testid="topbar-new-doc-text"
                aria-current={isActive('/docs/new') ? 'page' : undefined}
                className="hidden rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-smsg-700 transition-all duration-base hover:-translate-y-px hover:bg-smsg-100 hover:no-underline hover:shadow-md sm:inline-flex"
              >
                + 새 문서
              </Link>
            </>
          )}

          <NetworkStatusPill />

          <span className="mx-1 hidden h-5 w-px bg-white/25 sm:inline-block" aria-hidden="true" />

          {user && <NotificationBell />}

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
              로그인
            </Link>
          )}
        </nav>
      </div>
    </header>
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
        placeholder="검색 (⌘K)"
        aria-label="검색"
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
        className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-sm font-semibold transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:shadow-focus"
        aria-label="프로필 메뉴"
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

          <ProfileMenuSection title="프로필">
            <ProfileMenuItem
              label="환경설정"
              icon="⚙"
              onClick={() => {
                close()
                onOpenSettings?.()
              }}
              testId="profile-menu-settings"
            />
            <ProfileMenuItem
              label="즐겨찾기"
              icon="★"
              onClick={() => {
                close()
                onOpenFavorites?.()
              }}
              testId="profile-menu-favorites"
            />
            <ProfileMenuItem
              label="최근 활동"
              icon="↻"
              onClick={() => {
                close()
                onOpenRecent?.()
              }}
              testId="profile-menu-recent"
            />
          </ProfileMenuSection>

          <ProfileMenuSection title="기타">
            <ProfileMenuItem
              label="도움말 / 단축키"
              icon="?"
              onClick={() => {
                close()
                onOpenHelp?.()
              }}
              testId="profile-menu-help"
            />
            <Link
              to="/orgs"
              role="menuitem"
              onClick={close}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-smsg-50 hover:no-underline sm:hidden"
            >
              <span aria-hidden="true" className="w-4 text-center text-smsg-700">
                ▤
              </span>
              조직 트리
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
              로그아웃
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
    status === 'online' ? '온라인 ✓' : status === 'reconnecting' ? '재연결 시도 중' : '오프라인'

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
