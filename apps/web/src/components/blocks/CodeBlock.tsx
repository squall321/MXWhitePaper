import { useState } from 'react'
import type { CodeBlock } from '@/types/document'
import { useT } from '@/lib/i18n'

/**
 * Code block — dark surface with a copy button. Filename / language label
 * sits in the header strip; copy button is keyboard-accessible.
 *
 * COD-02 — clipboard 실패 시 silent 였던 catch 를 aria-live 알림으로 노출.
 * 브라우저가 navigator.clipboard 비지원이거나 보안 컨텍스트가 아닐 때
 * (http on intranet etc) 사용자가 복사 실패를 인지 못하던 갭 해소.
 */
export function CodeBlockView({ block }: { block: CodeBlock }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const onCopy = async () => {
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(block.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopyError(t('editor.code.copyFailed'))
      window.setTimeout(() => setCopyError(null), 3000)
    }
  }

  return (
    <figure className="group overflow-hidden rounded-md border border-gray-200 bg-gray-900 shadow-sm">
      <figcaption className="flex items-center justify-between border-b border-gray-800 bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
        <span className="flex items-center gap-2">
          <span className="font-mono uppercase tracking-wide text-smsg-300">
            {block.language || 'plain'}
          </span>
          {block.filename && (
            <span className="truncate text-gray-400">· {block.filename}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label="코드 복사"
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-gray-300 transition-all duration-fast hover:bg-white/10 hover:text-white focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              복사됨
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                <rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              복사
            </>
          )}
        </button>
      </figcaption>
      {copyError && (
        <div
          role="status"
          aria-live="polite"
          data-code-copy-error
          className="border-b border-amber-700/50 bg-amber-900/40 px-3 py-1 text-[11px] text-amber-100"
        >
          {copyError}
        </div>
      )}
      <pre data-no-swipe className="overflow-x-auto p-3 text-[13px] leading-6 text-gray-100">
        <code className="font-mono">{block.code}</code>
      </pre>
    </figure>
  )
}
