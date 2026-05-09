import { useEffect, useState } from 'react'
import { useEditorStore } from '../state'
import { useConnectionStore } from '../connectionStore'

/**
 * Four-state auto-save indicator. Replaces the older `<SaveStatusPill />`
 * inline status text. States and copy:
 *
 *   idle      ✓ 저장됨 N분 전        (or "방금 전" / "어제")
 *   saving    💾 저장 중…             (with spinner)
 *   offline   📡 오프라인 — N개 변경 대기 중
 *   conflict  ⚠ 충돌 — 새로고침 필요  (click → opens ConflictMergeModal)
 *
 * The relative-time label auto-cycles via a 30-second interval. Tooltip
 * exposes the absolute timestamp + version number where useful.
 *
 * Test seam: `nowOverride` lets unit tests pin "now" without faking timers.
 */
export type AutoSaveVisualKind = 'idle' | 'saving' | 'offline' | 'conflict'

export interface AutoSaveStatusPillProps {
  /** Click handler for the conflict state — typically opens the merge modal. */
  onConflictClick?: () => void
  /** Test override — bypass store reads. */
  override?: {
    kind: AutoSaveVisualKind
    lastSavedAt?: number | null
    pendingMutations?: number
    version?: number | null
  }
  /** Test override — pin the "now" reference for relative-time formatting. */
  nowOverride?: number
}

const PALETTE: Record<AutoSaveVisualKind, string> = {
  idle: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  saving: 'border-smsg-200 bg-smsg-50 text-smsg-700',
  offline: 'border-amber-300 bg-amber-100 text-amber-900',
  conflict: 'border-red-300 bg-red-50 text-red-800',
}

/** Plain-Korean relative-time formatter. */
export function formatRelative(savedAt: number | null, now: number): string {
  if (savedAt == null) return '아직 저장 안됨'
  const delta = Math.max(0, now - savedAt)
  if (delta < 5_000) return '방금 전'
  if (delta < 60_000) return `${Math.floor(delta / 1000)}초 전`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}분 전`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}시간 전`
  return `${Math.floor(delta / 86_400_000)}일 전`
}

function formatAbsolute(savedAt: number | null): string {
  if (savedAt == null) return ''
  try {
    const d = new Date(savedAt)
    return d.toLocaleString('ko-KR')
  } catch {
    return ''
  }
}

export function AutoSaveStatusPill({
  onConflictClick,
  override,
  nowOverride,
}: AutoSaveStatusPillProps) {
  // Subscribe to scalar fields only — Zustand v5 uses Object.is for diffing.
  const status = useEditorStore((s) => s.autoSaveStatus)
  const conflictRemote = useEditorStore((s) => s.conflictRemote)
  const lastSavedAtStore = useEditorStore((s) => s.lastSavedAt)
  // Best-effort version pull — DocumentJSON v1.0 carries `version` at the root.
  const version = useEditorStore((s) =>
    s.draft && typeof (s.draft as { version?: number }).version === 'number'
      ? ((s.draft as { version?: number }).version ?? null)
      : null,
  )
  const onlineStore = useConnectionStore((s) => s.online)
  const pendingStore = useConnectionStore((s) => s.pendingMutations)

  // Decide the visual kind. Override always wins for tests.
  let kind: AutoSaveVisualKind
  if (override) {
    kind = override.kind
  } else if (conflictRemote || status === 'conflict') {
    kind = 'conflict'
  } else if (!onlineStore) {
    kind = 'offline'
  } else if (status === 'saving') {
    kind = 'saving'
  } else {
    kind = 'idle'
  }

  const lastSavedAt = override?.lastSavedAt ?? lastSavedAtStore
  const pending = override?.pendingMutations ?? pendingStore

  // Tick the relative timestamp every 30s while idle. We don't tick during
  // the other states — their copy doesn't depend on elapsed time.
  const [now, setNow] = useState<number>(() => nowOverride ?? Date.now())
  useEffect(() => {
    if (nowOverride != null) return
    if (kind !== 'idle') return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [kind, nowOverride])

  let label: string
  let tooltip: string | undefined
  switch (kind) {
    case 'saving':
      label = '저장 중…'
      break
    case 'offline':
      label = `오프라인 — ${pending}개 변경 대기 중`
      tooltip = '연결이 복구되면 자동으로 저장됩니다.'
      break
    case 'conflict':
      label = '충돌 — 새로고침 필요'
      tooltip = '다른 곳에서 같은 문서가 수정되었습니다. 클릭해 병합하세요.'
      break
    case 'idle':
    default: {
      const rel = formatRelative(lastSavedAt, nowOverride ?? now)
      label = `저장됨 ${rel}`
      const v = override?.version ?? version
      const abs = formatAbsolute(lastSavedAt)
      tooltip = abs ? (v != null ? `${abs} · v${v}` : abs) : undefined
      break
    }
  }

  const interactive = kind === 'conflict' && !!onConflictClick
  const Tag: 'button' | 'span' = interactive ? 'button' : 'span'

  // Pure-text glyph (we keep the leading icon as a literal char since the
  // codebase doesn't pull in lucide for these inline pills).
  const glyph =
    kind === 'idle'
      ? '✓'
      : kind === 'saving'
        ? '💾'
        : kind === 'offline'
          ? '📡'
          : '⚠'

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={interactive ? onConflictClick : undefined}
      data-testid="auto-save-status-pill"
      data-status={kind}
      title={tooltip}
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
      <span aria-hidden>{glyph}</span>
      <span>{label}</span>
    </Tag>
  )
}
