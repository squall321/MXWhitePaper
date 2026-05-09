import { useEffect, useMemo, useState } from 'react'
import type { Block } from '@/types/document'
import {
  getSnippet,
  listSnippets,
  type SnippetScope,
  type SnippetSummary,
} from './api'

/**
 * 스니펫 선택 모달.
 *
 * - 검색 + scope 탭(내 스니펫 / 팀 / 조직 전체).
 * - 항목 클릭 → getSnippet(id) (BE 가 use_count 자동 ++) → blocks 배열을
 *   `onInsert(blocks)` 로 부모에게 돌려준다. 부모(=BlockInsertPalette 호출처)는
 *   현재 커서 위치에서 insertBlock 을 순차 호출한다.
 *
 * BlockInsertPalette 의 17번째 타일에서 열림.
 */
export interface SnippetPickerProps {
  onClose: () => void
  onInsert: (blocks: Block[]) => void
}

type ScopeTab = 'mine' | 'team' | 'org'

const SCOPE_QUERY: Record<ScopeTab, SnippetScope | undefined> = {
  mine: 'private',
  team: 'team',
  org: 'org',
}

export function SnippetPicker({ onClose, onInsert }: SnippetPickerProps) {
  const [tab, setTab] = useState<ScopeTab>('mine')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<SnippetSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetch on tab/query change. Light debounce on q.
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      setLoading(true)
      setErr(null)
      listSnippets({ scope: SCOPE_QUERY[tab], q: q.trim() || undefined, limit: 50 })
        .then((rows) => {
          if (cancelled) return
          setItems(rows)
        })
        .catch((e) => {
          if (cancelled) return
          setErr(e instanceof Error ? e.message : '불러오지 못했습니다.')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [tab, q])

  const filtered = useMemo(() => items, [items])

  async function handlePick(it: SnippetSummary) {
    if (busyId) return
    setBusyId(it.id)
    setErr(null)
    try {
      const full = await getSnippet(it.id)
      onInsert(full.blocks)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '스니펫을 불러오지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="스니펫 선택"
      data-testid="snippet-picker"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-xl rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
        <header className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-smsg-900 dark:text-smsg-100">
            📚 스니펫
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            저장한 블록 묶음을 현재 위치에 삽입합니다.
          </p>
        </header>
        <div className="border-b border-gray-200 px-4 pb-2 pt-3 dark:border-gray-700">
          <div className="flex gap-1 text-xs" role="tablist">
            {(
              [
                { id: 'mine' as const, label: '내 스니펫' },
                { id: 'team' as const, label: '팀' },
                { id: 'org' as const, label: '조직 전체' },
              ]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                data-testid={`snippet-picker-tab-${t.id}`}
                className={`rounded px-2 py-1 ${
                  tab === t.id
                    ? 'bg-smsg-700 text-white'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 또는 설명으로 검색"
            className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
            data-testid="snippet-picker-search"
          />
        </div>
        <ul
          role="listbox"
          className="max-h-96 overflow-y-auto py-1"
          data-testid="snippet-picker-list"
        >
          {loading && (
            <li className="px-4 py-3 text-xs text-gray-500">불러오는 중…</li>
          )}
          {!loading && filtered.length === 0 && (
            <li className="px-4 py-3 text-xs text-gray-500">
              일치하는 스니펫이 없습니다.
            </li>
          )}
          {!loading &&
            filtered.map((it) => (
              <li key={it.id} role="option">
                <button
                  type="button"
                  disabled={busyId === it.id}
                  onClick={() => void handlePick(it)}
                  data-testid={`snippet-picker-item-${it.id}`}
                  className="flex w-full flex-col gap-0.5 px-4 py-2 text-left text-sm hover:bg-smsg-50 disabled:opacity-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-smsg-900 dark:text-smsg-100">
                      {it.name}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      사용 {it.use_count}회 · 블록 {it.block_count}개
                    </span>
                  </div>
                  {it.description && (
                    <span className="text-xs text-gray-600 dark:text-gray-300">
                      {it.description}
                    </span>
                  )}
                  {it.preview && (
                    <span className="truncate text-[11px] text-gray-500">
                      {it.preview}
                    </span>
                  )}
                </button>
              </li>
            ))}
        </ul>
        {err && (
          <p
            role="alert"
            className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-200"
          >
            {err}
          </p>
        )}
        <footer className="flex justify-end border-t border-gray-200 px-4 py-2 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            data-testid="snippet-picker-close"
          >
            닫기
          </button>
        </footer>
      </div>
    </div>
  )
}
