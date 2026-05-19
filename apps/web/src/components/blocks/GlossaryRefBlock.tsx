import type { GlossaryRefBlock } from '@/types/document'
import { useGlossary } from '@/features/glossary/useGlossary'

/**
 * Glossary reference block. Looks up the term in the glossary cache (warm
 * via `/api/v1/glossary?q=`) and renders the definition.
 *
 * Broken-ref (term not in glossary) — pass-2 M11 — surfaces a ⚠️ icon and
 * neutral gray styling instead of the smsg accent, so authors can spot
 * dangling references at a glance.
 */
export function GlossaryRefBlockView({ block }: { block: GlossaryRefBlock }) {
  const { lookup } = useGlossary()
  const def = lookup(block.term)
  const broken = !def

  const containerCls = broken
    ? 'rounded border-l-4 border-gray-400 bg-gray-100 p-3 text-sm'
    : 'rounded border-l-4 border-smsg-500 bg-smsg-100/50 p-3 text-sm'
  const labelCls = broken
    ? 'text-xs font-semibold uppercase tracking-wide text-gray-600'
    : 'text-xs font-semibold uppercase tracking-wide text-smsg-700'
  const termCls = broken ? 'text-gray-900' : 'text-smsg-900'

  return (
    <aside className={containerCls} data-glossary-ref-broken={broken ? '' : undefined}>
      <p className={labelCls}>용어</p>
      <p className="mt-1">
        {broken && (
          <span aria-label="용어 정의 없음" title="용어 사전에서 찾지 못함" className="mr-1">
            ⚠️
          </span>
        )}
        <strong className={termCls}>{block.term}</strong>
        {def ? (
          <span className="ml-2 text-gray-700">— {def}</span>
        ) : (
          <span className="ml-2 text-gray-500">(용어 사전에 없음)</span>
        )}
      </p>
    </aside>
  )
}
