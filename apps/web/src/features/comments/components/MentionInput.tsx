/**
 * Textarea with @-mention autocomplete.
 *
 * UX notes
 * ────────
 *   - 사용자가 `@` 를 입력하면 직후의 단어를 prefix 로 보고 `/users/search` 에
 *     쿼리한다 (debounced 200ms). 결과는 textarea 위쪽 popup 으로 표시.
 *   - 멘션 선택 시 `@<name>` 텍스트로 치환하면서 mention_user_ids 에 user.id 추가.
 *   - 외부에서 `body` 와 `mention_user_ids` 를 둘 다 controlled 로 받는다.
 *
 * 의존성
 * ──────
 *   `searchMentionUsers` (api.ts) 만 사용. 추가 deps 없음.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from 'react'
import { searchMentionUsers, type MentionUser } from '../api'

export interface MentionInputProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string, mentionUserIds: string[]) => void
  /** Controlled mention list — caller commits this on submit. */
  mentionUserIds: string[]
}

interface MentionTrigger {
  /** offset of `@` in the textarea value. */
  start: number
  /** current query (text after `@`, before whitespace). */
  query: string
}

function findActiveMention(text: string, caret: number): MentionTrigger | null {
  // 캐럿 위치에서 왼쪽으로 스캔 — 공백/줄바꿈/문자열 시작 만나면 종료.
  let i = caret - 1
  while (i >= 0) {
    const ch = text[i]
    if (!ch) break
    if (ch === '@') {
      // `@` 직전이 단어 문자(영문/한글/숫자/_)면 멘션이 아님 (이메일 등).
      const prev = i > 0 ? text[i - 1] : ''
      if (prev && /[\p{L}\p{N}_]/u.test(prev)) return null
      const query = text.slice(i + 1, caret)
      // query 안에 공백 들어가면 트리거 종료.
      if (/\s/.test(query)) return null
      return { start: i, query }
    }
    if (/\s/.test(ch)) return null
    i -= 1
  }
  return null
}

export function MentionInput({
  value,
  onChange,
  mentionUserIds,
  ...rest
}: MentionInputProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null)
  const [results, setResults] = useState<MentionUser[]>([])
  const [highlight, setHighlight] = useState(0)

  // Debounce 검색.
  useEffect(() => {
    if (!trigger) {
      setResults([])
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      void searchMentionUsers(trigger.query || '_', 10)
        .then((r) => {
          if (!cancelled) {
            setResults(r)
            setHighlight(0)
          }
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [trigger])

  const recomputeTrigger = useCallback(
    (text: string, caret: number) => {
      setTrigger(findActiveMention(text, caret))
    },
    [],
  )

  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    onChange(v, mentionUserIds)
    recomputeTrigger(v, e.target.selectionStart ?? v.length)
  }

  const onSelectionChange = () => {
    const el = ref.current
    if (!el) return
    recomputeTrigger(el.value, el.selectionStart ?? el.value.length)
  }

  const insertMention = useCallback(
    (u: MentionUser) => {
      const el = ref.current
      if (!el || !trigger) return
      const display = u.name?.trim() || u.email
      const before = value.slice(0, trigger.start)
      const afterStart = trigger.start + 1 + trigger.query.length
      const after = value.slice(afterStart)
      // 멘션 라벨은 공백을 `_` 로 치환해 토큰 경계를 명확히 한다.
      const label = display.replace(/\s+/g, '_')
      const next = `${before}@${label} ${after}`
      const ids = mentionUserIds.includes(u.id)
        ? mentionUserIds
        : [...mentionUserIds, u.id]
      onChange(next, ids)
      setTrigger(null)
      setResults([])
      // 캐럿을 라벨 뒤로 이동.
      const caret = before.length + 1 + label.length + 1
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(caret, caret)
      })
    },
    [trigger, value, mentionUserIds, onChange],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!trigger || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (h + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (h - 1 + results.length) % results.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const pick = results[highlight] ?? results[0]
      if (pick) insertMention(pick)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setTrigger(null)
      setResults([])
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onClick={onSelectionChange}
        onKeyUp={onSelectionChange}
        {...rest}
      />
      {trigger && results.length > 0 && (
        <ul
          role="listbox"
          aria-label="멘션 사용자"
          data-testid="mention-popup"
          className="absolute left-2 top-full z-popover mt-1 max-h-48 w-64 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {results.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(u)
                }}
                className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-smsg-50 ${
                  i === highlight ? 'bg-smsg-50' : ''
                }`}
              >
                <span className="truncate font-medium text-smsg-900">
                  {u.name || u.email}
                </span>
                <span className="truncate text-[10px] text-gray-500">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
