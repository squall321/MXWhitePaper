import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App } from './App'
import { AuthGuard } from './components/AuthGuard'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RouteBoundary } from './components/RouteBoundary'
import { BootBanner } from './components/BootBanner'
import { ThemeProvider } from './features/theme/ThemeProvider'
import { bootstrapAuth } from './bootstrap'
import './styles/tokens.css'

/**
 * `lazy()` 로 코드 스플릿된 청크는 네트워크/배포 문제로 로드 실패 시
 * 그냥 사라져 흰 화면이 된다. 사용자가 무엇이 안 떴는지 알 수 있도록
 * 실패 청크의 이름을 콘솔에 남긴다.
 */
// `lazy` 호출에 청크 로드 실패 로깅을 끼워넣는 헬퍼. lazy 의 시그니처가
// `ComponentType<any>` 를 요구해서, 호출처에서 prop 타입(예: TagPage 의
// `mode`)이 살아 있도록 lazy 의 반환을 동일 타입으로 단언한다.
function lazyLogged<T extends React.ComponentType<never>>(
  name: string,
  factory: () => Promise<{ default: T }>,
): T {
  const wrapped = lazy(() =>
    factory().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`[mxwp] lazy chunk failed: ${name}`, err)
      throw err
    }) as unknown as Promise<{ default: React.ComponentType<unknown> }>,
  )
  return wrapped as unknown as T
}

/**
 * Wrap a lazy route in a `<RouteBoundary>` so a render error inside that
 * page doesn't unmount the AppShell or sibling routes. The boundary key is
 * the route name so navigating between routes resets the error state.
 */
function Boundaried({ name, children }: { name: string; children: React.ReactNode }) {
  return <RouteBoundary routeName={name}>{children}</RouteBoundary>
}

