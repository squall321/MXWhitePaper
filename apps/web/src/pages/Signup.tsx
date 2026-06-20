import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { register as registerAccount } from '@/features/auth/api'
import { Button, Card, Field, Input } from '@/components/ui'

const schema = z.object({
  email: z.string().email('이메일 형식이 아닙니다'),
  name: z.string().min(1, '이름을 입력하세요'),
  password: z.string().min(12, '비밀번호는 12자 이상'),
})
type FormValues = z.infer<typeof schema>

/**
 * /signup — standalone self-signup fallback (used when portal SSO is
 * unavailable). On success the user is already logged in (the server sets
 * the refresh cookie + returns an access token), so we navigate straight
 * to '/'. Mirrors ForgotPassword.tsx / Login.tsx.
 */
export function SignupPage() {
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      await registerAccount(values.email, values.name, values.password)
      navigate('/', { replace: true })
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: { message?: string } } } }
      const status = e.response?.status
      if (status === 409) {
        setSubmitError('이미 가입된 이메일입니다. 로그인하거나 SSO를 사용하세요.')
      } else if (status === 422) {
        setSubmitError(e.response?.data?.error?.message ?? '입력값이 올바르지 않습니다.')
      } else if (status === 429) {
        setSubmitError('너무 많은 시도가 감지되었습니다. 잠시 후 다시 시도하세요.')
      } else if (status == null) {
        setSubmitError('서버에 연결할 수 없습니다. 관리자에게 문의하세요.')
      } else {
        setSubmitError(e.response?.data?.error?.message ?? '가입 중 오류가 발생했습니다.')
      }
    }
  })

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <Card padded="lg">
        <h1 className="text-base font-semibold">계정 만들기</h1>
        <form className="mt-3 space-y-3" onSubmit={onSubmit}>
          <p className="text-xs text-gray-600">
            이메일, 이름, 비밀번호로 계정을 만듭니다. 가입 후 바로 로그인됩니다.
          </p>
          <Field label="이메일" htmlFor="signup-email" error={errors.email?.message}>
            <Input
              id="signup-email"
              data-testid="signup-email"
              type="email"
              autoComplete="username"
              placeholder="name@samsung.com"
              invalid={!!errors.email}
              {...register('email')}
            />
          </Field>
          <Field label="이름" htmlFor="signup-name" error={errors.name?.message}>
            <Input
              id="signup-name"
              data-testid="signup-name"
              type="text"
              autoComplete="name"
              invalid={!!errors.name}
              {...register('name')}
            />
          </Field>
          <Field
            label="비밀번호"
            htmlFor="signup-password"
            error={errors.password?.message}
          >
            <Input
              id="signup-password"
              data-testid="signup-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••••••"
              invalid={!!errors.password}
              {...register('password')}
            />
          </Field>
          <p className="text-[11px] text-gray-500">
            비밀번호는 12자 이상이며 영문·숫자·특수문자를 각각 1개 이상 포함해야 합니다.
          </p>

          {submitError && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {submitError}
            </p>
          )}

          <Button
            type="submit"
            data-testid="signup-submit"
            loading={isSubmitting}
            disabled={isSubmitting}
            fullWidth
            size="md"
          >
            계정 만들기
          </Button>
          <div className="pt-1">
            <Link to="/login" className="text-xs text-link hover:underline">
              로그인으로 돌아가기
            </Link>
          </div>
        </form>
      </Card>
    </div>
  )
}
