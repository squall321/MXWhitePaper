import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { login } from '@/features/auth/api'
import { useAuthStore } from '@/features/auth/store'
import { Button, Card, Field, Input } from '@/components/ui'
import { useLocale } from '@/lib/i18n'

const loginSchema = z.object({
  email: z.string().email('이메일 형식이 아닙니다'),
  password: z.string().min(6, '비밀번호는 6자 이상'),
})

type LoginInput = z.infer<typeof loginSchema>

const DEV_DEFAULTS: LoginInput = {
  email: 'admin@mx.local',
  password: 'admin1234!',
}

/**
 * Reject anything that could send the user off-site (open-redirect guard).
 * We only allow same-origin paths starting with a single `/`.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw) return '/'
  // protocol-relative or absolute URLs → unsafe
  if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return '/'
  if (!raw.startsWith('/')) return '/'
  return raw
}

/**
 * Login page. react-hook-form + zod for validation. On success, redirects
 * to the `?return=...` URL or `/`. Dev mode pre-fills the form with the
 * documented seed credentials.
 *
 * Visual: full-bleed Samsung Blue gradient backdrop, centered card with the
 * MX badge, "최근 로그인 ID 기억" toggle, and a stub "비밀번호를 잊으셨나요?" link.
 */
export function LoginPage() {
  const { t } = useLocale()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const returnTo = safeReturnPath(params.get('return'))
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)
  const user = useAuthStore((s) => s.user)
  const hydrating = useAuthStore((s) => s.hydrating)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: import.meta.env.DEV ? DEV_DEFAULTS : { email: '', password: '' },
  })

  // Already logged-in users shouldn't see the login form. Wait for the
  // hydration probe to finish so we don't bounce a returning user back to
  // the saved `?return=` path with a stale (cookie-less) state.
  useEffect(() => {
    if (!hydrating && user) {
      navigate(returnTo, { replace: true })
    }
  }, [hydrating, user, returnTo, navigate])

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      await login(values.email, values.password)
      navigate(returnTo, { replace: true })
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: { message?: string } } } }
      const status = e.response?.status
      if (status === 401) {
        setSubmitError('이메일 또는 비밀번호가 올바르지 않습니다.')
      } else if (status === 403) {
        setSubmitError('계정이 비활성화되었습니다. 관리자에게 문의하세요.')
      } else if (status === 429) {
        setSubmitError('너무 많은 시도가 감지되었습니다. 잠시 후 다시 시도하세요.')
      } else if (status == null) {
        // Network / CORS / DNS — axios couldn't get a response at all.
        setSubmitError('서버에 연결할 수 없습니다. 관리자에게 문의하세요.')
      } else {
        const msg = e.response?.data?.error?.message
        setSubmitError(msg ?? '로그인 중 오류가 발생했습니다.')
      }
    }
  })

  return (
    <div
      className="relative min-h-screen overflow-hidden px-4 py-10 sm:py-16"
      style={{
        background:
          'radial-gradient(circle at 20% 0%, rgba(46,91,255,.25), transparent 40%),' +
          'radial-gradient(circle at 80% 100%, rgba(10,31,143,.35), transparent 50%),' +
          'linear-gradient(135deg, #0A1F8F 0%, #1428A0 60%, #2E5BFF 100%)',
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent)]">
        <Pattern />
      </div>

      <div className="relative mx-auto max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="rounded-md bg-white px-3 py-1.5 text-base font-bold text-smsg-700 shadow-md">
            MX
          </span>
          <h1 className="text-xl font-semibold text-white">{t('login.title')}</h1>
          <p className="text-xs text-white/70">{t('login.subtitle')}</p>
        </div>

        <Card padded="lg" className="bg-white/95 backdrop-blur-sm dark:bg-gray-900/95">
          <h2 className="mb-1 text-base font-semibold text-smsg-900 dark:text-gray-100">{t('login.heading')}</h2>
          <p className="mb-5 text-xs text-gray-500 dark:text-gray-400">{t('login.helper')}</p>

          <form className="space-y-4" onSubmit={onSubmit}>
            <Field label={t('login.email')} htmlFor="login-email" error={errors.email?.message}>
              <Input
                id="login-email"
                data-testid="login-email"
                type="email"
                autoComplete="username"
                placeholder="name@samsung.com"
                invalid={!!errors.email}
                {...register('email')}
              />
            </Field>

            <Field label={t('login.password')} htmlFor="login-password" error={errors.password?.message}>
              <Input
                id="login-password"
                data-testid="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                invalid={!!errors.password}
                {...register('password')}
              />
            </Field>

            <div className="flex items-center justify-between">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-smsg-700 focus:ring-smsg-500"
                />
                {t('login.remember')}
              </label>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="text-xs text-link hover:underline"
              >
                {t('login.forgot')}
              </a>
            </div>

            {submitError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {submitError}
              </p>
            )}

            <Button
              type="submit"
              data-testid="login-submit"
              loading={isSubmitting}
              disabled={isSubmitting}
              fullWidth
              size="md"
            >
              {isSubmitting ? t('login.submitting') : t('login.submit')}
            </Button>

            {import.meta.env.DEV && (
              <p className="pt-2 text-[11px] text-gray-500">
                dev: <code>admin@mx.local</code> / <code>admin1234!</code> ·{' '}
                <Link className="underline" to="/?dev">?dev 우회</Link>
                <br />
                <span className="text-gray-400">
                  (?dev는 인증 없이 admin 데이터를 그대로 노출합니다 — 개발용)
                </span>
              </p>
            )}
          </form>
        </Card>

        <p className="mt-4 text-center text-[11px] text-white/70">
          © Samsung MX · 문서는 사내 전용입니다.
        </p>
      </div>
    </div>
  )
}

function Pattern() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="dot-pattern" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="#fff" opacity="0.6" />
        </pattern>
      </defs>
      <rect width="600" height="600" fill="url(#dot-pattern)" />
    </svg>
  )
}
