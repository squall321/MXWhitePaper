import { useEffect, useRef } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { MathBlock } from '@/types/document'

/**
 * Render a `math` block via KaTeX. `display: 'block'` (default) renders as
 * a centered math display; `display: 'inline'` renders inline. KaTeX errors
 * are caught and the raw expression is shown so the article doesn't blank.
 */
export function MathBlockView({ block }: { block: MathBlock }) {
  const ref = useRef<HTMLSpanElement>(null)
  const displayMode = (block.display ?? 'block') === 'block'

  useEffect(() => {
    const el = ref.current
    if (!el) return
    try {
      katex.render(block.expression, el, {
        displayMode,
        throwOnError: false,
        strict: 'ignore',
      })
    } catch {
      el.textContent = block.expression
    }
  }, [block.expression, displayMode])

  if (displayMode) {
    return (
      <div className="my-3 overflow-x-auto text-center">
        <span ref={ref} aria-label="수식" />
      </div>
    )
  }
  return <span ref={ref} aria-label="수식" className="inline-block max-w-full overflow-x-auto" />
}
