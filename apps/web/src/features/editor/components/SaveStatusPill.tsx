import { useEffect, useState } from 'react'
import { useEditorStore } from '../state'
import type { AutoSaveStatus } from '../state'

interface SaveStatusPillProps {
  /** Optional click handler (e.g., open ConflictMergeModal on conflict). */
  onClick?: () => void
  /** Text shown in place of "저장됨 ✓" right after Cmd+S. */
  manualLabel?: string | null
  /** Test override — when present skips the store read. */
  status?: AutoSaveStatus
  /** Test override — when present skips the store read. */
  dirty?: boolean
}

const PALETTE: Record<AutoSaveStatus | 'typing' | 'manual', string> = {
  idle: 'border-gray-200 bg-white text-gray-600',
  typing: 'border-gray-200 bg-gray-50 text-gray-600',
  saving: 'border-smsg-100 bg-smsg-100 text-smsg-700',
  saved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  error: 'border-red-200 bg-red-50 text-red-700',
  conflict: 'border-amber-300 bg-amber-50 text-amber-800',
  manual: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

/**
 * Save indicator pill that morphs through five states (idle / 입력 중… / 저장
 * 중… / 저장됨 ✓ / 충돌 ⚠ / 저장 실패 ✗). Auto-fades a `saved` flash after 1
 * second so it doesn't linger on screen.
 *
 * In production the pill subscribes to `useEditorStore`. The optional `status`
 * + `dirty` props exist purely so SSR-style tests (renderToStaticMarkup) can
 * dictate the desired state without depending on `useSyncExternalStore`'s
 * server-snapshot behaviour.
 */
export function SaveStatusPill({
  onClick,
  manualLabel,
  status: statusProp,
  dirty: dirtyProp,
}: SaveStatusPillProps) {
  const dirtyStore = useEditorStore((s) => s.dirty)
  const statusStore = useEditorStore((s) => s.autoSaveStatus)
  const dirty = dirtyProp ?? dirtyStore
  const status = statusProp ?? statusStore
  const [showSaved, setShowSaved] = useState(status === 'saved')

  useEffect(() => {
    if (status === 'saved') {
      setShowSaved(true)
      const t = setTimeout(() => setShowSaved(false), 1000)
      return () => clearTimeout(t)
    }
    setShowSaved(false)
    return
  }, [status])

  let kind: AutoSaveStatus | 'typing' | 'manual' = status
  let label = ''
  if (manualLabel) {
    kind = 'manual'
    label = manualLabel
  } else if (status === 'saved') {
    label = showSaved ? '저장됨 ✓' : dirty ? '입력 중…' : '동기화됨'
    kind = showSaved ? 'saved' : dirty ? 'typing' : 'idle'
  } else if (status === 'saving') {
    label = '저장 중…'
  } else if (status === 'error') {
    label = '저장 실패 ✗'
  } else if (status === 'conflict') {
    label = '충돌 발생 ⚠'
  } else {
    label = dirty ? '입력 중…' : '동기화됨'
    kind = dirty ? 'typing' : 'idle'
  }

  const interactive = status === 'conflict' || status === 'error' || onClick
  const Tag = interactive ? 'button' : 'span'

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      data-testid="save-status-pill"
      data-status={kind}
      aria-live="polite"
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${PALETTE[kind]} ${
        interactive ? 'cursor-pointer hover:brightness-95' : ''
      }`}
    >
      {kind === 'saving' && (
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-r-transparent"
        />
      )}
      <span>{label}</span>
    </Tag>
  )
}
