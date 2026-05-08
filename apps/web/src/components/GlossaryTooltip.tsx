import { Fragment, useMemo } from 'react'
import { useGlossary } from '@/features/glossary/useGlossary'

/**
 * Wraps any glossary term in a `<span class="has-tooltip">` so a
 * CSS hover popover surfaces the definition. Term match is whole-word,
 * case-insensitive, longest-first.
 *
 * If `children` is provided, the function only annotates *that string* and
 * returns the children unchanged when the text contains nothing to mark up.
 * In Sprint 6 we keep the simple behaviour: scan once, annotate the text,
 * and let Inline handle the rest of the rendering.
 */
export function GlossaryTooltip({ text }: { text: string }) {
  const { terms, lookup } = useGlossary()
  const segments = useMemo(() => annotate(text, terms.map((t) => t.term)), [text, terms])
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'term' ? (
          <Term key={i} term={seg.value} definition={lookup(seg.value)} />
        ) : (
          <Fragment key={i}>{seg.value}</Fragment>
        ),
      )}
    </>
  )
}

interface TextSegment { kind: 'text'; value: string }
interface TermSegment { kind: 'term'; value: string }
type Segment = TextSegment | TermSegment

/**
 * Greedy whole-word annotation. We sort terms by length descending so a
 * longer term wins over a shorter one (e.g., "MX" < "MX White Paper").
 * Match is case-insensitive on a Unicode-friendly word boundary.
 */
function annotate(text: string, termList: string[]): Segment[] {
  if (termList.length === 0 || !text) return [{ kind: 'text', value: text }]
  const sorted = [...termList].filter(Boolean).sort((a, b) => b.length - a.length)
  const escaped = sorted.map(escapeRegExp)
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')

  const out: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) })
    out.push({ kind: 'term', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) })
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Term({ term, definition }: { term: string; definition: string | undefined }) {
  if (!definition) return <>{term}</>
  return (
    <span className="group relative cursor-help border-b border-dotted border-smsg-500">
      {term}
      <span
        role="tooltip"
        className="invisible absolute left-1/2 z-30 mt-1 w-64 -translate-x-1/2 translate-y-1 rounded border border-gray-200 bg-white p-2 text-left text-xs text-gray-700 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100"
      >
        <strong className="block text-smsg-900">{term}</strong>
        <span className="mt-1 block">{definition}</span>
      </span>
    </span>
  )
}

