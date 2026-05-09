import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuthStore } from '@/features/auth/store'
import { CustomCssEditor } from '@/features/custom-css/CustomCssEditor'
import { useDocument } from '@/features/document/hooks/useDocument'

/**
 * Admin-only "고급 → 사용자 정의 CSS" page (cycle 18).
 *
 * Wraps the {@link CustomCssEditor} in a centered container and gates the
 * route by ``user.role === 'admin'``. Even editor role gets a 403-style
 * notice — custom CSS can break the entire rendered page so the route
 * guard is more conservative than ``require_editor``.
 */
export function DocumentCustomCssPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.user?.role)
  const { data, isPending, isError } = useDocument(slug)
  const [etag, setEtag] = useState<string | undefined>(undefined)

  if (isPending) return <p className="text-sm text-gray-500">불러오는 중…</p>
  if (isError || !data || !slug) {
    return <p className="text-sm text-error">문서를 불러올 수 없습니다.</p>
  }
  if (role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl space-y-2 p-4">
        <h1 className="text-lg font-semibold">접근 거부</h1>
        <p className="text-sm text-gray-600">
          사용자 정의 CSS 편집은 관리자(admin) 전용 기능입니다.
        </p>
      </div>
    )
  }

  const initialCss = data.document.custom_css ?? ''
  const currentEtag = etag ?? data.meta.etag ?? ''

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4" data-testid="doc-custom-css">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          사용자 정의 CSS — {data.document.title}
        </h1>
        <button
          type="button"
          onClick={() => navigate(`/docs/${encodeURIComponent(slug)}`)}
          className="text-xs text-gray-600 hover:underline"
        >
          돌아가기
        </button>
      </header>

      <CustomCssEditor
        slug={slug}
        initialCss={initialCss}
        etag={currentEtag}
        onSaved={(next) => setEtag(next.etag)}
      />
    </div>
  )
}
