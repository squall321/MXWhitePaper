import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  type ShareLink,
} from './api'
import type { Slug } from '@/types/document'

type Tab = 'public' | 'internal'

interface ShareModalProps {
  open: boolean
  slug: Slug
  onClose: () => void
}

/**
 * Share dialog: two tabs.
 *
 *   1. 공개 링크 — list existing tokens, show view counts/expiry, revoke.
 *      Inline sub-form to create a new token (optional expiry + password).
 *   2. 사내 권한 — read-only summary of the existing role-based access.
 *
 * Korean copy is intentionally NOT wrapped in `t()` — the i18n agent owns
 * locale extraction; this component is added in raw Korean for them to
 * harvest later.
 */
export function ShareModal({ open, slug, onClose }: ShareModalProps) {
  const [tab, setTab] = useState<Tab>('public')
  const [items, setItems] = useState<ShareLink[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await listShareLinks(slug)
      setItems(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slug])

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const expiresIso = expiresAt
        ? new Date(`${expiresAt}T23:59:59`).toISOString()
        : undefined
      const result = await createShareLink(slug, {
        expires_at: expiresIso,
        password: password || undefined,
      })
      // Build absolute URL from origin so users can paste outside the app.
      const absUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${result.url}`
          : result.url
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(absUrl)
        }
      } catch {
        /* clipboard unavailable — UI still shows the URL below */
      }
      setCopied(absUrl)
      setShowForm(false)
      setExpiresAt('')
      setPassword('')
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (token: string) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('이 공유 링크를 정말 해제하시겠습니까?')
    ) {
      return
    }
    setError(null)
    try {
      await revokeShareLink(token)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const copyExisting = async (link: ShareLink) => {
    const absUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}${link.url}`
        : link.url
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(absUrl)
      }
    } catch {
      /* ignore */
    }
    setCopied(absUrl)
  }

  return (
    <Modal open={open} onClose={onClose} title="공유" size="lg">
      <div className="px-5 pb-5 pt-4" data-testid="share-modal">
        <div
          className="mb-4 inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5 text-sm dark:border-gray-800 dark:bg-gray-950"
          role="tablist"
          aria-label="공유 옵션"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'public'}
            onClick={() => setTab('public')}
            data-testid="share-tab-public"
            className={
              tab === 'public'
                ? 'rounded bg-white px-3 py-1 text-smsg-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                : 'rounded px-3 py-1 text-gray-600 hover:text-smsg-900 dark:text-gray-400'
            }
          >
            공개 링크
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'internal'}
            onClick={() => setTab('internal')}
            data-testid="share-tab-internal"
            className={
              tab === 'internal'
                ? 'rounded bg-white px-3 py-1 text-smsg-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                : 'rounded px-3 py-1 text-gray-600 hover:text-smsg-900 dark:text-gray-400'
            }
          >
            사내 권한
          </button>
        </div>

        {tab === 'public' ? (
          <PublicLinksTab
            slug={slug}
            items={items}
            loading={loading}
            error={error}
            showForm={showForm}
            creating={creating}
            expiresAt={expiresAt}
            password={password}
            copied={copied}
            onShowForm={() => {
              setShowForm(true)
              setCopied(null)
            }}
            onCancelForm={() => setShowForm(false)}
            onChangeExpiresAt={setExpiresAt}
            onChangePassword={setPassword}
            onCreate={handleCreate}
            onRevoke={handleRevoke}
            onCopy={copyExisting}
          />
        ) : (
          <InternalAccessTab />
        )}
      </div>
    </Modal>
  )
}

interface PublicLinksTabProps {
  slug: Slug
  items: ShareLink[]
  loading: boolean
  error: string | null
  showForm: boolean
  creating: boolean
  expiresAt: string
  password: string
  copied: string | null
  onShowForm: () => void
  onCancelForm: () => void
  onChangeExpiresAt: (v: string) => void
  onChangePassword: (v: string) => void
  onCreate: () => void
  onRevoke: (token: string) => void
  onCopy: (link: ShareLink) => void
}

