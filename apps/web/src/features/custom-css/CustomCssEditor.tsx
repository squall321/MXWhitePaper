import { useMemo, useState } from 'react'

import { isPreconditionFailed, patchCustomCss } from '@/features/editor/api'
import type { Slug } from '@/types/document'

const MAX_LEN = 10_000

export interface CustomCssEditorProps {
  slug: Slug
  /** Current persisted CSS (may be empty). */
  initialCss: string
  /** ETag for the optimistic-concurrency PATCH. */
  etag: string
  /** Called after a successful save (so the parent can refresh state). */
  onSaved?: (next: { customCss: string; etag: string; warnings: string[] }) => void
}

/**
 * Per-doc custom CSS editor (cycle 18).
 *
 * Admin-only because custom CSS can break the entire rendered page if
 * misused (no scoping). The route guard owns the role check; this
 * component just renders the textarea + live iframe preview.
 *
 * The preview mounts the textarea contents inside a sandboxed iframe via
 * ``srcdoc`` so any (sanitized) CSS only repaints inside the frame and
 * can't leak into the SPA chrome. The actual save calls ``PATCH
 * /documents/:slug/custom-css`` which re-sanitizes server-side and
 * returns the cleaned text + warnings.
 */
export function CustomCssEditor({
  slug,
  initialCss,
  etag,
  onSaved,
}: CustomCssEditorProps) {
  const [css, setCss] = useState(initialCss)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const tooLong = css.length > MAX_LEN

  // Build a tiny preview document. Using `srcdoc` keeps the preview
  // self-contained — no network, no SPA leak, and the browser ignores
  // anything in <style> that doesn't parse so partially-broken admin
  // CSS surfaces visually instead of throwing.
  const previewDoc = useMemo(() => {
    const safe = css.replace(/<\/style>/gi, '<\\/style>')
    return [
      '<!DOCTYPE html><html><head><meta charset="UTF-8">',
      '<style>',
      'body{font-family:Pretendard,system-ui,sans-serif;color:#0f172a;padding:16px;}',
      '.doc-title{font-size:24px;font-weight:700;color:#0a1657;}',
      '.doc-summary{color:#334155;}',
      '.b-callout{border-left:4px solid #1f3aa8;padding:10px 14px;background:#eef1fb;margin:8px 0;}',
      '</style>',
      '<style data-mxwp-custom-css="1">',
      safe,
      '</style></head><body>',
      '<h1 class="doc-title">미리보기 — 브랜드 CSS 적용</h1>',
      '<p class="doc-summary">관리자 전용 사용자 정의 CSS의 시각적 결과를 확인하세요.</p>',
      '<div class="b-callout"><strong>알림</strong> · 콜아웃은 이런 식으로 보입니다.</div>',
      '<p>본문 단락 예시입니다. <a href="#">링크 색</a>도 확인하세요.</p>',
      '</body></html>',
    ].join('\n')
  }, [css])

  const onSave = async () => {
    if (!etag) return
    if (tooLong) return
    setSaveErr(null)
    setSaving(true)
    try {
      const result = await patchCustomCss(slug, css, etag, 'custom_css 갱신')
      setCss(result.customCss)
      setWarnings(result.warnings)
      onSaved?.({
        customCss: result.customCss,
        etag: result.etag,
        warnings: result.warnings,
      })
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setSaveErr('다른 사용자가 먼저 저장했습니다. 새로 고침 후 다시 시도하세요.')
      } else {
        setSaveErr('저장에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3" data-testid="custom-css-editor">
      <div
        className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"
        role="note"
      >
        <strong>주의:</strong> 이 CSS는 <em>전체 렌더링 페이지</em>에 적용됩니다.
        선택자가 너무 광범위하면 사이트 전체 레이아웃이 깨질 수 있습니다. 관리자
        전용 기능입니다.
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label
            htmlFor="custom-css-textarea"
            className="block text-xs font-semibold text-gray-700"
          >
            사용자 정의 CSS ({css.length.toLocaleString()} / {MAX_LEN.toLocaleString()})
          </label>
          <textarea
            id="custom-css-textarea"
            data-testid="custom-css-textarea"
            value={css}
            onChange={(e) => setCss(e.target.value)}
            rows={18}
            spellCheck={false}
            className="block h-80 w-full resize-y rounded border border-gray-300 p-2 font-mono text-xs focus:border-smsg-500 focus:outline-none focus:ring-2 focus:ring-smsg-300"
            placeholder=".doc-title { color: #1428a0; font-weight: 700; }"
          />
          {tooLong && (
            <p className="text-xs text-error" role="alert">
              CSS가 {MAX_LEN.toLocaleString()}자를 초과합니다.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <span className="block text-xs font-semibold text-gray-700">
            실시간 미리보기
          </span>
          <iframe
            data-testid="custom-css-preview"
            title="custom-css-preview"
            srcDoc={previewDoc}
            sandbox=""
            className="h-80 w-full rounded border border-gray-300 bg-white"
          />
        </div>
      </div>

      {warnings.length > 0 && (
        <div
          className="rounded border border-orange-300 bg-orange-50 p-3 text-xs text-orange-800"
          role="status"
          data-testid="custom-css-warnings"
        >
          <strong>일부 패턴이 제거되었습니다:</strong> {warnings.join(', ')}
        </div>
      )}

      {saveErr && (
        <p className="text-xs text-error" role="alert" data-testid="custom-css-error">
          {saveErr}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || !etag || tooLong}
          data-testid="custom-css-save"
          className="inline-flex h-8 items-center rounded-md bg-smsg-700 px-3 text-xs font-semibold text-white disabled:opacity-40"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={() => setCss('')}
          disabled={saving}
          data-testid="custom-css-clear"
          className="inline-flex h-8 items-center rounded-md border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          비우기
        </button>
      </div>
    </div>
  )
}