// Route-level code-split: heavy pages (editor/reader/new doc) load on demand
// so the initial bundle stays small. Login is also lazy because it's a leaf.
const HomePage = lazyLogged('Home', () =>
  import('./pages/Home').then((m) => ({ default: m.HomePage })),
)
const DocumentReaderPage = lazyLogged('DocumentReader', () =>
  import('./pages/DocumentReader').then((m) => ({ default: m.DocumentReaderPage })),
)
const VersionDiffPage = lazyLogged('VersionDiff', () =>
  import('./pages/VersionDiff').then((m) => ({ default: m.VersionDiffPage })),
)
const CrossDocComparePage = lazyLogged('CrossDocCompare', () =>
  import('./pages/CrossDocCompare').then((m) => ({ default: m.CrossDocComparePage })),
)
const DocumentNewPage = lazyLogged('DocumentNew', () =>
  import('./pages/DocumentNew').then((m) => ({ default: m.DocumentNewPage })),
)
const DocumentImportPage = lazyLogged('DocumentImport', () =>
  import('./pages/DocumentImport').then((m) => ({ default: m.DocumentImportPage })),
)
const DocumentVariablesPage = lazyLogged('DocumentVariables', () =>
  import('./pages/DocumentVariables').then((m) => ({
    default: m.DocumentVariablesPage,
  })),
)
const OrgsPage = lazyLogged('Orgs', () =>
  import('./pages/Orgs').then((m) => ({ default: m.OrgsPage })),
)
const AdminOrgsPage = lazyLogged('AdminOrgs', () =>
  import('./pages/AdminOrgs').then((m) => ({ default: m.AdminOrgsPage })),
)
const AdminDashboardPage = lazyLogged('AdminDashboard', () =>
  import('./pages/AdminDashboard').then((m) => ({ default: m.AdminDashboardPage })),
)
const AnalyticsPage = lazyLogged('Analytics', () =>
  import('./pages/Analytics').then((m) => ({ default: m.AnalyticsPage })),
)
const TagManagerPage = lazyLogged('TagManager', () =>
  import('./pages/TagManager').then((m) => ({ default: m.TagManagerPage })),
)
const RecentPage = lazyLogged('Recent', () =>
  import('./pages/Recent').then((m) => ({ default: m.RecentPage })),
)
const ActivityFeedPage = lazyLogged('ActivityFeed', () =>
  import('./pages/ActivityFeed').then((m) => ({ default: m.ActivityFeedPage })),
)
const ReadListPage = lazyLogged('ReadList', () =>
  import('./pages/ReadList').then((m) => ({ default: m.ReadListPage })),
)
const MyReviewsPage = lazyLogged('MyReviews', () =>
  import('./pages/MyReviews').then((m) => ({ default: m.MyReviewsPage })),
)
const SettingsPage = lazyLogged('Settings', () =>
  import('./pages/Settings').then((m) => ({ default: m.SettingsPage })),
)
const SnippetManagerPage = lazyLogged('SnippetManager', () =>
  import('./pages/SnippetManager').then((m) => ({ default: m.SnippetManagerPage })),
)
const SeriesManagerPage = lazyLogged('SeriesManager', () =>
  import('./pages/SeriesManager').then((m) => ({ default: m.SeriesManagerPage })),
)
const SeriesDetailPage = lazyLogged('SeriesDetail', () =>
  import('./pages/SeriesDetail').then((m) => ({ default: m.SeriesDetailPage })),
)
// `TagPage` accepts a `mode` prop, which doesn't fit `lazyLogged`'s
// component-with-no-props generic. Use `React.lazy` directly + manual log.
const TagPage = lazy(() =>
  import('./pages/TagPage')
    .then((m) => ({ default: m.TagPage }))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[mxwp] lazy chunk failed: TagPage', err)
      throw err
    }),
)
const LoginPage = lazyLogged('Login', () =>
  import('./pages/Login').then((m) => ({ default: m.LoginPage })),
)
const NotFoundPage = lazyLogged('NotFound', () =>
  import('./pages/NotFound').then((m) => ({ default: m.NotFoundPage })),
)
const PresentationPage = lazyLogged('Presentation', () =>
  import('./pages/Presentation').then((m) => ({ default: m.PresentationPage })),
)
const SharedDocViewPage = lazyLogged('SharedDocView', () =>
  import('./pages/SharedDocView').then((m) => ({ default: m.SharedDocViewPage })),
)
const PresenterViewPage = lazyLogged('PresenterView', () =>
  import('./features/presentation/PresenterView').then((m) => ({
    default: m.PresenterViewPage,
  })),
)
const GraphPage = lazyLogged('Graph', () =>
  import('./pages/Graph').then((m) => ({ default: m.GraphPage })),
)
const DiagPage = lazyLogged('Diag', () =>
  import('./pages/Diag').then((m) => ({ default: m.DiagPage })),
)

function PageFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-gray-500">
      불러오는 중…
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false },
  },
})

// `?reset` URL flag: 사용자가 망가진 클라이언트 상태를 한 번에 비울 수
// 있게 한다. 흰 화면이 떴을 때 콘솔 못 열어도 URL 만으로 회복 가능.
function maybeResetAndRedirect(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search)
    if (!sp.has('reset')) return false
    window.sessionStorage.clear()
    window.localStorage.clear()
    sp.delete('reset')
    const q = sp.toString()
    location.replace(window.location.pathname + (q ? `?${q}` : ''))
    return true
  } catch {
    return false
  }
}

