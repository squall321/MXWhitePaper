import { Component, type ErrorInfo, type ReactNode } from 'react'

interface BlockBoundaryProps {
  /** Block type used in the fallback message — purely informational. */
  blockType?: string
  children: ReactNode
}

interface BlockBoundaryState {
  error: Error | null
}

/**
 * Per-block error boundary. Wrapping each block in its own boundary ensures
 * that one bad widget (e.g. a malformed chart, KaTeX/math parse error,
 * Mermaid throw) doesn't kill the surrounding article.
 *
 * Behaviour:
 *   - Catches render-time exceptions in descendants.
 *   - Renders a small red placeholder identifying the offending block type.
 *   - Logs to the console so developers can trace the underlying error.
 */
export class BlockBoundary extends Component<BlockBoundaryProps, BlockBoundaryState> {
  override state: BlockBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BlockBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
     
    console.error(`[BlockBoundary] type=${this.props.blockType ?? 'unknown'}`, error, info)
  }

  override render(): ReactNode {
    if (this.state.error) {
      const type = this.props.blockType ?? 'unknown'
      return (
        <div
          role="alert"
          data-block-error={type}
          className="my-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          이 블록을 표시할 수 없습니다 (type={type}).
        </div>
      )
    }
    return this.props.children
  }
}

interface RailBoundaryProps {
  /** Display name of the rail panel — informational. */
  name: string
  children: ReactNode
}

interface RailBoundaryState {
  error: Error | null
}

/**
 * Per-rail error boundary. Same pattern as BlockBoundary but tuned for the
 * right-hand panels (TOC / Backlinks / RelatedDocs / Glossary / RecentRail).
 * A failed panel collapses to a tiny notice instead of taking down the page.
 */
export class RailBoundary extends Component<RailBoundaryProps, RailBoundaryState> {
  override state: RailBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RailBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
     
    console.error(`[RailBoundary] name=${this.props.name}`, error, info)
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-rail-error={this.props.name}
          className="m-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {this.props.name} 패널을 표시할 수 없습니다.
        </div>
      )
    }
    return this.props.children
  }
}
