import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { login } from '@/features/auth/api'
import { Button, Card, Field, Input } from '@/components/ui'

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
 * Login page. react-hook-form + zod for validation. On success, redirects
 * to the `?return=...` URL or `/`. Dev mode pre-fills the form with the
 * documented seed credentials.
 *
 * Visual: full-bleed Samsung Blue gradient backdrop, centered card with the
 * MX badge, "최근 로그인 ID 기억" toggle, and a stub "비밀번호를 잊으셨나요?" link.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const returnTo = params.get('return') ?? '/'
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: import.meta.env.DEV ? DEV_DEFAULTS : { email: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      await login(values.email, values.password)
      navigate(returnTo, { replace: true })
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setSubmitError(
        status === 401 ? '이메일 또는 비밀번호가 올바르지 않습니다.' : '로그인 중 오류가 발생했습니다.',
      )
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
          <h1 className="text-xl font-semibold text-white">White Paper</h1>
          <p className="text-xs text-white/70">사내 백서 시스템</p>
        </div>

        <Card padded="lg" className="bg-white/95 backdrop-blur-sm">
          <h2 className="mb-1 text-base font-semibold text-smsg-900">로그인</h2>
          <p className="mb-5 text-xs text-gray-500">사내 계정으로 로그인하세요.</p>

          <form className="space-y-4" onSubmit={onSubmit}>
            <Field label="이메일" htmlFor="login-email" error={errors.email?.message}>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                placeholder="name@samsung.com"
                invalid={!!errors.email}
                {...register('email')}
              />
            </Field>

            <Field label="비밀번호" htmlFor="login-password" error={errors.password?.message}>
              <Input
                id="login-password"
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
                최근 로그인 ID 기억
              </label>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="text-xs text-link hover:underline"
              >
                비밀번호를 잊으셨나요?
              </a>
            </div>

            {submitError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {submitError}
              </p>
            )}

            <Button type="submit" loading={isSubmitting} fullWidth size="md">
              로그인
            </Button>

            {import.meta.env.DEV && (
              <p className="pt-2 text-[11px] text-gray-500">
                dev: <code>admin@mx.local</code> / <code>admin1234!</code> ·{' '}
                <Link className="underline" to="/?dev">?dev 우회</Link>
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
