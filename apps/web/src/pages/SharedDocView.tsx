import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  readSharedDocument,
  type SharedDocumentResult,
} from '@/features/sharing/api'
import { WikiArticle } from '@/components/WikiArticle'
import { ApiError } from '@/lib/api/envelope'

/**
 * Public read-only document view at `/share/:token`. Bypasses AuthGuard so
 * non-employees with a valid link can land here without logging in.
 *
 * Flow:
 *   - Mount: call `GET /share/:token` (no Authorization header).
 *   - 401 → render password prompt; resubmit with the typed value.
 *   - 410 / 404 → render the corresponding banner; no retry.
 *   - 200 → reuse `<WikiArticle>` (read-only — no editableSlug) with a
 *     yellow banner that surfaces the share metadata (expiry).
 *
 * No comments, no edit affordances, no slug listing.
 */
export function SharedDocViewPage() {
  const { token } = useParams<{ token: string }>()
  const [result, setResult] = useState<SharedDocumentResult | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorState, setErrorState] = useState<
    | null
    | { kind: 'gone'; message: string }
    | { kind: 'not-found' }
    | { kind: 'unknown'; message: string }
  >(null)

  const fetchOnce = async (password?: string) => {
    if (!token) return
    setSubmitting(true)
    try {
      const r = await readSharedDocument(token, password)
      setResult(r)
      setNeedsPassword(false)
      setErrorState(null)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'UNAUTHORIZED') {
          setNeedsPassword(true)
          setErrorState(null)
          if (password) {
            // Wrong password supplied — keep the prompt visible with an
            // error message so the user can retry.
            setErrorState({
              kind: 'unknown',
              message: '비밀번호가 일치하지 않습니다.',
            })
          }
          return
        }
        if (err.code === 'GONE') {
          setErrorState({ kind: 'gone', message: err.message })
          return
        }
        if (err.code === 'NOT_FOUND') {
          setErrorState({ kind: 'not-found' })
          return
        }
        setErrorState({ kind: 'unknown', message: err.message })
        return
      }
      setErrorState({ kind: 'unknown', message: (err as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    void fetchOnce()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (!token) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600">
        잘못된 공유 링크입니다.
      </div>
    )
  }

  if (errorState?.kind === 'not-found') {
    return (
      <div
        className="mx-auto max-w-3xl px-4 py-12 text-center"
        data-testid="shared-doc-not-found"
      >
        <h1 className="text-xl font-semibold text-smsg-900">
          존재하지 않는 공유 링크입니다.
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          링크가 잘못되었거나, 이미 삭제되었을 수 있습니다.
        </p>
      </div>
    )
  }

  if (errorState?.kind === 'gone') {
    return (
      <div
        className="mx-auto max-w-3xl px-4 py-12 text-center"
        data-testid="shared-doc-gone"
      >
        <h1 className="text-xl font-semibold text-smsg-900">
          더 이상 사용할 수 없는 링크입니다.
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          만료되었거나 작성자가 해제했습니다. ({errorState.message})
        </p>
      </div>
    )
  }

  if (needsPassword) {
    return (
      <div className="mx-auto max-w-md px-4 py-12" data-testid="shared-doc-password-prompt">
        <h1 className="mb-3 text-xl font-semibold text-smsg-900">
          비밀번호로 보호된 링크입니다
        </h1>
        <p className="mb-4 text-sm text-gray-600">
          이 공유 링크에는 비밀번호가 설정되어 있습니다. 작성자에게 받은 값을
          입력하세요.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void fetchOnce(passwordInput)
          }}
          className="space-y-3"
        >
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="비밀번호"
            data-testid="shared-doc-password-input"
            autoFocus
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-smsg-500 focus:outline-none focus:ring-2 focus:ring-smsg-100"
          />
          {errorState?.kind === 'unknown' && (
            <p className="text-xs text-red-600">{errorState.message}</p>
          )}
          <button
            type="submit"
            disabled={submitting || !passwordInput}
            data-testid="shared-doc-password-submit"
            className="h-9 w-full rounded bg-smsg-700 px-4 text-sm font-semibold text-white disabled:opacity-50 hover:bg-smsg-900"
          >
            {submitting ? '확인 중…' : '확인'}
          </button>
        </form>
      </div>
    )
  }

  if (errorState?.kind === 'unknown' && !needsPassword) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center" data-testid="shared-doc-error">
        <h1 className="text-xl font-semibold text-smsg-900">
          링크를 불러오지 못했습니다
        </h1>
        <p className="mt-2 text-sm text-gray-600">{errorState.message}</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-gray-500">
        불러오는 중…
      </div>
    )
  }

  const expiresLabel = result.share_meta.expires_at
    ? result.share_meta.expires_at.slice(0, 10)
    : '없음'

  return (
    <div className="mx-auto max-w-4xl px-4 py-6" data-testid="shared-doc-view">
      <div
        className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
        data-testid="shared-doc-banner"
      >
        공개 공유 링크로 접근 중 — 만료일: {expiresLabel}
        {result.share_meta.has_password ? ' · 🔒 비밀번호 보호됨' : ''}
      </div>
      <WikiArticle
        document={result.document}
        row={result.row}
        meta={{ updated_at: result.row.updated_at, etag: result.meta.etag }}
      />
    </div>
  )
}
