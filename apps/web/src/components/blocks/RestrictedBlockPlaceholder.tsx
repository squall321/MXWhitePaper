import { useState } from 'react'

/**
 * RestrictedBlockPlaceholder — shown in place of a block when the current
 * user's role is below the block's required `meta.permission`.
 *
 * The block content itself is never rendered (or is replaced server-side
 * with a redacted stub for non-admins; see document_service.scrub_blocks).
 * This component only conveys *that* a block exists at this position and
 * is hidden, not the contents.
 *
 * Click the lock icon to surface a tooltip explaining the policy.
 */
export interface RestrictedBlockPlaceholderProps {
  /** The required permission level — used in the explanatory tooltip. */
  required?: 'editor' | 'admin'
}

export function RestrictedBlockPlaceholder({
  required = 'editor',
}: RestrictedBlockPlaceholderProps) {
  const [showTip, setShowTip] = useState(false)
  const requiredLabel = required === 'admin' ? '관리자' : '편집자/관리자'
  const message = '🔒 권한이 부족하여 표시되지 않습니다 (요구: editor/admin)'
  const ariaLabel = `권한이 부족하여 표시되지 않는 블록입니다. 요구 권한: ${requiredLabel}`

  return (
    <div
      role="note"
      aria-label={ariaLabel}
      data-testid="restricted-block-placeholder"
      data-required={required}
      className="my-2 flex items-center gap-2 rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
    >
      <button
        type="button"
        aria-label="권한 정책 설명 보기"
        onClick={() => setShowTip((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800"
      >
        <span aria-hidden>🔒</span>
      </button>
      <span>{message}</span>
      {showTip && (
        <span
          role="tooltip"
          className="ml-2 rounded bg-gray-800 px-2 py-1 text-xs text-white"
        >
          {`이 블록은 ${requiredLabel} 권한이 있어야 표시됩니다.`}
        </span>
      )}
    </div>
  )
}
