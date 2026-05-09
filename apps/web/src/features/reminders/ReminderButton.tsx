import { useEffect, useRef, useState } from 'react'
import { useCreateReminder } from './hooks'

interface ReminderButtonProps {
  slug: string
  className?: string
}

type Preset =
  | { id: 'in-1h'; label: '1시간 뒤'; deltaMs: number }
  | { id: 'tomorrow'; label: '내일'; deltaMs: number }
  | { id: 'next-week'; label: '다음 주'; deltaMs: number }
  | { id: 'next-month'; label: '다음 달'; deltaMs: number }

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const PRESETS: Preset[] = [
  { id: 'in-1h', label: '1시간 뒤', deltaMs: HOUR },
  { id: 'tomorrow', label: '내일', deltaMs: DAY },
  { id: 'next-week', label: '다음 주', deltaMs: 7 * DAY },
  { id: 'next-month', label: '다음 달', deltaMs: 30 * DAY },
]

/**
 * 리마인더 예약 버튼 — WikiArticle 의 제목 행에 마운트된다.
 *
 *   - 좌클릭 = quick-preset dropdown 열기 (1시간 뒤 / 내일 / 다음 주 / 다음 달).
 *   - "사용자 지정" → datetime picker + message textarea + 저장.
 *
 * 빠른 프리셋은 한 번 클릭에 즉시 POST 하고 닫힌다. 사용자 지정은 datetime
 * picker(`<input type=datetime-local>`) 로 상대시간이 아닌 절대 시각을 잡고,
 * 메시지 입력란을 함께 노출한다.
 */
export function ReminderButton({ slug, className }: ReminderButtonProps) {
  const create = useCreateReminder()
  const [open, setOpen] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [customAt, setCustomAt] = useState('')
  const [customMessage, setCustomMessage] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCustomMode(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setCustomMode(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const fireAt = (deltaMs: number) => {
    const remind_at = new Date(Date.now() + deltaMs).toISOString()
    create.mutate(
      { slug, body: { remind_at } },
      {
        onSuccess: () => {
          setOpen(false)
        },
      },
    )
  }

  const fireCustom = () => {
    if (!customAt) return
    // `<input type=datetime-local>` 값은 로컬 타임존 + offset 없음. Date(s)
    // 가 그걸 로컬로 해석해 주므로 그대로 toISOString() 으로 UTC 화한다.
    const remind_at = new Date(customAt).toISOString()
    create.mutate(
      {
        slug,
        body: {
          remind_at,
          message: customMessage.trim() ? customMessage.trim() : null,
        },
      },
      {
        onSuccess: () => {
          setOpen(false)
          setCustomMode(false)
          setCustomAt('')
          setCustomMessage('')
        },
      },
    )
  }

  return (
    <div
      ref={wrapRef}
      data-testid="reminder-button"
      data-slug={slug}
      className={`relative inline-flex items-center ${className ?? ''}`}
    >
      <button
        type="button"
        aria-label="리마인더 예약"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="reminder-toggle"
        onClick={() => {
          setOpen((v) => !v)
          setCustomMode(false)
        }}
        title="리마인더 예약"
        className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 transition-colors duration-fast hover:border-smsg-700 hover:text-smsg-700"
      >
        <span aria-hidden="true">⏰</span>
        <span>리마인더</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="reminder-dropdown"
          className="absolute right-0 top-full z-popover mt-1 w-72 rounded-md border border-gray-200 bg-white p-2 shadow-md"
        >
          {!customMode && (
            <>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                빠른 예약
              </p>
              <ul className="py-1">
                {PRESETS.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      data-testid={`reminder-preset-${p.id}`}
                      onClick={() => fireAt(p.deltaMs)}
                      disabled={create.isPending}
                      className="w-full rounded px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-smsg-50 disabled:opacity-60"
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-gray-100 pt-1">
                <button
                  type="button"
                  data-testid="reminder-custom-open"
                  onClick={() => setCustomMode(true)}
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-smsg-700 hover:bg-smsg-50"
                >
                  사용자 지정…
                </button>
              </div>
            </>
          )}
          {customMode && (
            <div className="space-y-2 p-1">
              <label className="block text-xs text-gray-700">
                <span className="mb-0.5 block font-semibold">알림 시각</span>
                <input
                  type="datetime-local"
                  data-testid="reminder-custom-at"
                  value={customAt}
                  onChange={(e) => setCustomAt(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                />
              </label>
              <label className="block text-xs text-gray-700">
                <span className="mb-0.5 block font-semibold">메모 (선택)</span>
                <textarea
                  data-testid="reminder-custom-message"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="알림에 함께 표시될 메모"
                  className="w-full resize-y rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCustomMode(false)}
                  className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  뒤로
                </button>
                <button
                  type="button"
                  data-testid="reminder-custom-save"
                  onClick={fireCustom}
                  disabled={!customAt || create.isPending}
                  className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-60"
                >
                  저장
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
