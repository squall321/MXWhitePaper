import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentJSONV10, Slug } from '@/types/document'
import { putDocument, isPreconditionFailed } from '../api'
import { getDocument } from '@/features/document/api'
import { useEditorStore } from '../state'
import {
  threeWayDiff,
  autoMerge,
  applyResolutions,
  buildOutline,
  type ConflictChoice,
  type ConflictNode,
  type OutlineNode,
} from '../diff/document-diff'

interface ConflictMergeModalProps {
  slug: Slug
}

/**
 * 3-way diff Conflict Merge UI (FR-16).
 *
 * Layout: three vertical panes — 내 변경 (mine) · 공통 조상 (base) · 상대방
 * 변경 (theirs) — each rendering the document outline with diff colour
 * markers. For every conflicting node a chooser bar is shown:
 *   [내 것] / [상대 것] / [직접 편집]
 * Default = 내 것.
 *
 * Toolbar:
 *   🤖 자동 머지   apply theirs-only changes onto mine for non-conflicting nodes
 *   ↻ 새로고침    re-fetch latest remote
 *   ✓ 적용 후 저장 PUT with If-Match: <remoteEtag>
 *
 * Keyboard:
 *   j/k  next/prev conflict
 *   m/t/e  pick mine / theirs / 직접 편집
 *   Enter  적용 후 저장
 *   Esc    닫기
 */
