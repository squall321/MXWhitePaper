import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { forgotPassword } from '@/features/auth/api'
import { Button, Card, Field, Input } from '@/components/ui'

const schema = z.object({
  email: z.string().email('이메일 형식이 아닙니다'),
})
type FormValues = z.infer<typeof schema>

/**
 * /auth/forgot — request a password-reset email. Cycle 0026.
 *
 * The BE always returns 200 to avoid leaking which addresses are
 * registered, so this page does the same: regardless of whether the
 * email matched, we show "메일을 보냈습니다 (계정이 있다면)".
 */
export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await forgotPassword(values.email)
    } catch {
      // Even if the network call fails the user-facing message stays
      // identical — no enumeration leak.
    } finally {
      setSubmitted(true)
    }
  })

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <Card padded="lg">
        <h1 className="text-base font-semibold">비밀번호 재설정</h1>
        {submitted ? (
          <div className="mt-3 space-y-3" data-testid="forgot-submitted">
            <p className="text-sm text-emerald-700">
              메일을 보냈습니다 (계정이 있다면).
            </p>
            <p className="text-xs text-gray-600">
              메일함에서 재설정 링크를 확인하세요. 링크는 15분 동안 유효합니다.
            </p>
            <div className="pt-2">
              <Link to="/login" className="text-xs font-medium text-link hover:underline">
                로그인으로 돌아가기
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-3 space-y-3" onSubmit={onSubmit}>
            <p className="text-xs text-gray-600">
              가입 시 사용한 이메일 주소를 입력하세요. 재설정 링크를 보내드립니다.
            </p>
            <Field label="이메일" htmlFor="forgot-email" error={errors.email?.message}>
              <Input
                id="forgot-email"
                data-testid="forgot-email"
                type="email"
                autoComplete="username"
                placeholder="name@samsung.com"
                invalid={!!errors.email}
                {...register('email')}
              />
            </Field>
            <Button
              type="submit"
              data-testid="forgot-submit"
              loading={isSubmitting}
              disabled={isSubmitting}
              fullWidth
              size="md"
            >
              재설정 링크 보내기
            </Button>
            <div className="pt-1">
              <Link to="/login" className="text-xs text-link hover:underline">
                로그인으로 돌아가기
              </Link>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
