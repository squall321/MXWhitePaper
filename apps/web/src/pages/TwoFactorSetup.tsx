import { useState } from 'react'
import { Button, Card, Field, Input } from '@/components/ui'
import { generateQrSvg } from '@/lib/qr'
import {
  setupTotp,
  verifyTotpSetup,
  type TotpSetupResponse,
} from '@/features/auth/totpApi'

type Stage = 'password' | 'qr' | 'done'

/**
 * `/me/2fa` — TOTP setup wizard (Cycle 17).
 *
 * Flow:
 *   1. User confirms password → BE returns staged secret + 8 backup codes.
 *   2. We render the otpauth URL via the existing `generateQrSvg` fallback
 *      panel (it draws the URL as readable text inside an SVG; a real QR
 *      encoder is a follow-up). User scans / pastes into Google
 *      Authenticator.
 *   3. User types the first 6-digit code → BE persists the secret and
 *      argon2-hashes the backup codes. We show a "done" panel.
 *
 * Backup codes are revealed exactly once — we render them in a copyable
 * textarea with a Korean warning that they will not be shown again.
 */
export function TwoFactorSetupPage() {
  const [stage, setStage] = useState<Stage>('password')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [setupData, setSetupData] = useState<TotpSetupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onConfirmPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!password) {
      setError('비밀번호를 입력하세요')
      return
    }
    setSubmitting(true)
    try {
      const data = await setupTotp(password)
      setSetupData(data)
      setStage('qr')
    } catch (err) {
      const e = err as { response?: { status?: number } }
      if (e.response?.status === 401) {
        setError('비밀번호가 올바르지 않습니다.')
      } else {
        setError('2FA 설정을 시작할 수 없습니다.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!setupData) return
    if (!/^\d{6}$/.test(code.trim())) {
      setError('6자리 숫자 코드를 입력하세요')
      return
    }
    setSubmitting(true)
    try {
      await verifyTotpSetup(setupData.stage_token, code.trim())
      setStage('done')
    } catch (err) {
      const e = err as {
        response?: { status?: number; data?: { error?: { code?: string } } }
      }
      if (e.response?.status === 422) {
        setError('코드가 일치하지 않습니다. 1분 안에 다시 시도하세요.')
      } else if (e.response?.status === 401) {
        setError('인증 토큰이 만료되었습니다. 처음부터 다시 시작하세요.')
        setStage('password')
        setSetupData(null)
        setPassword('')
      } else {
        setError('코드 검증 중 오류가 발생했습니다.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="mx-auto max-w-xl px-4 py-10"
      data-testid="totp-setup-page"
    >
      <header className="mb-6">
        <h1 className="text-xl font-bold text-smsg-900">2단계 인증 (TOTP)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Google Authenticator / Authy 같은 OTP 앱과 연결해 로그인 시 6자리 코드를
          추가로 요구합니다.
        </p>
      </header>

      {stage === 'password' && (
        <Card padded="lg">
          <h2 className="text-base font-semibold">1. 비밀번호 확인</h2>
          <p className="mb-4 mt-1 text-xs text-gray-600">
            본인 확인을 위해 현재 비밀번호를 입력하세요.
          </p>
          <form className="space-y-3" onSubmit={onConfirmPassword}>
            <Field label="비밀번호" htmlFor="totp-password" error={error ?? undefined}>
              <Input
                id="totp-password"
                data-testid="totp-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={!!error}
              />
            </Field>
            <Button
              type="submit"
              data-testid="totp-password-submit"
              loading={submitting}
              disabled={submitting}
              fullWidth
            >
              계속
            </Button>
          </form>
        </Card>
      )}

      {stage === 'qr' && setupData && (
        <Card padded="lg">
          <h2 className="text-base font-semibold">2. OTP 앱에 등록</h2>
          <p className="mb-4 mt-1 text-xs text-gray-600">
            아래 QR 코드를 Google Authenticator / Authy 로 스캔하거나, 시크릿
            키를 직접 붙여 넣으세요.
          </p>

          <div
            className="mx-auto my-3 max-w-[280px] rounded border border-gray-200 bg-white p-2"
            data-testid="totp-qr"
            // generateQrSvg returns inert SVG markup we control fully.
            dangerouslySetInnerHTML={{
              __html: generateQrSvg(setupData.qr_uri, 240),
            }}
          />

          <Field label="시크릿 (수동 입력용)" htmlFor="totp-secret">
            <Input
              id="totp-secret"
              data-testid="totp-secret"
              readOnly
              value={setupData.secret}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          </Field>

          <h3 className="mt-6 text-sm font-semibold">백업 코드</h3>
          <p className="mt-1 text-xs text-amber-700">
            이 코드들은 다시 보이지 않습니다. 휴대폰 분실에 대비해 안전한
            곳에 저장하세요. 각 코드는 1회만 사용할 수 있습니다.
          </p>
          <textarea
            data-testid="totp-backup-codes"
            readOnly
            value={setupData.backup_codes.join('\n')}
            rows={setupData.backup_codes.length}
            className="mt-2 w-full rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />

          <h3 className="mt-6 text-sm font-semibold">3. 첫 코드 입력</h3>
          <form className="mt-2 space-y-3" onSubmit={onVerify}>
            <Field
              label="6자리 인증 코드"
              htmlFor="totp-code"
              error={error ?? undefined}
            >
              <Input
                id="totp-code"
                data-testid="totp-code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                invalid={!!error}
              />
            </Field>
            <Button
              type="submit"
              data-testid="totp-verify-submit"
              loading={submitting}
              disabled={submitting}
              fullWidth
            >
              2FA 활성화
            </Button>
          </form>
        </Card>
      )}

      {stage === 'done' && (
        <Card padded="lg" data-testid="totp-done">
          <h2 className="text-base font-semibold text-emerald-700">
            ✅ 2FA 가 활성화되었습니다
          </h2>
          <p className="mt-2 text-sm text-gray-700">
            다음 로그인부터 OTP 앱의 6자리 코드 (또는 백업 코드) 가 필요합니다.
          </p>
        </Card>
      )}
    </div>
  )
}
