import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Drawer } from '@/components/ui/Drawer'
import { OrgTree } from '@/features/org/components/OrgTree'
import { useFavoritesStore } from '@/features/favorites/store'
import { useRecentStore } from '@/features/recent/store'
import { useAuthStore } from '@/features/auth/store'

type Tab = 'orgs' | 'favorites' | 'recent'

interface MobileNavDrawerProps {
  open: boolean
  onClose: () => void
}

/**
 * Mobile-only nav drawer triggered by the TopBar hamburger. Tabs:
 *   - 조직     : full OrgTree (legacy behaviour)
 *   - 즐겨찾기 : starred docs (mxwp.favorites)
 *   - 최근     : last 20 viewed docs (mxwp.recentDocs)
 *
 * A persistent "+ 새 문서" button at the bottom is shown for editor+.
 */
export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  const [tab, setTab] = useState<Tab>('orgs')
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const canWrite = !!user && ['editor', 'owner', 'admin'].includes(role)

  return (
    <Drawer open={open} onClose={onClose} side="left" ariaLabel="메뉴">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">메뉴</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div role="tablist" className="flex border-b border-gray-200 text-xs font-medium">
          <TabButton active={tab === 'orgs'} onClick={() => setTab('orgs')} label="조직" />
          <TabButton
            active={tab === 'favorites'}
            onClick={() => setTab('favorites')}
            label="즐겨찾기"
          />
          <TabButton active={tab === 'recent'} onClick={() => setTab('recent')} label="최근" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'orgs' && (
            <div className="p-2" onClick={onClose}>
              <OrgTree />
            </div>
          )}
          {tab === 'favorites' && <FavoritesList onClose={onClose} />}
          {tab === 'recent' && <RecentList onClose={onClose} />}
        </div>

        {canWrite && (
          <div className="border-t border-gray-200 p-3">
            <Link
              to="/docs/new"
              onClick={onClose}
              className="flex items-center justify-center gap-2 rounded-md bg-smsg-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-smsg-900 hover:no-underline"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              새 문서
            </Link>
          </div>
        )}
      </div>
    </Drawer>
  )
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 px-3 py-2 transition-colors ${
        active
          ? 'border-b-2 border-smsg-700 text-smsg-900'
          : 'text-gray-500 hover:bg-gray-50 hover:text-smsg-900'
      }`}
    >
      {label}
    </button>
  )
}

function FavoritesList({ onClose }: { onClose: () => void }) {
  const items = useFavoritesStore((s) => s.items)
  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-gray-500">
        아직 즐겨찾기한 문서가 없어요.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((it) => (
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
  )
}

function RecentList({ onClose }: { onClose: () => void }) {
  const items = useRecentStore((s) => s.items)
  if (items.length === 0) {
    return <p className="px-4 py-6 text-sm text-gray-500">최근 본 문서가 없어요.</p>
  }
  return (
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
  )
}
