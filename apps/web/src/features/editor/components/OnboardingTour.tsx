import { useEffect, useState } from 'react'

/** localStorage key tracking whether the user has dismissed the tour. */
const STORAGE_KEY = 'mxwp.editorTour.v1'

interface TourStep {
  title: string
  body: string
  /** Optional CSS selector to point at, drawn as a halo. */
  highlight?: string
}

const STEPS: TourStep[] = [
  {
    title: '✏ 섹션 빠른 편집',
    body:
      '미리보기 모드에서 섹션 제목 옆 ✏ 아이콘을 누르면 해당 섹션만 곧바로 편집할 수 있어요.',
  },
  {
    title: '+ 새 블록 추가',
    body:
      '본문 어디에서나 / 키를 누르면 슬래시 메뉴가 열립니다. 25가지 블록을 텍스트·차트·미디어 등 그룹으로 나눠 놨어요.',
    highlight: '[data-blocknote-surface]',
  },
  {
    title: '자동 저장',
    body:
      '5초 무입력 또는 200자 변경마다 자동 저장됩니다. 우측 상단 “저장됨 ✓” 표시로 상태를 확인할 수 있어요.',
    highlight: '[data-testid="save-status-pill"]',
  },
  {
    title: '충돌 해결',
    body:
      '다른 사람이 같은 문서를 저장하면 3-way 머지 모달이 열려요. j/k 로 이동, m/t/e 로 내 것/상대 것/직접 편집을 고를 수 있습니다.',
  },
  {
    title: '버전 이력',
    body:
      '오른쪽 “버전 이력” 패널에서 과거 버전 미리보기와 복원이 가능합니다. 모든 저장은 새 버전으로 보존돼요.',
  },
]

interface OnboardingTourProps {
  /**
   * Force-visible flag (e.g., for the “?” menu’s “튜토리얼 다시 보기” option).
   * If undefined the component reads localStorage on mount and shows the tour
   * exactly once per browser.
   */
  forceOpen?: boolean
  onClose?: () => void
}

/**
 * One-time onboarding overlay shown the first time a user enters fullEdit.
 * Five short steps with 다음 / 건너뛰기. Persists dismissal in localStorage.
 */
export function OnboardingTour({ forceOpen, onClose }: OnboardingTourProps) {
  // Initial open state honours `forceOpen` so SSR-rendered tests can assert
  // the visible step without waiting for an effect.
  const [open, setOpen] = useState<boolean>(Boolean(forceOpen))
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (forceOpen) {
      setOpen(true)
      setStep(0)
      return
    }
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== '1') {
        setOpen(true)
      }
    } catch {
      /* storage disabled — skip the tour */
    }
  }, [forceOpen])

  const close = () => {
    setOpen(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* noop */
    }
    onClose?.()
  }

  if (!open) return null
  const cur = STEPS[step] ?? STEPS[0]!
  const isLast = step >= STEPS.length - 1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="에디터 가이드"
      data-testid="onboarding-tour"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-mono text-smsg-500">
            {step + 1} / {STEPS.length}
          </span>
          <h3 className="text-base font-semibold text-smsg-900">{cur.title}</h3>
        </div>
        <p className="mb-4 text-sm text-gray-700">{cur.body}</p>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={close}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            건너뛰기
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
              >
                이전
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? close() : setStep((s) => s + 1))}
              className="rounded bg-smsg-700 px-3 py-1 text-xs font-medium text-white hover:bg-smsg-900"
            >
              {isLast ? '시작하기' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** For tests — exported so suites can reset the storage flag. */
export const ONBOARDING_STORAGE_KEY = STORAGE_KEY