export function ConflictMergeModal({ slug }: ConflictMergeModalProps) {
  const remote = useEditorStore((s) => s.conflictRemote)
  const remoteEtag = useEditorStore((s) => s.conflictRemoteEtag)
  const localDraft = useEditorStore((s) => s.draft)
  const baseContent = useEditorStore((s) => s.baseContent)
  const setConflict = useEditorStore((s) => s.setConflict)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({})
  const [autoApplied, setAutoApplied] = useState<DocumentJSONV10 | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [manualText, setManualText] = useState<Record<string, string>>({})

  // The base for the diff. Prefer the user's own start-of-edit snapshot;
  // fall back to the *remote* if missing (page reload mid-edit).
  const fallbackToRemoteBase = !baseContent
  const effectiveBase = baseContent ?? remote
  const mineDoc = autoApplied ?? localDraft
  const closed = !remote || !mineDoc || !effectiveBase

  const tw = useMemo(() => {
    if (closed) return null
    return threeWayDiff(effectiveBase!, mineDoc!, remote!)
  }, [closed, effectiveBase, mineDoc, remote])

  const conflicts = tw?.conflicts ?? []
  const autoMergeable = tw?.autoMergeableConflictIds ?? []

  // Keyboard
  useEffect(() => {
    if (closed) return
    const onKey = (e: KeyboardEvent) => {
      if (busy) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        void applyAndSave()
        return
      }
      if (conflicts.length === 0) return
      const cur = conflicts[activeIdx]
      if (!cur) return
      if (e.key === 'j') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(conflicts.length - 1, i + 1))
      } else if (e.key === 'k') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'm') {
        e.preventDefault()
        setChoices((c) => ({ ...c, [cur.conflictId]: { kind: 'mine' } }))
      } else if (e.key === 't') {
        e.preventDefault()
        setChoices((c) => ({ ...c, [cur.conflictId]: { kind: 'theirs' } }))
      } else if (e.key === 'e') {
        e.preventDefault()
        setChoices((c) => ({
          ...c,
          [cur.conflictId]: { kind: 'manual', value: c[cur.conflictId]?.kind === 'manual' ? (c[cur.conflictId] as { value: unknown }).value : cur.mineValue },
        }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closed, busy, conflicts, activeIdx])

  if (closed) return null

  const close = (): void => {
    setConflict(null)
    setAutoApplied(null)
    setChoices({})
    setActiveIdx(0)
    setManualText({})
  }

  const onAutoMerge = (): void => {
    if (!tw) return
    const merged = autoMerge(tw)
    setAutoApplied(merged)
  }

  const onRefresh = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const fresh = await getDocument(slug)
      setConflict(fresh.document, fresh.meta.etag ?? null)
      setChoices({})
      setActiveIdx(0)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const applyAndSave = async (): Promise<void> => {
    if (!tw) return
    setBusy(true)
    setError(null)
    try {
      const filledChoices = { ...choices }
      // Fill any unresolved conflicts with the default ("내 것").
      for (const c of tw.conflicts) {
        if (!filledChoices[c.conflictId]) {
          filledChoices[c.conflictId] = { kind: 'mine' }
        }
      }
      // Validate any 'manual' edits (parse JSON if user typed text)
      for (const c of tw.conflicts) {
        const ch = filledChoices[c.conflictId]
        if (ch?.kind !== 'manual') continue
        const txt = manualText[c.conflictId]
        if (txt !== undefined) {
          try {
            const parsed = JSON.parse(txt) as unknown
            filledChoices[c.conflictId] = { kind: 'manual', value: parsed }
          } catch (err) {
            throw new Error(`직접 편집 JSON 파싱 실패 (${c.label}): ${(err as Error).message}`)
          }
        }
      }
      const startFrom = autoApplied ?? autoMerge(tw)
      const resolved = applyResolutions(tw, startFrom, filledChoices)
      const r = await putDocument(slug, resolved, remoteEtag, '충돌 머지 (3-way)')
      applySnapshot(r.document, r.etag)
      close()
    } catch (err) {
      if (isPreconditionFailed(err)) {
        // Race: someone saved again. Refresh and stay open.
        try {
          const fresh = await getDocument(slug)
          setConflict(fresh.document, fresh.meta.etag ?? null)
          setError('상대방이 다시 저장했습니다. 최신 버전으로 갱신했습니다.')
        } catch {
          setError('충돌 갱신 실패 — 다시 시도하세요.')
        }
      } else {
        setError((err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  const setChoice = (conflictId: string, kind: 'mine' | 'theirs' | 'manual'): void => {
    if (kind === 'manual') {
      setChoices((c) => ({ ...c, [conflictId]: { kind: 'manual', value: undefined } }))
      const cn = conflicts.find((x) => x.conflictId === conflictId)
      if (cn && manualText[conflictId] === undefined) {
        setManualText((m) => ({
          ...m,
          [conflictId]: JSON.stringify(cn.mineValue, null, 2),
        }))
      }
    } else {
      setChoices((c) => ({ ...c, [conflictId]: { kind } }))
    }
  }

  // Build per-pane outlines (with diff statuses)
  const minePatch = tw?.minePatch ?? null
  const theirsPatch = tw?.theirsPatch ?? null
  const mineOutline = useMemo(() => buildOutline(mineDoc!, minePatch, conflicts, 'mine'), [mineDoc, minePatch, conflicts])
  const baseOutline = useMemo(() => buildOutline(effectiveBase!, null, conflicts, 'base'), [effectiveBase, conflicts])
  const theirsOutline = useMemo(() => buildOutline(remote!, theirsPatch, conflicts, 'theirs'), [remote, theirsPatch, conflicts])

  // Sticky synchronized scrolling between panes
  const mineRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLDivElement>(null)
  const theirsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const refs = [mineRef.current, baseRef.current, theirsRef.current]
    if (refs.some((r) => !r)) return
    let syncing = false
    const handler = (src: HTMLDivElement) => () => {
      if (syncing) return
      syncing = true
      for (const r of refs) {
        if (r && r !== src) r.scrollTop = src.scrollTop
      }
      requestAnimationFrame(() => {
        syncing = false
      })
    }
    const handlers = refs.map((r) => (r ? handler(r) : null))
    refs.forEach((r, i) => r?.addEventListener('scroll', handlers[i] as EventListener))
    return () => {
      refs.forEach((r, i) => r?.removeEventListener('scroll', handlers[i] as EventListener))
    }
  }, [closed])

  const totalThierChanges = (theirsPatch?.metadata.length ?? 0) +
    (theirsPatch?.infobox.length ?? 0) +
    (theirsPatch?.sections.length ?? 0) +
    (theirsPatch?.scalars.length ?? 0)
  const conflictCount = conflicts.length
  const nonConflictCount = totalThierChanges - conflictCount
  const autoCount = autoMergeable.length

  const activeConflict: ConflictNode | null =
    conflicts.length > 0
      ? (conflicts[Math.min(activeIdx, conflicts.length - 1)] ?? null)
      : null

  return (
    <div
      role="dialog"
      aria-label="저장 충돌 — 3-way 머지"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div
        className="flex h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        data-testid="conflict-merge-modal"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-5 py-3">
          <h2 className="text-base font-semibold text-smsg-900">저장 충돌 — 3-way 머지</h2>
          <div className="text-xs text-gray-600" data-testid="conflict-summary">
            <span className="font-mono text-red-600">충돌 {conflictCount}</span>
            {' · '}
            <span className="font-mono text-amber-700">비충돌 변경 {Math.max(0, nonConflictCount)}</span>
            {' · '}
            <span className="font-mono text-emerald-700">자동 해결 가능 {autoCount}</span>
          </div>
          {fallbackToRemoteBase && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              기준 스냅샷이 없어 2-way 비교만 가능합니다.
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onAutoMerge}
              disabled={busy || autoCount === 0}
              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              data-testid="auto-merge-btn"
            >
              🤖 자동 머지
            </button>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={busy}
              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
            >
              ↻ 새로고침
            </button>
            <button
              type="button"
              onClick={() => void applyAndSave()}
              disabled={busy}
              className="rounded bg-smsg-700 px-3 py-1 text-xs font-medium text-white hover:bg-smsg-900 disabled:opacity-50"
              data-testid="apply-save-btn"
            >
              ✓ 적용 후 저장
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            >
              닫기 (Esc)
            </button>
          </div>
        </div>

        {/* Three panes */}
        <div className="grid flex-1 grid-cols-3 overflow-hidden">
          <Pane
            title="내 변경 (mine)"
            outline={mineOutline}
            innerRef={mineRef}
            tone="mine"
            activeConflictPath={activeConflict?.path}
          />
          <Pane
            title="공통 조상 (base)"
            outline={baseOutline}
            innerRef={baseRef}
            tone="base"
            activeConflictPath={activeConflict?.path}
          />
          <Pane
            title="상대방 변경 (theirs)"
            outline={theirsOutline}
            innerRef={theirsRef}
            tone="theirs"
            activeConflictPath={activeConflict?.path}
          />
        </div>

        {/* Conflict chooser bar (focused on active conflict) */}
        <div className="border-t border-gray-200 bg-white">
          {conflicts.length === 0 ? (
            <div className="px-5 py-3 text-xs text-emerald-700" data-testid="no-conflicts">
              ✓ 충돌이 없습니다. <strong>적용 후 저장</strong>을 눌러 자동 머지된 결과를 저장하세요.
            </div>
          ) : (
            <div className="grid grid-cols-[200px_1fr] gap-3 px-5 py-3">
              {/* conflict list */}
              <div className="overflow-auto" data-testid="conflict-list">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  충돌 항목 (j/k)
                </div>
                <ul className="space-y-1">
                  {conflicts.map((c, i) => {
                    const ch = choices[c.conflictId]?.kind ?? 'mine'
                    return (
                      <li key={c.conflictId}>
                        <button
                          type="button"
                          onClick={() => setActiveIdx(i)}
                          className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs ${
                            i === activeIdx
                              ? 'bg-smsg-700 text-white'
                              : 'hover:bg-gray-100'
                          }`}
                        >
                          <span className="truncate">{c.label}</span>
                          <span className={`ml-2 rounded px-1 text-[10px] ${
                            ch === 'mine' ? 'bg-blue-200 text-blue-900' :
                            ch === 'theirs' ? 'bg-purple-200 text-purple-900' :
                            'bg-amber-200 text-amber-900'
                          }`}>
                            {ch === 'mine' ? '내 것' : ch === 'theirs' ? '상대' : '편집'}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* chooser */}
              {activeConflict && (
                <div className="overflow-auto" data-testid="conflict-chooser">
                  <div className="mb-2 text-xs">
                    <span className="font-semibold text-gray-700">{activeConflict.label}</span>
                    <span className="ml-2 font-mono text-[11px] text-gray-500">{activeConflict.path}</span>
                  </div>
                  <div className="flex gap-3">
                    <ChooserOption
                      label="내 것 (m)"
                      sub="mine"
                      tone="mine"
                      value={activeConflict.mineValue}
                      checked={(choices[activeConflict.conflictId]?.kind ?? 'mine') === 'mine'}
                      onChange={() => setChoice(activeConflict.conflictId, 'mine')}
                    />
                    <ChooserOption
                      label="상대 것 (t)"
                      sub="theirs"
                      tone="theirs"
                      value={activeConflict.theirsValue}
                      checked={choices[activeConflict.conflictId]?.kind === 'theirs'}
                      onChange={() => setChoice(activeConflict.conflictId, 'theirs')}
                    />
                    <ChooserOption
                      label="직접 편집 (e)"
                      sub="manual"
                      tone="manual"
                      value={null}
                      checked={choices[activeConflict.conflictId]?.kind === 'manual'}
                      onChange={() => setChoice(activeConflict.conflictId, 'manual')}
                    />
                  </div>
                  {choices[activeConflict.conflictId]?.kind === 'manual' && (
                    <div className="mt-2">
                      <textarea
                        className="h-32 w-full rounded border border-gray-300 p-2 font-mono text-xs"
                        value={manualText[activeConflict.conflictId] ?? ''}
                        onChange={(e) =>
                          setManualText((m) => ({
                            ...m,
                            [activeConflict.conflictId]: e.target.value,
                          }))
                        }
                        placeholder="JSON으로 직접 편집…"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {error && <p className="border-t border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  )
}

interface PaneProps {
  title: string
  outline: OutlineNode[]
  innerRef: React.RefObject<HTMLDivElement>
  tone: 'mine' | 'base' | 'theirs'
  activeConflictPath?: string
}

function Pane({ title, outline, innerRef, tone, activeConflictPath }: PaneProps) {
  const headerCls =
    tone === 'mine'
      ? 'bg-blue-50 text-blue-900'
      : tone === 'theirs'
        ? 'bg-purple-50 text-purple-900'
        : 'bg-gray-50 text-gray-700'
  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-gray-200 last:border-r-0">
      <div className={`sticky top-0 z-10 border-b border-gray-200 px-3 py-2 text-xs font-semibold ${headerCls}`}>
        {title}
      </div>
      <div ref={innerRef} className="flex-1 overflow-auto px-3 py-2 text-xs">
        {outline.length === 0 ? (
          <div className="text-gray-400">(섹션 없음)</div>
        ) : (
          <ul className="space-y-0.5">
            {outline.map((n) => (
              <OutlineRow key={`${n.id}-${tone}`} node={n} depth={0} activeConflictPath={activeConflictPath} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface OutlineRowProps {
  node: OutlineNode
  depth: number
  activeConflictPath?: string
}

function OutlineRow({ node, depth, activeConflictPath }: OutlineRowProps) {
  const tone =
    node.status === 'added'
      ? 'bg-emerald-50 text-emerald-900'
      : node.status === 'removed'
        ? 'bg-red-50 text-red-700 line-through'
        : node.status === 'changed' || node.status === 'moved'
          ? 'bg-amber-50 text-amber-900'
          : 'bg-white text-gray-800'
  const isActive = activeConflictPath && activeConflictPath.startsWith(`sections/${node.id}`)
  return (
    <>
      <li
        className={`rounded px-2 py-1 ${tone} ${isActive ? 'ring-2 ring-smsg-700' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <span className="font-mono text-[10px] text-gray-400">L{node.level}</span>{' '}
        <span className="font-medium">{node.title || '(제목 없음)'}</span>
        <span className="ml-2 text-[10px] text-gray-500">블록 {node.blockCount}</span>
      </li>
      {node.children.map((c) => (
        <OutlineRow key={`${c.id}-c`} node={c} depth={depth + 1} activeConflictPath={activeConflictPath} />
      ))}
    </>
  )
}

interface ChooserOptionProps {
  label: string
  sub: 'mine' | 'theirs' | 'manual'
  tone: 'mine' | 'theirs' | 'manual'
  value: unknown
  checked: boolean
  onChange: () => void
}

function ChooserOption({ label, value, checked, onChange, tone }: ChooserOptionProps) {
  const ring =
    tone === 'mine'
      ? 'border-blue-300 bg-blue-50'
      : tone === 'theirs'
        ? 'border-purple-300 bg-purple-50'
        : 'border-amber-300 bg-amber-50'
  return (
    <label
      className={`flex flex-1 cursor-pointer flex-col gap-1 rounded border-2 px-2 py-1 text-xs ${ring} ${
        checked ? 'ring-2 ring-smsg-700' : 'opacity-70 hover:opacity-100'
      }`}
    >
      <span className="flex items-center gap-1">
        <input type="radio" checked={checked} onChange={onChange} className="accent-smsg-700" />
        <span className="font-semibold">{label}</span>
      </span>
      {value !== null && (
        <pre className="max-h-20 overflow-auto rounded bg-white/80 p-1 font-mono text-[10px] text-gray-700">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </label>
  )
}
