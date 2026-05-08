import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/store'
import { logout } from '@/features/auth/api'
import { deriveStatus, useConnectionStore } from '@/features/auth/connectionStore'
import { IconButton } from '@/components/ui/IconButton'
import { Badge } from '@/components/ui/Badge'
import { NetworkStatusPill } from '@/components/NetworkStatusPill'

interface TopBarProps {
  onOpenPalette?: (q?: string) => void
  /** Mobile-only — opens the nav drawer (org tree). */
  onOpenNav?: () => void
}

/**
 * Sticky page header — Samsung Blue. Layout:
 *   mobile : [☰] [logo] [⌕] [+] [profile]
 *   tablet+: [logo]  [search input] [조직] [+ 새 문서] [profile]
 */
export function TopBar({ onOpenPalette, onOpenNav }: TopBarProps) {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const canWrite = !!user && ['editor', 'owner', 'admin'].includes(role)
  const isAdmin = !!user && role === 'admin'

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

        <nav className="ml-auto flex items-center gap-1.5 text-sm sm:gap-3">
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

          <Link
            to="/orgs"
            className="hidden rounded px-2 py-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white sm:inline-block"
          >
            조직
          </Link>

          {isAdmin && (
            <Link
              to="/admin/orgs"
              className="hidden rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20 hover:no-underline sm:inline-flex"
              aria-label="조직 관리"
            >
              ⚙ 조직
            </Link>
          )}

          {canWrite && (
            <>
              {/* Mobile: icon-only Link */}
              <Link
                to="/docs/new"
                aria-label="새 문서 작성"
                data-testid="topbar-new-doc"
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
                className="hidden rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-smsg-700 transition-all duration-base hover:-translate-y-px hover:bg-smsg-100 hover:no-underline hover:shadow-md sm:inline-flex"
              >
                + 새 문서
              </Link>
            </>
          )}

          {/* Always-visible offline / slow-response pill (hidden on the
              happy path so it doesn't add visual noise). */}
          <NetworkStatusPill />

          <span className="mx-1 hidden h-5 w-px bg-white/25 sm:inline-block" aria-hidden="true" />

          {user ? (
            <ProfileMenu />
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

function ProfileMenu() {
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
          className="absolute right-0 top-11 z-popover w-60 overflow-hidden rounded-lg border border-gray-200 bg-white text-smsg-900 shadow-lg animate-slide-up"
        >
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold">{user.name ?? user.email}</p>
            <p className="text-xs text-gray-500">{user.email}</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone="brand" dot>{user.role}</Badge>
              <ConnectionPill />
            </div>
          </div>
          <Link
            to="/orgs"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-gray-700 hover:bg-smsg-50 hover:no-underline sm:hidden"
          >
            조직 트리
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false)
              await logout()
              navigate('/login')
            }}
            className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-smsg-50"
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Tiny pill that surfaces the axios-observed connection state. Updated
 * by `connectionStore` from the response interceptor:
 *   online       → 녹색  "온라인"
 *   reconnecting → 주황  "재연결 시도 중"
 *   offline      → 빨강  "오프라인"
 */
function ConnectionPill() {
  // Subscribe to the slice that drives `deriveStatus` so the pill rerenders
  // whenever traffic happens.
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