function PublicLinksTab(props: PublicLinksTabProps) {
  const {
    items,
    loading,
    error,
    showForm,
    creating,
    expiresAt,
    password,
    copied,
    onShowForm,
    onCancelForm,
    onChangeExpiresAt,
    onChangePassword,
    onCreate,
    onRevoke,
    onCopy,
  } = props

  return (
    <div data-testid="share-tab-public-panel">
      <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
        링크가 있는 사람은 누구나 이 문서를 읽기 전용 모드로 볼 수 있습니다.
      </p>
      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {copied && (
        <div
          className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800"
          data-testid="share-copied-banner"
        >
          링크가 복사되었습니다 — <span className="break-all font-mono">{copied}</span>
        </div>
      )}

      {!showForm && (
        <button
          type="button"
          onClick={onShowForm}
          data-testid="share-create-button"
          className="mb-3 inline-flex h-8 items-center rounded-md bg-smsg-700 px-3 text-xs font-semibold text-white hover:bg-smsg-900"
        >
          + 새 공유 링크 생성
        </button>
      )}

      {showForm && (
        <div
          className="mb-4 space-y-2 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950"
          data-testid="share-create-form"
        >
          <label className="block text-xs">
            <span className="mb-1 block text-gray-600">만료일 (옵션)</span>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => onChangeExpiresAt(e.target.value)}
              data-testid="share-expires-input"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-gray-600">비밀번호 (옵션)</span>
            <input
              type="password"
              placeholder="설정하지 않으면 누구나 볼 수 있습니다"
              value={password}
              onChange={(e) => onChangePassword(e.target.value)}
              data-testid="share-password-input"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
            />
          </label>
          {!password && (
            <p
              className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
              data-testid="share-no-password-warning"
            >
              ⚠ 이 링크는 누구나 볼 수 있습니다. 외부 공유 시 비밀번호를 권장합니다.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancelForm}
              className="h-7 rounded border border-gray-300 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onCreate}
              disabled={creating}
              data-testid="share-submit-button"
              className="h-7 rounded bg-smsg-700 px-3 text-xs font-semibold text-white disabled:opacity-50 hover:bg-smsg-900"
            >
              {creating ? '생성 중…' : '생성'}
            </button>
          </div>
        </div>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        활성 공유 링크
      </h3>
      {loading && <p className="text-xs text-gray-500">불러오는 중…</p>}
      {!loading && items.length === 0 && (
        <p className="rounded border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500">
          아직 생성된 공유 링크가 없습니다.
        </p>
      )}
      {!loading && items.length > 0 && (
        <ul className="space-y-2" data-testid="share-link-list">
          {items.map((link) => (
            <li
              key={link.id}
              data-testid="share-link-row"
              className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-900"
            >
              <span className="flex-1 break-all font-mono text-gray-700 dark:text-gray-300">
                {link.url}
              </span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                조회 {link.view_count}회
              </span>
              {link.has_password && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">
                  🔒 비밀번호
                </span>
              )}
              {link.expires_at && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                  만료: {link.expires_at.slice(0, 10)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onCopy(link)}
                className="h-6 rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-700 hover:bg-gray-50"
              >
                복사
              </button>
              <button
                type="button"
                onClick={() => onRevoke(link.token)}
                data-testid="share-revoke-button"
                className="h-6 rounded border border-red-200 bg-red-50 px-2 text-[11px] font-medium text-red-700 hover:bg-red-100"
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InternalAccessTab() {
  return (
    <div
      className="space-y-3 text-xs text-gray-700 dark:text-gray-300"
      data-testid="share-tab-internal-panel"
    >
      <p>
        사내 사용자는 자신의 권한 등급에 따라 이 문서에 접근합니다 — 별도의
        공유 설정 없이 로그인된 reader 이상 권한이면 본문을 열람할 수 있고,
        편집은 editor 이상이 가능합니다.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>reader</strong> — 모든 발행 문서 열람</li>
        <li><strong>editor</strong> — 문서 작성/수정</li>
        <li><strong>owner</strong> — 자신이 만든 문서 삭제</li>
        <li><strong>admin</strong> — 모든 권한</li>
      </ul>
      <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
        사내 권한은 보기 전용입니다. 권한 변경은 관리자 페이지에서 수행하세요.
      </p>
    </div>
  )
}
