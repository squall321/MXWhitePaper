import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  children: ReactNode
}

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
  }

  handleReset = (): void => {
    this.setState({ error: null })
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
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => location.reload()}
                className="rounded bg-smsg-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-smsg-900"
              >
                새로고침
              </button>
              <Link
                to="/"
                onClick={this.handleReset}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                홈으로
              </Link>
            </div>
            {import.meta.env.DEV && this.state.error.stack && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-gray-500">
                  스택 트레이스 (개발 모드)
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-white p-2 text-[11px] text-gray-700">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
