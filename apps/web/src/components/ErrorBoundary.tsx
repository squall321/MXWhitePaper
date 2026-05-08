import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

// 주의: 이 boundary 는 `<BrowserRouter>` 보다 *바깥*에 마운트된다 (main.tsx).
// 따라서 fallback 안에서는 react-router 의 `<Link>` 를 쓸 수 없다.
// 라우터 컨텍스트가 없어 `Cannot destructure 'basename' of useContext(...) === null`
// 로 fallback 자체가 또 죽는다. 평범한 `<a href>` 만 사용한다.

interface State {
  error: Error | null
}

/**
 * Global error boundary — catches render-time exceptions in any descendant
 * and shows a friendly fallback instead of a blank screen.
 *
 * Mounted once at the AppShell root so a single broken component doesn't
 * unmount the whole site.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info)
    try {
      // 진단 보조: 사용자가 페이지 캡처해 보낼 수 있도록 stack 을 dom 에 박는다.
      const root = document.getElementById('mxwp-error-trace')
      if (root) root.textContent = `${error.message}\n\n${error.stack ?? ''}\n\n${info.componentStack ?? ''}`
    } catch {
      /* no-op */
    }
  }

  handleReset = (): void => {
    this.setState({ error: null })
  }

  handleHardReset = (): void => {
    try {
      window.sessionStorage.clear()
      window.localStorage.clear()
    } catch {
      /* private mode */
    }
    location.assign('/')
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-prose px-6 py-16">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <h2 className="text-lg font-semibold text-red-700">
              화면을 그리는 중 문제가 발생했어요
            </h2>
            <p className="mt-2 text-sm text-red-600">
              {this.state.error.message}
            </p>
            <p className="mt-3 text-xs text-gray-500">
              새로고침으로 복구되는 경우가 많습니다. 반복되면 콘솔 로그를 확인해 주세요.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => location.reload()}
                className="rounded bg-smsg-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-smsg-900"
              >
                새로고침
              </button>
              <button
                type="button"
                onClick={this.handleHardReset}
                className="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
                title="모든 세션/로컬 스토리지를 비우고 홈으로 이동합니다"
              >
                전체 초기화 (스토리지 비우기)
              </button>
              <a
                href="/diag"
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                진단 페이지
              </a>
              <a
                href="/"
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                홈으로
              </a>
            </div>
            <details className="mt-4" open={import.meta.env.DEV}>
              <summary className="cursor-pointer text-xs text-gray-500">
                스택 트레이스 / 진단
              </summary>
              <pre
                id="mxwp-error-trace"
                className="mt-2 max-h-80 overflow-auto rounded bg-white p-2 text-[11px] text-gray-700"
              >
                {this.state.error.stack ?? this.state.error.message}
              </pre>
            </details>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
