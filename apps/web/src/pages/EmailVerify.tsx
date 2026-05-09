import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { sendVerificationEmail, verifyEmailToken } from '@/features/auth/api'
import { Button, Card } from '@/components/ui'

type Status = 'pending' | 'success' | 'error'

/**
 * /auth/verify?token=… — landing page for the email verification link.
 * Cycle 0026.
 *
 * On mount: POSTs the token to the BE. Shows a success or failure card
 * with a "resend" button (which only works if the user is logged in —
 * the BE endpoint requires auth and uses the caller's email).
 */
export function EmailVerifyPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [status, setStatus] = useState<Status>('pending')
  const [resending, setResending] = useState(false)
  const [resendNote, setResendNote] = useState<string | null>(null)
  const fired = useRef(false)

  useEffect(() => {
    // StrictMode double-invokes effects; guard so we don't double-consume.
    if (fired.current) return
    fired.current = true
    if (!token) {
      setStatus('error')
      return
    }
    verifyEmailToken(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'))
  }, [token])

  const onResend = async () => {
    setResending(true)
    setResendNote(null)
    try {
      await sendVerificationEmail()
      setResendNote('새 인증 메일을 보냈습니다. 메일함을 확인해주세요.')
    } catch {
      setResendNote('인증 메일을 다시 보내려면 먼저 로그인해주세요.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <Card padded="lg">
        <h1 className="text-base font-semibold">이메일 인증</h1>
        {status === 'pending' && (
          <p className="mt-3 text-sm text-gray-600" role="status">
            인증 중입니다…
          </p>
        )}
        {status === 'success' && (
          <div className="mt-3 space-y-3" data-testid="verify-success">
            <p className="text-sm text-emerald-700">✅ 인증 완료</p>
            <p className="text-xs text-gray-600">
              이메일 주소가 확인되었습니다. 이제 모든 기능을 사용할 수 있어요.
            </p>
            <div className="pt-2">
              <Link
                to="/"
                className="text-xs font-medium text-link hover:underline"
              >
                홈으로 이동
              </Link>
            </div>
          </div>
        )}
        {status === 'error' && (
          <div className="mt-3 space-y-3" data-testid="verify-error">
            <p className="text-sm text-red-700">
              ❌ 토큰이 만료되었거나 유효하지 않습니다
            </p>
            <p className="text-xs text-gray-600">
              인증 메일을 다시 받으려면 아래 버튼을 눌러주세요. (로그인 후 가능)
            </p>
            <Button
              type="button"
              size="sm"
              loading={resending}
              disabled={resending}
              onClick={onResend}
              data-testid="verify-resend"
            >
              인증 메일 다시 받기
            </Button>
            {resendNote && (
              <p className="text-xs text-gray-700" role="status">
                {resendNote}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
