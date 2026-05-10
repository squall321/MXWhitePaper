import { useEffect, useRef, useState } from 'react'
import { useCreateSavedView } from './hooks'
import { hasAnyFilter, type SavedViewFilters } from './api'

interface SaveViewButtonProps {
  /** The current search filter set. SaveView is hidden when all slots empty. */
  filters: SavedViewFilters
  className?: string
}

const ICON_PRESETS = ['📂', '📊', '⭐️', '🔥', '🧾', '🗂️', '📌', '🧪', '📝', '🔔']

/**
 * "현재 필터를 저장" 버튼 — SearchResults 헤더에 마운트된다. 필터가 비어 있으면
 * 자체적으로 null 을 렌더해 모듈 import 만으로 비기능 케이스에서도 무해하다.
 *
 * 클릭 → 인라인 모달이 열려 이름 + 아이콘(이모지 프리셋 또는 직접 입력)을
 * 입력받고 POST /me/saved-views 로 생성한다. 성공시 react-query invalidate +
 * 모달 닫힘.
 */
export function SaveViewButton({ filters, className }: SaveViewButtonProps) {
  const create = useCreateSavedView()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string>('📂')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!hasAnyFilter(filters)) return null

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(
      { name: trimmed, icon: icon || null, filters },
      {
        onSuccess: () => {
          setOpen(false)
          setName('')
          setIcon('📂')
        },
      },
    )
  }

  return (
    <div
      ref={wrapRef}
      data-testid="save-view-button"
      className={`relative inline-flex items-center ${className ?? ''}`}
    >
      <button
        type="button"
        data-testid="save-view-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="현재 검색을 저장"
        className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 transition-colors duration-fast hover:border-smsg-700 hover:text-smsg-700"
      >
        <span aria-hidden="true">📂</span>
        <span>뷰로 저장</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="저장된 뷰 만들기"
          data-testid="save-view-dialog"
          className="absolute right-0 top-full z-popover mt-1 w-80 rounded-md border border-gray-200 bg-white p-3 shadow-md"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            현재 필터를 저장
          </p>
          <label className="mb-2 block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">이름</span>
            <input
              ref={inputRef}
              type="text"
              data-testid="save-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 내가 작성 + 결산 (30일)"
              maxLength={120}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <div className="mb-3">
            <p className="mb-1 text-xs font-semibold text-gray-700">아이콘</p>
            <div className="flex flex-wrap gap-1">
              {ICON_PRESETS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  data-testid={`save-view-icon-${emoji}`}
                  onClick={() => setIcon(emoji)}
                  className={`rounded border px-2 py-1 text-base transition-colors ${
                    icon === emoji
                      ? 'border-smsg-700 bg-smsg-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  aria-pressed={icon === emoji}
                  aria-label={`아이콘 ${emoji}`}
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
              <input
                type="text"
                data-testid="save-view-icon-custom"
                value={icon}
                onChange={(e) => setIcon(e.target.value.slice(0, 4))}
                aria-label="직접 입력"
                placeholder="🙂"
                className="w-12 rounded border border-gray-200 bg-white px-1 text-center text-base"
                maxLength={4}
              />
            </div>
          </div>
          <p className="mb-3 text-[11px] text-gray-500">
            저장된 뷰는 좌측 사이드바 &ldquo;📂 내 보기&rdquo; 에 나타납니다.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="save-view-cancel"
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              data-testid="save-view-submit"
              onClick={submit}
              disabled={!name.trim() || create.isPending}
              className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-60"
            >
              저장
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
