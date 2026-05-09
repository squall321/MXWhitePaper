import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword } from '@/features/auth/api'
import { Button, Card, Field, Input } from '@/components/ui'

const schema = z
  .object({
    new_password: z.string().min(8, '비밀번호는 8자 이상'),
    confirm: z.string().min(8, '비밀번호는 8자 이상'),
  })
  .refine((v) => v.new_password === v.confirm, {
    message: '비밀번호가 일치하지 않습니다',
    path: ['confirm'],
  })

type FormValues = z.infer<typeof schema>

/**
 * /auth/reset?token=… — set a new password using a reset token.
 * Cycle 0026. Redirects to /login on success.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    if (!token) {
      setSubmitError('재설정 토큰이 없습니다. 메일의 링크에서 다시 시도해주세요.')
      return
    }
    try {
      await resetPassword(token, values.new_password)
      navigate('/login', { replace: true })
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: { message?: string } } } }
      const status = e.response?.status
      if (status === 401) {
        setSubmitError('토큰이 만료되었거나 유효하지 않습니다.')
      } else if (status === 422) {
        setSubmitError(e.response?.data?.error?.message ?? '비밀번호 형식이 올바르지 않습니다.')
      } else {
        setSubmitError('비밀번호 재설정 중 오류가 발생했습니다.')
      }
    }
  })

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <Card padded="lg">
        <h1 className="text-base font-semibold">새 비밀번호 설정</h1>
        <form className="mt-3 space-y-3" onSubmit={onSubmit}>
          <Field
            label="새 비밀번호"
            htmlFor="reset-password"
            error={errors.new_password?.message}
          >
            <Input
              id="reset-password"
              data-testid="reset-password"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.new_password}
              {...register('new_password')}
            />
          </Field>
          <Field
            label="비밀번호 확인"
            htmlFor="reset-confirm"
            error={errors.confirm?.message}
          >
            <Input
              id="reset-confirm"
              data-testid="reset-confirm"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.confirm}
              {...register('confirm')}
            />
          </Field>

          {submitError && (
            <p
              role="alert"
              data-testid="reset-error"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {submitError}
            </p>
          )}

          <Button
            type="submit"
            data-testid="reset-submit"
            loading={isSubmitting}
            disabled={isSubmitting}
            fullWidth
            size="md"
          >
            비밀번호 변경
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
