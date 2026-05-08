import { useEffect, useState } from 'react'

/** localStorage key tracking whether the user has dismissed the tour. */
const STORAGE_KEY = 'mxwp.editorTour.v1'

interface TourStep {
  title: string
  body: string
  /** Optional CSS selector to point at, drawn as a halo. */
  highlight?: string
  /** Hint to position the bubble relative to the highlight target. */
  position?: 'above' | 'below' | 'left' | 'right'
}

const STEPS: TourStep[] = [
  {
    title: '👋 환영합니다',
    body:
      'MX White Paper 에디터에 오신 걸 환영해요. 슬래시(/) 메뉴를 모르더라도 마우스만으로 어떤 블록이든 추가·이동·삭제할 수 있도록 만들어졌습니다. 7단계로 핵심 기능을 빠르게 둘러볼게요.',
  },
  {
    title: '🔍 상단 바 (TopBar)',
    body:
      '검색창에 ⌘K 또는 키워드를 입력해 모든 문서를 즉시 찾을 수 있어요. 우측 상단의 프로필 메뉴에서 즐겨찾기/최근활동/환경설정/도움말을 열고, “+ 새 문서” 버튼으로 빈 문서나 템플릿을 시작하세요.',
    highlight: '[data-testid="topbar"]',
    position: 'below',
  },
  {
    title: '➕ 블록 + 레일',
    body:
      '블록 위·아래에 마우스를 올리면 가운데 ⊕ 모양의 “+” 레일이 떠올라요. 클릭하면 16개 블록 팔레트가 그 자리에서 열립니다. 글, 차트, 표, 콜아웃, 코드 등 자주 쓰는 블록을 한 번에 고를 수 있어요.',
    highlight: '[data-rail="bottom"]',
    position: 'above',
  },
  {
    title: '⋮⋮ 좌측 드래그 핸들',
    body:
      '블록 왼쪽 가장자리의 ⋮⋮ 핸들을 끌어 블록 순서를 바꿀 수 있습니다. 같은 섹션 안에서만 이동되며, 마우스를 떼는 순간 자동 저장돼요. 키보드 사용자는 ⌘↑/⌘↓ 단축키로 같은 동작을 할 수 있어요.',
    highlight: '[data-drag-handle]',
    position: 'right',
  },
  {
    title: '↗ 크기 조정 핸들',
    body:
      '차트·표·이미지·코드 같은 블록은 우측·하단·우하단 모서리에 드래그 핸들이 나타나요. 드래그해서 폭/높이를 픽셀 단위(8px 그리드 스냅)로 자유롭게 조정할 수 있고, Esc 로 변경을 취소할 수 있어요.',
    highlight: '[data-block-resize-wrapper]',
    position: 'right',
  },
  {
    title: '▾ 섹션 접기',
    body:
      '문서가 길어지면 섹션 제목 옆 ▾ 버튼이나 본문 우측의 “접기” 토글로 한 섹션 전체 또는 큰 블록을 접어둘 수 있어요. 접힘 상태는 브라우저별로 저장되니, 자주 보는 부분만 펴 두고 협업할 수 있습니다.',
    highlight: '[data-section-collapse]',
    position: 'left',
  },
  {
    title: '🎨 블록 팔레트 + 인라인 서식',
    body:
      '`/` 키로 슬래시 메뉴, 본문 텍스트를 드래그하면 인라인 서식 툴바가 떠오릅니다. **굵게**·*기울임*·`코드`·링크([[slug]])·하이라이트가 한 번에 가능해요. 단축키는 우측 하단의 ? 버튼에서 모두 확인할 수 있습니다.',
    highlight: '[data-blocknote-surface]',
    position: 'above',
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
 * Seven short steps with 다음 / 이전 / 건너뛰기. Persists dismissal in
 * localStorage; the help drawer's "튜토리얼 다시 보기" pass-through sets
 * `forceOpen` to bring it back without resetting the flag.
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
          {cur.position && (
            <span
              data-testid="tour-position-hint"
              aria-hidden="true"
              className="ml-auto rounded-full border border-gray-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500"
            >
              {cur.position}
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-gray-700">{cur.body}</p>
        {cur.highlight && (
          <p className="mb-3 truncate font-mono text-[11px] text-gray-500" aria-hidden="true">
            대상: {cur.highlight}
          </p>
        )}
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

/** Exposed only for tests so the assertion stays in sync with reality. */
export const ONBOARDING_STEPS = STEPS
