import { useEffect, useRef, useState } from 'react'
import type { CodeBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  block: CodeBlock
}

const LANGUAGES = [
  'text',
  'typescript',
  'javascript',
  'python',
  'sql',
  'json',
  'yaml',
  'bash',
  'go',
  'rust',
  'java',
  'kotlin',
  'css',
  'html',
  'markdown',
] as const

/**
 * CodeBlockEditor — language dropdown + filename + monospace textarea.
 * Saves debounced (800 ms) so we don't flood the BE per keystroke.
 *
 * Tab inside the textarea inserts two spaces — the user expects code-editor
 * behaviour, not focus-leave.
 */
export function CodeBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<CodeBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLocal(block)
  }, [block])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const schedule = (next: CodeBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: CodeBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          code: next.code,
          language: next.language,
          filename: next.filename,
        },
        etag,
        t('editor.code.changeLog'),
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError(t('editor.common.conflict'))
      } else {
        setError((err as Error).message)
      }
    }
  }

  const onTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const before = local.code.slice(0, start)
      const after = local.code.slice(end)
      const next = `${before}  ${after}`
      schedule({ ...local, code: next })
      // Restore caret position next tick.
      window.requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }

  return (
    <div
      data-code-block-editor
      data-block-id={block.id}
      className="my-3 overflow-hidden rounded-md border border-gray-200 bg-gray-900 text-gray-100 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 bg-gray-800 px-2 py-1.5 text-xs">
        <select
          aria-label={t('editor.code.language')}
          value={local.language || 'text'}
          onChange={(e) => schedule({ ...local, language: e.target.value })}
          className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-smsg-300"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={local.filename ?? ''}
          onChange={(e) =>
            schedule({ ...local, filename: e.target.value || undefined })
          }
          placeholder={t('editor.code.filenamePlaceholder')}
          aria-label={t('editor.code.filename')}
          className="flex-1 min-w-[120px] rounded border border-transparent bg-transparent px-1 py-0.5 text-gray-300 placeholder:text-gray-500 hover:border-gray-700 focus:border-smsg-500 focus:bg-gray-900 focus:outline-none"
        />
        {error && (
          <span role="status" aria-live="polite" className="text-[11px] text-red-300">{error}</span>
        )}
      </div>
      <textarea
        value={local.code}
        onChange={(e) => schedule({ ...local, code: e.target.value })}
        onKeyDown={onTabKey}
        rows={Math.max(6, Math.min(24, local.code.split('\n').length + 1))}
        aria-label={t('editor.code.codeLabel')}
        spellCheck={false}
        className="block w-full resize-y border-0 bg-gray-900 p-3 font-mono text-[13px] leading-6 text-gray-100 outline-none focus:bg-gray-950"
      />
    </div>
  )
}
