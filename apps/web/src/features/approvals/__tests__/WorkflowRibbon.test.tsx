/**
 * WorkflowRibbon — sticky pill near the doc title surfacing transition
 * actions per (status, role).
 *
 * SSR + Zustand 의 `useSyncExternalStore` 는 module-load 시점 snapshot 을
 * server snapshot 으로 그대로 사용한다. 이후 `setState` 변경은 server-side
 * markup 에 반영되지 않으므로, 테스트는 `@/features/auth/store` 를 vi.mock
 * 으로 갈아끼워 user / role 을 직접 주입한다. listReviewers 의 useEffect
 * 호출은 SSR 에서 실행되지 않으므로 별도 spy 검증은 BE 통합 테스트에 위임.
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
  transitionStatus: vi.fn(),
}))

import { WorkflowRibbon } from '../WorkflowRibbon'

const setRole = (role: string | null) => {
  mockUser = role ? { id: 'u', role } : null
}

describe('<WorkflowRibbon />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = null
  })

  it('shows the status badge regardless of role', () => {
    setRole('reader')
    const html = renderToStaticMarkup(
      <WorkflowRibbon slug="x" status="draft" />,
    )
    expect(html).toContain('data-testid="workflow-ribbon"')
    expect(html).toContain('data-testid="workflow-status-draft"')
    expect(html).toContain('초안')
  })

  it('draft + editor → "리뷰 요청" button', () => {
    setRole('editor')
    const html = renderToStaticMarkup(
      <WorkflowRibbon slug="x" status="draft" />,
    )
    expect(html).toContain('data-testid="workflow-action-request-review"')
    expect(html).toContain('리뷰 요청')
  })

  it('draft + reader → no transition buttons', () => {
    setRole('reader')
    const html = renderToStaticMarkup(
      <WorkflowRibbon slug="x" status="draft" />,
    )
    expect(html).not.toContain('data-testid="workflow-action-request-review"')
  })

  it('in_review + editor → back-to-draft + approve buttons', () => {
    setRole('editor')
    const html = renderToStaticMarkup(
      <WorkflowRibbon slug="x" status="in_review" />,
    )
    expect(html).toContain('data-testid="workflow-action-back-to-draft"')
    expect(html).toContain('data-testid="workflow-action-approve"')
  })

  it('approved + editor → publish button', () => {
    setRole('editor')
    const html = renderToStaticMarkup(
      <WorkflowRibbon slug="x" status="approved" />,
    )
    expect(html).toContain('data-testid="workflow-action-publish"')
    expect(html).toContain('게시')
  })

  it('published + admin → archive button', () => {
    setRole('admin')
    const html = renderToStaticMarkup(
      <WorkflowRibbon slug="x" status="published" />,
    )
    expect(html).toContain('data-testid="workflow-action-archive"')
  })

  it('published + editor (non-admin) → no archive button', () => {
    setRole('editor')
    const html = renderToStaticMarkup(
      <WorkflowRibbon slug="x" status="published" />,
    )
    expect(html).not.toContain('data-testid="workflow-action-archive"')
  })

  it('archived + admin → unarchive button', () => {
    setRole('admin')
    const html = renderToStaticMarkup(
      <WorkflowRibbon slug="x" status="archived" />,
    )
    expect(html).toContain('data-testid="workflow-action-unarchive"')
  })
})
