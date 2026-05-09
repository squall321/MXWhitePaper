import { useState } from 'react'
import { sendVerificationEmail } from '@/features/auth/api'
import { useAuthStore } from '@/features/auth/store'

/**
 * Small banner shown at the top of the AppShell main column whenever the
 * logged-in user hasn't clicked through their verification email yet.
 * Cycle 0026.
 *
 * Renders nothing if the user is missing or already verified.
 * Local "dismiss" state hides the banner for the current session if the
 * user clicks 닫기 — they'll see it again on next load.
 */
export function EmailVerifyBanner() {
  const user = useAuthStore((s) => s.user)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  if (!user) return null
  if (user.email_verified_at) return null
  if (hidden) return null

  const onResend = async () => {
    setBusy(true)
    setNote(null)
    try {
      await sendVerificationEmail()
      setNote('인증 메일을 보냈습니다. 메일함을 확인해주세요.')
    } catch {
      setNote('메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="status"
      data-testid="email-verify-banner"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <span className="flex-1">
        이메일을 인증하세요 — {user.email} 로 발송된 메일에서 링크를 클릭해 주세요.
      </span>
      <button
        type="button"
        onClick={onResend}
        disabled={busy}
        data-testid="email-verify-banner-resend"
        className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
      >
        {busy ? '보내는 중…' : '인증 메일 다시 보내기'}
      </button>
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label="배너 닫기"
        className="text-amber-700 hover:text-amber-900"
      >
        ×
      </button>
      {note && (
        <span className="basis-full pt-1 text-[11px] text-amber-800">{note}</span>
      )}
    </div>
  )
}
