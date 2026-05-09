/**
 * ReviewersPanel — sidebar panel listing reviewers + decision form.
 *
 * SSR + Zustand 의 `useSyncExternalStore` 는 module-load snapshot 만 사용해
 * `setState` 가 server markup 에 반영되지 않는다. 따라서 `@/features/auth/store`
 * 를 vi.mock 으로 직접 주입한다. listReviewers 의 useEffect 결과는 SSR 에서
 * 실행되지 않으므로 데이터-주도 row 렌더는 BE 통합 테스트에 위임.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

let mockUser: { id: string; role: string } | null = null

vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (sel: (s: { user: typeof mockUser }) => unknown) => sel({ user: mockUser }),
    {
      getState: () => ({ user: mockUser }),
      setState: () => undefined,
    },
  ),
}))

vi.mock('../api', () => ({
  listReviewers: vi.fn(async () => []),
  addReviewers: vi.fn(),
  removeReviewer: vi.fn(),
  submitDecision: vi.fn(),
}))

vi.mock('@/features/auth/api', () => ({
  searchUsers: vi.fn(async () => []),
}))

import { ReviewersPanel } from '../ReviewersPanel'

const setRole = (role: string | null, id = 'u-self') => {
  mockUser = role ? { id, role } : null
}

describe('<ReviewersPanel />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = null
  })

  it('renders the panel chrome with the testid', () => {
    setRole('editor')
    const html = renderToStaticMarkup(<ReviewersPanel slug="some-doc" />)
    expect(html).toContain('data-testid="reviewers-panel"')
    expect(html).toContain('리뷰어')
  })

  it('shows the add button for editors', () => {
    setRole('editor')
    const html = renderToStaticMarkup(<ReviewersPanel slug="some-doc" />)
    expect(html).toContain('data-testid="reviewers-add-button"')
    expect(html).toContain('+ 리뷰어 추가')
  })

  it('hides the add button for readers', () => {
    setRole('reader')
    const html = renderToStaticMarkup(<ReviewersPanel slug="some-doc" />)
    expect(html).not.toContain('data-testid="reviewers-add-button"')
  })

  it('respects canEdit override (forces add button off)', () => {
    setRole('editor')
    const html = renderToStaticMarkup(
      <ReviewersPanel slug="some-doc" canEdit={false} />,
    )
    expect(html).not.toContain('data-testid="reviewers-add-button"')
  })
})
