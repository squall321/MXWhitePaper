import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App } from './App'
import { AuthGuard } from './components/AuthGuard'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RouteBoundary } from './components/RouteBoundary'
import { bootstrapAuth } from './bootstrap'
import './styles/tokens.css'

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
const HomePage = lazy(() => import('./pages/Home').then((m) => ({ default: m.HomePage })))
const DocumentReaderPage = lazy(() =>
  import('./pages/DocumentReader').then((m) => ({ default: m.DocumentReaderPage })),
)
const DocumentNewPage = lazy(() =>
  import('./pages/DocumentNew').then((m) => ({ default: m.DocumentNewPage })),
)
const OrgsPage = lazy(() => import('./pages/Orgs').then((m) => ({ default: m.OrgsPage })))
const AdminOrgsPage = lazy(() =>
  import('./pages/AdminOrgs').then((m) => ({ default: m.AdminOrgsPage })),
)
const RecentPage = lazy(() => import('./pages/Recent').then((m) => ({ default: m.RecentPage })))
const LoginPage = lazy(() => import('./pages/Login').then((m) => ({ default: m.LoginPage })))
const NotFoundPage = lazy(() =>
  import('./pages/NotFound').then((m) => ({ default: m.NotFoundPage })),
)
const PresentationPage = lazy(() =>
  import('./pages/Presentation').then((m) => ({ default: m.PresentationPage })),
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

bootstrapAuth()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route
                path="/login"
                element={<Boundaried name="login"><LoginPage /></Boundaried>}
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
                element={
                  <AuthGuard>
                    <App />
                  </AuthGuard>
                }
              >
                <Route index element={<Boundaried name="home"><HomePage /></Boundaried>} />
                <Route path="docs/new" element={<Boundaried name="docs/new"><DocumentNewPage /></Boundaried>} />
                <Route path="docs/:slug" element={<Boundaried name="docs/:slug"><DocumentReaderPage /></Boundaried>} />
                <Route path="orgs" element={<Boundaried name="orgs"><OrgsPage /></Boundaried>} />
                <Route path="admin/orgs" element={<Boundaried name="admin/orgs"><AdminOrgsPage /></Boundaried>} />
                <Route path="recent" element={<Boundaried name="recent"><RecentPage /></Boundaried>} />
                <Route path="*" element={<Boundaried name="not-found"><NotFoundPage /></Boundaried>} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>,
)
