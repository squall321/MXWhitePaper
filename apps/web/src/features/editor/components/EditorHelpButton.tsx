import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Drawer } from '@/components/ui'
import { OnboardingTour } from './OnboardingTour'

/**
 * Floating "?" button with a rich help drawer.
 *
 *   - Desktop: pinned bottom-right of the editor surface as its own affordance.
 *   - Mobile: same position; the existing "측면 패널" button stacks above it
 *     thanks to its larger `bottom` offset (calc env safe-area + 1rem).
 *
 * Drawer contents:
 *   - Searchable list of every keyboard shortcut (filtered live).
 *   - 1-line quick-start guide.
 *   - Direct link to the "+ 새 문서 → 템플릿에서 시작" gallery.
 *   - "튜토리얼 다시 보기" button — re-fires `OnboardingTour` with
 *     `forceOpen` so users can replay the 7-step tour without resetting
 *     the localStorage flag.
 */

interface ShortcutRow {
  keys: string
  desc: string
  group: string
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: 'E', desc: '편집/미리보기 전환', group: '기본' },
  { keys: '⌘ S', desc: '수동 저장', group: '기본' },
  { keys: '⌘ Z / ⌘ ⇧ Z', desc: '실행 취소 / 다시 실행', group: '기본' },
  { keys: '?', desc: '단축키 안내', group: '기본' },
  { keys: 'Esc', desc: '메뉴/모달 닫기', group: '기본' },
  { keys: '/', desc: '슬래시 메뉴 — 블록 추가', group: '편집' },
  { keys: 'Tab / ⇧ Tab', desc: '리스트 들여쓰기 / 내어쓰기', group: '편집' },
  { keys: '⌘ ↑ / ⌘ ↓', desc: '블록 위/아래 이동', group: '편집' },
  { keys: '[[', desc: '문서 위키링크 자동완성', group: '편집' },
  { keys: '@', desc: '용어 참조 자동완성', group: '편집' },
  { keys: ':emoji', desc: '이모지 자동완성', group: '편집' },
  { keys: '⌘ B', desc: '굵게', group: '서식' },
  { keys: '⌘ I', desc: '기울임', group: '서식' },
  { keys: '⌘ U', desc: '밑줄', group: '서식' },
  { keys: '⌘ E', desc: '인라인 코드', group: '서식' },
  { keys: '⌘ K', desc: '링크 / 검색 팔레트', group: '서식' },
  { keys: '⌘ F', desc: '문서 내 찾기 / 바꾸기', group: '찾기' },
  { keys: 'G H', desc: '홈으로 이동', group: '이동' },
  { keys: 'G O', desc: '조직 페이지', group: '이동' },
  { keys: 'G R', desc: '최근 본 문서', group: '이동' },
  { keys: 'G N', desc: '새 문서', group: '이동' },
  { keys: 'G S', desc: '환경설정', group: '이동' },
  { keys: 'J / K', desc: '다음 / 이전 섹션', group: '아티클' },
  { keys: '★', desc: '즐겨찾기 토글', group: '아티클' },
]

export function EditorHelpButton() {
  const [open, setOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SHORTCUTS
    return SHORTCUTS.filter(
      (r) =>
        r.keys.toLowerCase().includes(q) ||
        r.desc.toLowerCase().includes(q) ||
        r.group.toLowerCase().includes(q),
    )
  }, [query])

  const groups = useMemo(() => {
    const map = new Map<string, ShortcutRow[]>()
    for (const r of filtered) {
      const arr = map.get(r.group) ?? []
      arr.push(r)
      map.set(r.group, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="도움말 열기"
        data-testid="editor-help-button"
        // Sit just above the iOS safe-area inset; on mobile the "측면 패널"
        // button sits to the left thanks to its right-4 + same bottom offset.
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
        className="fixed right-4 z-drawer inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-base font-bold text-smsg-900 shadow-md transition-all duration-base ease-out-soft hover:-translate-y-0.5 hover:border-smsg-300 hover:bg-smsg-50 md:right-6 lg:bottom-6"
      >
        ?
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} side="right" ariaLabel="도움말">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-smsg-900 dark:text-gray-100">도움말</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 p-4">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              빠른 시작
            </h3>
            <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
              <li>
                <span className="font-mono text-xs text-smsg-700">/</span> 키 → 슬래시 메뉴로 블록 추가
              </li>
              <li>블록 위·아래 + 레일 → 16개 블록 팔레트</li>
              <li>본문 텍스트 드래그 → 인라인 서식 툴바</li>
              <li>모서리 핸들 → 픽셀 단위 크기 조정</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              단축키
            </h3>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색…"
              aria-label="단축키 검색"
              className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
            <div className="mt-2 space-y-3">
              {groups.length === 0 && (
                <p className="text-xs text-gray-500">일치하는 단축키가 없어요.</p>
              )}
              {groups.map(([name, rows]) => (
                <div key={name}>
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {name}
                  </h4>
                  <dl className="space-y-1">
                    {rows.map((r) => (
                      <div
                        key={r.keys + r.desc}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <dt>
                          <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-900">
                            {r.keys}
                          </kbd>
                        </dt>
                        <dd className="flex-1 text-right text-gray-700 dark:text-gray-300">{r.desc}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              템플릿
            </h3>
            <Link
              to="/docs/new?template=monthly-report"
              onClick={() => setOpen(false)}
              className="text-sm text-link hover:underline"
            >
              템플릿 갤러리에서 새 문서 시작 →
            </Link>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              튜토리얼
            </h3>
            <button
              type="button"
              onClick={() => {
                setTutorialOpen(true)
                setOpen(false)
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:border-smsg-300 hover:bg-smsg-50 dark:border-gray-700 dark:bg-gray-900"
            >
              튜토리얼 다시 보기
            </button>
          </section>
        </div>
      </Drawer>

      {tutorialOpen && (
        <OnboardingTour forceOpen onClose={() => setTutorialOpen(false)} />
      )}
    </>
  )
}
