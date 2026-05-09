import { Fragment, type ReactNode } from 'react'
import type {
  Block,
  DocumentJSONV10,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'
import {
  diffDocument,
  type BlockDiff,
  type DocDiff,
  type SectionDiff,
} from '@/features/editor/diff/document-diff'
import { diffWords } from './lineDiff'

type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3

interface InlineDiffProps {
  before: DocumentJSONV10
  after: DocumentJSONV10
  /** Optional precomputed diff (avoid recompute when caller has it already). */
  diff?: DocDiff
}

/**
 * Renders an inline (unified) diff of two DocumentJSONV10 snapshots:
 *
 *   - section status (added / removed / changed) is marked on the heading
 *   - each block:
 *       added    → green background
 *       removed  → red strikethrough
 *       changed  → yellow background; for text-bearing blocks the body
 *                  shows a word-level inline diff
 *   - unchanged sections render plain titles for context (no body) so the
 *     diff stays readable; unchanged blocks are skipped entirely.
 *
 * The viewer is read-only and emits no events — it mounts under a route
 * boundary and is fed by the VersionDiff page.
 */
export function InlineDiff({ before, after, diff }: InlineDiffProps) {
  const d = diff ?? diffDocument(before, after)

  // index sections by id on each side so we can pull bodies during render.
  const beforeSections = indexSections(before.sections as AnySection[])
  const afterSections = indexSections(after.sections as AnySection[])

  // sections in the order they appear on the "after" side, with diff overlays.
  const sectionOrder = orderSections(after.sections as AnySection[])
  // sections that were removed (only on "before") — append at the end so
  // the user still sees what disappeared.
  const removedIds = d.sections
    .filter((s) => s.status === 'removed')
    .map((s) => s.id)

  const sectionDiffById = new Map<string, SectionDiff>(
    d.sections.map((s) => [s.id, s]),
  )

  const hasChanges =
    d.sections.length > 0 ||
    d.scalars.length > 0 ||
    d.metadata.length > 0 ||
    d.infobox.length > 0

  if (!hasChanges) {
    return (
      <div className="space-y-4 px-1 py-2 text-sm" data-testid="inline-diff-root">
        <p className="text-gray-500" data-testid="inline-diff-empty">
          변경 사항이 없습니다.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 px-1 py-2 text-sm" data-testid="inline-diff-root">
      {sectionOrder.map((sid) => {
        const sec = afterSections.get(sid)
        const sd = sectionDiffById.get(sid)
        // Skip unchanged sections to keep the inline view scoped to actual diff
        if (!sec) return null
        if (!sd) return null
        return (
          <SectionView
            key={sid}
            after={sec}
            before={beforeSections.get(sid)}
            diff={sd}
          />
        )
      })}
      {removedIds.map((sid) => {
        const sec = beforeSections.get(sid)
        if (!sec) return null
        return (
          <SectionView
            key={`r-${sid}`}
            after={undefined}
            before={sec}
            diff={sectionDiffById.get(sid)}
          />
        )
      })}
    </div>
  )
}

function SectionView({
  before,
  after,
  diff,
}: {
  before?: AnySection
  after?: AnySection
  diff?: SectionDiff
}) {
  const status = diff?.status ?? 'unchanged'
  const present = after ?? before
  if (!present) return null
  const titleClass =
    status === 'added'
      ? 'bg-green-100 text-green-900'
      : status === 'removed'
        ? 'bg-red-100 text-red-900 line-through'
        : status === 'changed'
          ? 'bg-yellow-100 text-yellow-900'
          : ''
  const headingTag = (`h${(present.level ?? 1) + 1}` as 'h2' | 'h3' | 'h4')
  const Heading = headingTag

  // For changed sections with a title diff, render word-level title diff.
  let titleNode: ReactNode = present.title
  if (status === 'changed' && diff?.titleChanged && before && after) {
    titleNode = renderWordDiff(before.title, after.title)
  }

  return (
    <section data-section-id={present.id} data-status={status} className="space-y-2">
      <Heading className={`rounded px-1 font-semibold ${titleClass}`}>
        <span className="mr-1 text-xs font-mono text-gray-500">[{statusLabel(status)}]</span>
        {titleNode}
      </Heading>
      {/* Block diffs */}
      {(diff?.blockDiffs ?? []).map((bd) => (
        <BlockView
          key={bd.id}
          bd={bd}
          before={findBlock(before, bd.id)}
          after={findBlock(after, bd.id)}
        />
      ))}
      {/* For added sections (no diff baseline), render every block as added */}
      {status === 'added' && after &&
        (diff?.blockDiffs?.length ?? 0) === 0 &&
        after.blocks.map((b) => (
          <div
            key={b.id}
            className="rounded bg-green-50 px-2 py-1"
            data-block-id={b.id}
            data-status="added"
          >
            <span className="mr-1 text-xs font-mono text-green-700">[+]</span>
            {extractText(b)}
          </div>
        ))}
      {/* For removed sections, render every block as removed */}
      {status === 'removed' && before &&
        (diff?.blockDiffs?.length ?? 0) === 0 &&
        before.blocks.map((b) => (
          <div
            key={b.id}
            className="rounded bg-red-50 px-2 py-1 line-through"
            data-block-id={b.id}
            data-status="removed"
          >
            <span className="mr-1 text-xs font-mono text-red-700">[-]</span>
            {extractText(b)}
          </div>
        ))}
    </section>
  )
}

function BlockView({
  bd,
  before,
  after,
}: {
  bd: BlockDiff
  before?: Block
  after?: Block
}) {
  if (bd.status === 'unchanged') return null
  if (bd.status === 'moved' && !bd.fieldChanges.length) {
    // Just moved — show a small marker, body unchanged.
    const blk = after ?? before
    return (
      <div
        data-block-id={bd.id}
        data-status="moved"
        className="rounded bg-blue-50 px-2 py-1 text-blue-900"
      >
        <span className="mr-1 text-xs font-mono">[~ moved]</span>
        {blk ? extractText(blk) : ''}
      </div>
    )
  }
  if (bd.status === 'added' && after) {
    return (
      <div
        data-block-id={bd.id}
        data-status="added"
        className="rounded bg-green-50 px-2 py-1"
      >
        <span className="mr-1 text-xs font-mono text-green-700">[+]</span>
        {extractText(after)}
      </div>
    )
  }
  if (bd.status === 'removed' && before) {
    return (
      <div
        data-block-id={bd.id}
        data-status="removed"
        className="rounded bg-red-50 px-2 py-1 line-through"
      >
        <span className="mr-1 text-xs font-mono text-red-700">[-]</span>
        {extractText(before)}
      </div>
    )
  }
  if (bd.status === 'changed' && before && after) {
    const beforeText = extractText(before)
    const afterText = extractText(after)
    const sameType = before.type === after.type
    return (
      <div
        data-block-id={bd.id}
        data-status="changed"
        className="rounded bg-yellow-50 px-2 py-1"
      >
        <span className="mr-1 text-xs font-mono text-yellow-800">
          [~{sameType ? '' : ` ${before.type}→${after.type}`}]
        </span>
        {sameType ? renderWordDiff(beforeText, afterText) : (
          <Fragment>
            <span className="line-through text-red-700">{beforeText}</span>
            {' → '}
            <span className="text-green-700">{afterText}</span>
          </Fragment>
        )}
      </div>
    )
  }
  return null
}

function renderWordDiff(a: string, b: string): ReactNode {
  const ops = diffWords(a, b)
  return (
    <span data-testid="word-diff">
      {ops.map((op, i) => {
        if (op.kind === 'equal') return <span key={i}>{op.value}</span>
        if (op.kind === 'add')
          return (
            <span key={i} className="bg-green-200 text-green-900" data-op="add">
              {op.value}
            </span>
          )
        return (
          <span
            key={i}
            className="bg-red-200 text-red-900 line-through"
            data-op="remove"
          >
            {op.value}
          </span>
        )
      })}
    </span>
  )
}

function statusLabel(s: string): string {
  switch (s) {
    case 'added':
      return '+'
    case 'removed':
      return '-'
    case 'changed':
      return '~'
    case 'moved':
      return '↕'
    default:
      return '·'
  }
}

function indexSections(secs: AnySection[]): Map<string, AnySection> {
  const m = new Map<string, AnySection>()
  const walk = (s: AnySection[]): void => {
    for (const sec of s) {
      m.set(sec.id, sec)
      const subs = (sec as SectionLevel1).subsections as AnySection[] | undefined
      if (subs) walk(subs)
    }
  }
  walk(secs)
  return m
}

/** Flatten section ids in render order (depth-first). */
function orderSections(secs: AnySection[]): string[] {
  const out: string[] = []
  const walk = (s: AnySection[]): void => {
    for (const sec of s) {
      out.push(sec.id)
      const subs = (sec as SectionLevel1).subsections as AnySection[] | undefined
      if (subs) walk(subs)
    }
  }
  walk(secs)
  return out
}

function findBlock(sec: AnySection | undefined, id: string): Block | undefined {
  if (!sec) return undefined
  return sec.blocks.find((b) => b.id === id)
}

/** Best-effort plain-text extraction across the supported block types. */
function extractText(block: Block): string {
  const b = block as unknown as Record<string, unknown>
  if (typeof b.text === 'string') return b.text
  if (typeof b.title === 'string') return b.title
  if (Array.isArray(b.items)) return (b.items as unknown[]).join('\n')
  if (typeof b.code === 'string') return b.code
  if (typeof b.url === 'string') return b.url
  return `(${block.type})`
}
