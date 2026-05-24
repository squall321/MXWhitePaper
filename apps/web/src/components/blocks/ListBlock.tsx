import type { ListBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'
import { getZebraClass } from '@/features/editor/blocks/zebra'

/**
 * List block — bullet / number / check.  Check items render an inert
 * checkbox (read-only in Sprints 2/3; interactive flips arrive in Sprint 5).
 *
 * Nesting (flat-string-with-indent-prefix): an item's depth is encoded as
 * `"  " * depth + "actual text"` (2-space pairs, max depth 4). Renderer
 * strips the indent for display, applies `padding-left: depth * 1.5rem`,
 * and picks marker glyphs / numbering by depth. Mirrors ListBlockEditor.
 */
const MAX_DEPTH = 4
const INDENT_UNIT = '  '

function countDepth(item: string): number {
  let depth = 0
  let i = 0
  while (depth < MAX_DEPTH && item.startsWith(INDENT_UNIT, i)) {
    depth++
    i += INDENT_UNIT.length
  }
  return depth
}

function stripIndent(item: string): string {
  let i = 0
  while (item.startsWith(INDENT_UNIT, i)) i += INDENT_UNIT.length
  return item.slice(i)
}

function bulletGlyph(depth: number): string {
  if (depth <= 0) return '•'
  if (depth === 1) return '◦'
  return '▪'
}

function toRoman(n: number): string {
  if (n <= 0) return ''
  const map: [number, string][] = [
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let out = ''
  let rem = n
  for (const [val, sym] of map) {
    while (rem >= val) {
      out += sym
      rem -= val
    }
  }
  return out
}

function numberedMarker(depth: number, indexAtDepth: number): string {
  const mod = depth % 3
  if (mod === 0) return `${indexAtDepth + 1}.`
  if (mod === 1) return `${String.fromCharCode(97 + (indexAtDepth % 26))}.`
  return `${toRoman(indexAtDepth + 1)}.`
}

const isChecked = (visible: string) => /^\s*\[[xX]\]\s*/.test(visible)
const stripCheckPrefix = (s: string) => s.replace(/^\s*\[[xX\s]\]\s*/, '')

export function ListBlockView({ block }: { block: ListBlock }) {
  // Per-depth running indices for numbered lists. Reset deeper levels when
  // the depth shrinks so each nested level restarts at 1.
  const depthCounters: number[] = []
  let lastDepth = -1
  // Top-level (depth=0) running counter used as the zebra row index. Nested
  // items reuse the previous depth-0 index (no stripe applied to them).
  let depth0Idx = -1
  const enriched = block.items.map((raw) => {
    const depth = countDepth(raw)
    if (depth !== lastDepth) {
      if (depth > lastDepth) {
        depthCounters[depth] = 0
      } else {
        for (let d = depth + 1; d < depthCounters.length; d++) {
          depthCounters[d] = 0
        }
      }
    }
    const indexAtDepth = depthCounters[depth] ?? 0
    depthCounters[depth] = indexAtDepth + 1
    lastDepth = depth
    if (depth === 0) depth0Idx++
    return {
      raw,
      depth,
      indexAtDepth,
      depth0Idx,
      visible: stripIndent(raw),
    }
  })

  const zebraFor = (depth: number, idx: number) =>
    depth === 0 ? getZebraClass('list', block.options, idx) : ''

  if (block.style === 'number') {
    return (
      <ul className="space-y-1 text-[15px] leading-7 text-smsg-900">
        {enriched.map(({ visible, depth, indexAtDepth, depth0Idx }, i) => {
          const zebra = zebraFor(depth, depth0Idx)
          return (
            <li
              key={i}
              className={`flex items-start gap-2${zebra ? ` ${zebra}` : ''}`}
              style={{ paddingLeft: `${depth * 1.5}rem` }}
              data-depth={depth}
            >
              <span className="mt-0 inline-block min-w-[1.5rem] text-right text-gray-500">
                {numberedMarker(depth, indexAtDepth)}
              </span>
              <span className="flex-1">
                <Inline text={visible} />
              </span>
            </li>
          )
        })}
      </ul>
    )
  }
  if (block.style === 'check') {
    return (
      <ul className="space-y-1 text-[15px] leading-7 text-smsg-900">
        {enriched.map(({ visible, depth, depth0Idx }, i) => {
          const checked = isChecked(visible)
          const display = stripCheckPrefix(visible)
          const zebra = zebraFor(depth, depth0Idx)
          return (
            <li
              key={i}
              className={`flex items-start gap-2${zebra ? ` ${zebra}` : ''}`}
              style={{ paddingLeft: `${depth * 1.5}rem` }}
              data-depth={depth}
            >
              <input
                type="checkbox"
                disabled
                checked={checked}
                readOnly
                className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600"
                aria-label={`체크 ${i + 1}`}
              />
              <span>
                <Inline text={display} />
              </span>
            </li>
          )
        })}
      </ul>
    )
  }
  return (
    <ul className="space-y-1 text-[15px] leading-7 text-smsg-900">
      {enriched.map(({ visible, depth, depth0Idx }, i) => {
        const zebra = zebraFor(depth, depth0Idx)
        return (
          <li
            key={i}
            className={`flex items-start gap-2${zebra ? ` ${zebra}` : ''}`}
            style={{ paddingLeft: `${depth * 1.5}rem` }}
            data-depth={depth}
          >
            <span aria-hidden className="mt-0 inline-block min-w-[0.75rem] text-gray-500">
              {bulletGlyph(depth)}
            </span>
            <span className="flex-1">
              <Inline text={visible} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}
