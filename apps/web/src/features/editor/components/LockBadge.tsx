import { useState, useRef, useEffect, useCallback } from 'react'
import type { Block, Slug } from '@/types/document'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'

/**
 * LockBadge — a tiny lock icon overlay rendered on a block in editor mode
 * that lets the author set `meta.permission` ('all' | 'editor' | 'admin').
 *
 * Mounted by `BlockRenderer` as a sibling to the block's content so we don't
 * touch BlockHoverInserter (concurrently edited by other agents). Click
 * toggles a small popover with three radio-like options.
 */
type Permission = 'all' | 'editor' | 'admin'

const OPTIONS: { value: Permission; label: string }[] = [
  { value: 'all', label: '모두' },
  { value: 'editor', label: '편집자 이상' },
  { value: 'admin', label: '관리자만' },
]

interface Props {
  slug: Slug
  block: Block
}

export function LockBadge({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current: Permission = block.meta?.permission ?? 'all'

  const onPick = useCallback(
    async (value: Permission) => {
      setOpen(false)
      if (value === current) return
      const tag = etag
      if (!tag) return
      // Build a full-block payload — BE patch_block does full replacement.
      // We only mutate `meta.permission`; everything else is preserved.
      const nextMeta = { ...(block.meta ?? {}), permission: value }
      const next = { ...block, meta: nextMeta } as Block
      try {
        const result = await patchBlock(slug, block.id, next, tag, '블록 권한 변경')
        apply(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      }
    },
    [current, etag, slug, block, apply, setConflict],
  )

  const isRestricted = current !== 'all'

  return (
    <div ref={ref} className="absolute -right-7 top-8 z-10" data-testid="lock-badge">
      <button
        type="button"
        aria-label={`블록 권한 설정 (현재: ${OPTIONS.find((o) => o.value === current)?.label ?? '모두'})`}
        title="블록 권한 설정"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs transition-colors ${
          isRestricted
            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200'
            : 'text-gray-400 opacity-0 group-hover/block:opacity-100 hover:bg-gray-100 hover:text-smsg-700 dark:hover:bg-gray-800'
        }`}
      >
        <span aria-hidden>{isRestricted ? '🔒' : '🔓'}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="이 블록의 권한"
          data-testid="lock-badge-popover"
          className="absolute right-0 top-7 w-44 rounded border border-gray-200 bg-white p-2 text-xs shadow-md dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-1 font-semibold text-gray-700 dark:text-gray-200">
            이 블록의 권한
          </div>
          <ul className="flex flex-col gap-1">
            {OPTIONS.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => void onPick(opt.value)}
                  aria-pressed={current === opt.value}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    current === opt.value ? 'font-semibold text-smsg-700' : 'text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <span>{opt.label}</span>
                  {current === opt.value && <span aria-hidden>✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
