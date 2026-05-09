import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import {
  useDeleteReminder,
  useMyReminders,
  usePatchReminder,
} from '@/features/reminders/hooks'
import type { Reminder } from '@/features/reminders/api'

/**
 * "내 리마인더" page (`/reminders`).
 *
 * 활성(미발화) 리마인더가 위, 발화한 리마인더가 아래. 각 행에 [수정 / 삭제]
 * 버튼. 수정 = 인라인 datetime + 메시지 입력 패널.
 */
export function MyRemindersPage() {
  const all = useMyReminders(true)
  const items = all.data ?? []
  const active = items.filter((it) => !it.fired_at)
  const fired = items.filter((it) => Boolean(it.fired_at))

  return (
    <div className="space-y-4" data-testid="my-reminders-page">
      <header>
        <h1 className="text-xl font-semibold text-smsg-900">내 리마인더</h1>
        <p className="mt-1 text-xs text-gray-600">
          예약한 시간에 알림이 발송됩니다. 발화한 항목은 아래에 따로 표시돼요.
        </p>
      </header>

      {all.isError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          목록을 불러오지 못했습니다.
        </div>
      )}

      {all.isLoading && <p className="text-xs text-gray-500">불러오는 중…</p>}

      {!all.isLoading && items.length === 0 && (
        <p
          className="rounded border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500"
          data-testid="my-reminders-empty"
        >
          예약된 리마인더가 없어요.
        </p>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            활성
          </h2>
          <ul className="mt-1 space-y-2" data-testid="my-reminders-active">
            {active.map((it) => (
              <ReminderRow key={it.id} it={it} />
            ))}
          </ul>
        </section>
      )}

      {fired.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            발화 완료
          </h2>
          <ul className="mt-1 space-y-2" data-testid="my-reminders-fired">
            {fired.map((it) => (
              <ReminderRow key={it.id} it={it} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ReminderRow({ it }: { it: Reminder }) {
  const del = useDeleteReminder()
  const patch = usePatchReminder()
  const [editing, setEditing] = useState(false)
  const [draftAt, setDraftAt] = useState(toLocalInput(it.remind_at))
  const [draftMsg, setDraftMsg] = useState(it.message ?? '')
  const isFired = Boolean(it.fired_at)

  const onSave = () => {
    if (!draftAt) return
    patch.mutate(
      {
        id: it.id,
        body: {
          remind_at: new Date(draftAt).toISOString(),
          message: draftMsg.trim() ? draftMsg.trim() : null,
        },
      },
      {
        onSuccess: () => setEditing(false),
      },
    )
  }

  return (
    <li
      data-testid="my-reminder-row"
      data-id={it.id}
      data-fired={isFired ? 'true' : 'false'}
      className={`rounded border px-4 py-3 ${
        isFired ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {it.slug ? (
          <Link
            to={`/docs/${encodeURIComponent(it.slug)}`}
            className="text-sm font-semibold text-smsg-700 hover:underline"
          >
            {it.title || it.slug}
          </Link>
        ) : (
          <span className="text-sm font-semibold text-gray-700">
            {it.title || '(문서 없음)'}
          </span>
        )}
        <Badge tone={isFired ? 'muted' : 'brand'} size="sm">
          {isFired ? '발화 완료' : '대기'}
        </Badge>
        <span className="ml-auto flex items-center gap-2">
          {!isFired && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              data-testid="my-reminder-edit"
              className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:border-smsg-700 hover:text-smsg-700"
            >
              {editing ? '취소' : '수정'}
            </button>
          )}
          <button
            type="button"
            onClick={() => del.mutate(it.id)}
            data-testid="my-reminder-delete"
            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:border-red-300 hover:text-red-700"
          >
            삭제
          </button>
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        <span>알림 시각: {formatTs(it.remind_at)}</span>
        {it.fired_at && (
          <span className="ml-2">· 발화: {formatTs(it.fired_at)}</span>
        )}
      </p>
      {it.message && !editing && (
        <p className="mt-1 text-sm text-gray-700">{it.message}</p>
      )}
      {editing && (
        <div className="mt-2 space-y-2">
          <label className="block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">알림 시각</span>
            <input
              type="datetime-local"
              data-testid="my-reminder-edit-at"
              value={draftAt}
              onChange={(e) => setDraftAt(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">메모 (선택)</span>
            <textarea
              data-testid="my-reminder-edit-message"
              value={draftMsg}
              onChange={(e) => setDraftMsg(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full resize-y rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onSave}
              data-testid="my-reminder-save"
              disabled={!draftAt || patch.isPending}
              className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-60"
            >
              저장
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function toLocalInput(iso: string): string {
  // `<input type=datetime-local>` 는 'YYYY-MM-DDTHH:mm' 포맷을 요구한다.
  // ISO timestamp 를 로컬타임으로 깎아낸다.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatTs(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