if (!maybeResetAndRedirect()) {
  try {
    bootstrapAuth()
    mountReact()
  } catch (err) {
    // 마운트 자체가 실패하면 React 가 아직 안 깔린 상태이므로 평범한
    // HTML 로 진단 메시지를 박아 사용자에게 흰 화면이 아닌 "원인 + /diag
    // 링크" 를 보여 준다.
    // eslint-disable-next-line no-console
    console.error('[mxwp] mount failed', err)
    const root = document.getElementById('root')
    const e = err as Error
    if (root) {
      root.innerHTML =
        '<div style="font:13px/1.5 system-ui;padding:24px;max-width:640px;margin:0 auto">' +
        '<h1 style="color:#b91c1c">화면을 그리지 못했습니다 (mount failed)</h1>' +
        `<pre style="white-space:pre-wrap;background:#fef2f2;border:1px solid #fecaca;padding:8px;border-radius:6px">${escapeHtml(e?.message ?? String(err))}\n\n${escapeHtml(e?.stack ?? '')}</pre>` +
        '<p>· <a href="/diag">진단 페이지 열기</a></p>' +
        '<p>· <a href="/?reset">스토리지 비우고 새로고침</a></p>' +
        '</div>'
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mountReact() {

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <ThemeProvider>
        <BrowserRouter>
          <BootBanner />
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route
                path="/login"
                element={<Boundaried name="login"><LoginPage /></Boundaried>}
              />
              <Route
                path="/diag"
                element={<Boundaried name="diag"><DiagPage /></Boundaried>}
              />
              {/* Public share route — bypasses AuthGuard so non-employees
                  with a valid token can land here without logging in. */}
              <Route
                path="/share/:token"
                element={<Boundaried name="share"><SharedDocViewPage /></Boundaried>}
              />
              <Route
                path="/present/:slug"
                element={
                  <AuthGuard>
                    <Boundaried name="present"><PresentationPage /></Boundaried>
                  </AuthGuard>
                }
              />
              <Route
                path="/present/:slug/notes"
                element={
                  <AuthGuard>
                    <Boundaried name="presenter"><PresenterViewPage /></Boundaried>
                  </AuthGuard>
                }
              />
              <Route
                element={
                  <AuthGuard>
                    <App />
                  </AuthGuard>
                }
              >
                <Route index element={<Boundaried name="home"><HomePage /></Boundaried>} />
                <Route path="docs/new" element={<Boundaried name="docs/new"><DocumentNewPage /></Boundaried>} />
                <Route path="docs/import" element={<Boundaried name="docs/import"><DocumentImportPage /></Boundaried>} />
                <Route path="docs/:slug" element={<Boundaried name="docs/:slug"><DocumentReaderPage /></Boundaried>} />
                <Route path="docs/:slug/variables" element={<Boundaried name="docs/:slug/variables"><DocumentVariablesPage /></Boundaried>} />
                <Route
                  path="docs/:slug/versions/:from/diff/:to"
                  element={<Boundaried name="docs/:slug/diff"><VersionDiffPage /></Boundaried>}
                />
                <Route
                  path="compare"
                  element={<Boundaried name="compare"><CrossDocComparePage /></Boundaried>}
                />
                <Route path="orgs" element={<Boundaried name="orgs"><OrgsPage /></Boundaried>} />
                <Route path="admin/orgs" element={<Boundaried name="admin/orgs"><AdminOrgsPage /></Boundaried>} />
                <Route path="admin/dashboard" element={<Boundaried name="admin/dashboard"><AdminDashboardPage /></Boundaried>} />
                <Route path="admin/tags" element={<Boundaried name="admin/tags"><TagManagerPage /></Boundaried>} />
                <Route path="analytics" element={<Boundaried name="analytics"><AnalyticsPage /></Boundaried>} />
                <Route path="recent" element={<Boundaried name="recent"><RecentPage /></Boundaried>} />
                <Route path="activity" element={<Boundaried name="activity"><ActivityFeedPage /></Boundaried>} />
                <Route path="reads" element={<Boundaried name="reads"><ReadListPage /></Boundaried>} />
                <Route path="reviews" element={<Boundaried name="reviews"><MyReviewsPage /></Boundaried>} />
                <Route path="settings" element={<Boundaried name="settings"><SettingsPage /></Boundaried>} />
                <Route path="snippets" element={<Boundaried name="snippets"><SnippetManagerPage /></Boundaried>} />
                <Route path="series" element={<Boundaried name="series"><SeriesManagerPage /></Boundaried>} />
                <Route path="series/:slug" element={<Boundaried name="series/:slug"><SeriesDetailPage /></Boundaried>} />
                <Route path="graph" element={<Boundaried name="graph"><GraphPage /></Boundaried>} />
                <Route path="graph/:slug" element={<Boundaried name="graph/:slug"><GraphPage /></Boundaried>} />
                <Route path="tags/:tag" element={<Boundaried name="tags"><TagPage mode="tag" /></Boundaried>} />
                <Route path="category/:cat" element={<Boundaried name="category"><TagPage mode="category" /></Boundaried>} />
                <Route path="*" element={<Boundaried name="not-found"><NotFoundPage /></Boundaried>} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
        </ThemeProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>,
)
}
