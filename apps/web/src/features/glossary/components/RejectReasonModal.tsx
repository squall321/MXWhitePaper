import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

/**
 * Minimum reason length the FE enforces. BE accepts min 1 char (see
 * `RejectIn` in apps/api `schemas/glossary.py`), but a 5-char floor saves
 * admins from accidental empty-ish rejects (e.g. "ㅇ").
 */
const MIN_REASON_LEN = 5

export interface RejectReasonModalProps {
  /** Modal open state. Parent controls. */
  open: boolean
  /** Term being rejected — used for the header context. */
  termLabel?: string
  /** Submission in-flight: locks Submit and shows the busy state. */
  busy?: boolean
  /** User dismissed the modal (backdrop / Esc / cancel). */
  onClose: () => void
  /** User submitted a valid reason. Caller is responsible for the network call. */
  onConfirm: (reason: string) => void
}

/**
 * 거부 사유 입력 모달. Esc 로 닫히고 Cmd/Ctrl+Enter 로 제출. reason 이
 * MIN_REASON_LEN 미만이면 Submit 비활성 + invalid aria.
 */
export function RejectReasonModal({
  open,
  termLabel,
  busy = false,
  onClose,
  onConfirm,
}: RejectReasonModalProps) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Reset reason whenever the modal is re-opened so a previous draft
  // doesn't bleed into the next rejection.
  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open])

  const trimmed = reason.trim()
  const tooShort = trimmed.length < MIN_REASON_LEN
  const showError = touched && tooShort

  const submit = useCallback(() => {
    setTouched(true)
    if (tooShort || busy) return
    onConfirm(trimmed)
  }, [tooShort, busy, onConfirm, trimmed])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd+Enter (mac) / Ctrl+Enter (win/linux) → submit.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submit()
      }
    },
    [submit],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={termLabel ? `용어 거부: ${termLabel}` : '용어 거부'}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} data-testid="reject-cancel">
            취소
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={tooShort || busy}
            loading={busy}
            data-testid="reject-submit"
            aria-disabled={tooShort || busy || undefined}
          >
            거부
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-5" data-testid="reject-reason-modal">
        <p className="text-xs text-gray-500">
          제안자에게 표시될 거부 사유를 입력하세요. 최소 {MIN_REASON_LEN}자
          이상이어야 합니다.
        </p>
        <Field
          label="거부 사유"
          required
          error={showError ? `최소 ${MIN_REASON_LEN}자 이상 입력해 주세요.` : undefined}
        >
          <Textarea
            ref={taRef}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              if (!touched) setTouched(true)
            }}
            onBlur={() => setTouched(true)}
            onKeyDown={onKeyDown}
            rows={4}
            placeholder="예: 이미 동일 분야에 등록된 용어와 정의가 충돌합니다."
            aria-label="거부 사유"
            aria-required="true"
            aria-invalid={showError || undefined}
            data-testid="reject-reason-input"
            autoFocus
          />
        </Field>
        <p className="text-[11px] text-gray-400">
          단축키: <kbd className="rounded bg-gray-100 px-1">Esc</kbd> 닫기,{' '}
          <kbd className="rounded bg-gray-100 px-1">⌘/Ctrl + Enter</kbd> 제출
        </p>
      </div>
    </Modal>
  )
}

export const REJECT_REASON_MIN_LEN = MIN_REASON_LEN
