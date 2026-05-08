import { useEffect } from 'react'

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
}

interface ShortcutRow {
  keys: string
  desc: string
}

const SECTIONS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: '기본',
    rows: [
      { keys: 'E', desc: '편집/미리보기 전환' },
      { keys: '⌘ S', desc: '수동 저장 (자동 저장 즉시 플러시)' },
      { keys: '⌘ Z / ⌘ ⇧ Z', desc: '실행 취소 / 다시 실행' },
      { keys: '?', desc: '단축키 안내 열기/닫기' },
      { keys: 'Esc', desc: '메뉴/모달 닫기' },
    ],
  },
  {
    title: '편집',
    rows: [
      { keys: '/', desc: '슬래시 메뉴 — 블록 추가' },
      { keys: 'Tab / ⇧ Tab', desc: '들여쓰기 / 내어쓰기 (리스트 안)' },
      { keys: '⌘ ↑ / ⌘ ↓', desc: '블록 위/아래로 이동' },
      { keys: '[[', desc: '문서 위키링크 자동완성' },
      { keys: '@', desc: '용어 참조 자동완성' },
      { keys: ':emoji', desc: '이모지 자동완성' },
    ],
  },
  {
    title: '블록 일괄 선택',
    rows: [
      { keys: '⌘ A', desc: '현재 섹션의 모든 블록 선택' },
      { keys: '⌘ D', desc: '선택한 블록 복제' },
      { keys: 'Delete / Backspace', desc: '선택한 블록 삭제' },
      { keys: 'Esc', desc: '블록 선택 해제' },
    ],
  },
  {
    title: '텍스트 서식',
    rows: [
      { keys: '⌘ B', desc: '굵게' },
      { keys: '⌘ I', desc: '기울임' },
      { keys: '⌘ U', desc: '밑줄' },
      { keys: '⌘ E', desc: '인라인 코드' },
      { keys: '⌘ K', desc: '링크 삽입 ([[slug]] 또는 https://…)' },
      { keys: '~~text~~', desc: '취소선 (또는 toolbar의 S 버튼)' },
    ],
  },
  {
    title: '찾기 / 바꾸기',
    rows: [
      { keys: '⌘ F', desc: '현재 문서에서 찾기 / 바꾸기' },
      { keys: 'Esc', desc: '찾기 창 닫기' },
    ],
  },
  {
    title: '이동 (G 코드)',
    rows: [
      { keys: '⌘ K', desc: '검색 / 명령 팔레트' },
      { keys: 'G H', desc: '홈으로 이동' },
      { keys: 'G O', desc: '조직 페이지' },
      { keys: 'G R', desc: '최근 본 문서' },
      { keys: 'G N', desc: '새 문서 작성' },
      { keys: 'G S', desc: '환경설정' },
    ],
  },
  {
    title: '아티클',
    rows: [
      { keys: 'J / K', desc: '다음 / 이전 섹션' },
      { keys: '★', desc: '즐겨찾기 토글' },
    ],
  },
]

/**
 * Lightweight modal listing all editor / app shortcuts. Opens via the global
 * `?` hotkey when not typing, and via the toolbar "단축키" button.
 */
export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="단축키 안내"
      data-testid="shortcuts-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-smsg-900">단축키 안내</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            aria-label="닫기"
          >
            Esc
          </button>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          {SECTIONS.map((sec) => (
            <section key={sec.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {sec.title}
              </h3>
              <dl className="space-y-1">
                {sec.rows.map((row) => (
                  <div
                    key={row.keys}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <dt>
                      <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                        {row.keys}
                      </kbd>
                    </dt>
                    <dd className="flex-1 text-right text-gray-700">{row.desc}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          힌트: 본문 어디에서나 <kbd className="rounded border border-gray-300 bg-white px-1 font-mono">?</kbd>를 눌러 다시 열 수 있어요.
        </p>
      </div>
    </div>
  )
}
