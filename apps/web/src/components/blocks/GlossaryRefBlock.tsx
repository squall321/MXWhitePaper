import type { GlossaryRefBlock } from '@/types/document'
import { useGlossary } from '@/features/glossary/useGlossary'

/**
 * Glossary reference block. Looks up the term in the glossary cache (warm
 * via `/api/v1/glossary?q=`) and renders the definition. Unknown terms
 * fall back to a hint.
 */
export function GlossaryRefBlockView({ block }: { block: GlossaryRefBlock }) {
  const { lookup } = useGlossary()
  const def = lookup(block.term)
  return (
    <aside className="rounded border-l-4 border-smsg-500 bg-smsg-100/50 p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-smsg-700">용어</p>
      <p className="mt-1">
        <strong className="text-smsg-900">{block.term}</strong>
        {def ? (
          <span className="ml-2 text-gray-700">— {def}</span>
        ) : (
          <span className="ml-2 text-gray-400">(정의 없음)</span>
        )}
      </p>
    </aside>
  )
}
