import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Friendly route name shown in the fallback heading. */
  routeName?: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Lightweight per-route error boundary. Mounted around every lazy route in
 * `main.tsx` so a render-time exception in `<DocumentReader>` (for example)
 * doesn't unmount the rest of the app — the user can still navigate Home.
 *
 * Distinct from the global `<ErrorBoundary>` (which wraps the BrowserRouter)
 * in two ways:
 *   1. Recoverable: clicking "다시 시도" resets local state so the user can
 *      retry without a hard reload.
 *   2. Scoped: the fallback fits inside whatever shell wraps it (so the
 *      TopBar/Drawer remains visible on a broken page).
 */
export class RouteBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
     
    console.error('[RouteBoundary]', this.props.routeName ?? '(unknown)', error, info)
  }

  reset = (): void => this.setState({ error: null })

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    const { error } = this.state
    return (
      <div role="alert" className="mx-auto max-w-prose px-4 py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <h2 className="text-base font-semibold text-red-700">
            이 페이지를 표시하는 중 문제가 발생했습니다
          </h2>
          {this.props.routeName && (
            <p className="mt-1 text-xs text-red-600">경로: {this.props.routeName}</p>
          )}
          <p className="mt-2 text-sm text-red-800">{error.message}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="rounded bg-smsg-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-smsg-900"
            >
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => location.reload()}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              새로고침
            </button>
          </div>
          {import.meta.env.DEV && error.stack && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-500">스택 트레이스 (개발 모드)</summary>
              <pre className="mt-2 overflow-auto rounded bg-white p-2 text-[11px] text-gray-700">{error.stack}</pre>
            </details>
          )}
        </div>
      </div>
    )
  }
}
