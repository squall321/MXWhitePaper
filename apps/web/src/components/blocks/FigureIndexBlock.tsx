import { useEffect, useMemo, useState } from 'react'

/**
 * Renders a self-updating table of figures.
 *
 * Walks the article DOM after mount and lists every <figure
 * data-block-type=... data-has-caption="true"> with its CSS-counter
 * label and caption text. Three sub-lists (그림/표/차트) controlled
 * by the `kinds` prop. Re-runs when the article mutates (caption
 * edits, block adds/removes) via MutationObserver.
 */
export function FigureIndexBlockView({
  block,
}: {
  block: { title?: string; kinds?: ('image' | 'table' | 'chart')[] }
}) {
  const kinds = block.kinds && block.kinds.length ? block.kinds : (['image', 'table', 'chart'] as const)
  const [entries, setEntries] = useState<
    { kind: 'image' | 'table' | 'chart'; n: number; caption: string }[]
  >([])

  useEffect(() => {
    const root = document.querySelector('article') ?? document.body
    const collect = () => {
      const counters: Record<string, number> = { image: 0, table: 0, chart: 0 }
      const out: { kind: 'image' | 'table' | 'chart'; n: number; caption: string }[] = []
      root.querySelectorAll(
        'figure[data-block-type="image"][data-has-caption="true"], ' +
        'figure[data-block-type="table"][data-has-caption="true"], ' +
        'figure[data-block-type="chart"][data-has-caption="true"]',
      ).forEach((fig) => {
        const kind = (fig as HTMLElement).dataset.blockType as 'image' | 'table' | 'chart'
        counters[kind] = (counters[kind] ?? 0) + 1
        const caption =
          (fig.querySelector('.figure-caption-text') as HTMLElement | null)?.innerText?.trim() ?? ''
        out.push({ kind, n: counters[kind], caption })
      })
      setEntries(out)
    }
    collect()
    const obs = new MutationObserver(() => collect())
    obs.observe(root, { subtree: true, childList: true, characterData: true })
    return () => obs.disconnect()
  }, [])

  const grouped = useMemo(() => {
    return kinds.map((k) => ({
      kind: k,
      label: k === 'image' ? '그림' : k === 'table' ? '표' : '차트',
      entries: entries.filter((e) => e.kind === k),
    }))
  }, [entries, kinds])

  return (
    <aside
      data-block-type="figure-index"
      className="my-3 rounded-md border border-gray-200 bg-gray-50/60 p-3 text-sm"
    >
      <div className="mb-2 font-semibold text-gray-800">{block.title ?? '그림 목차'}</div>
      {grouped.map((g) =>
        g.entries.length === 0 ? null : (
          <div key={g.kind} className="mb-2 last:mb-0">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
              {g.label}
            </div>
            <ol className="ml-3 list-decimal text-gray-700">
              {g.entries.map((e) => (
                <li key={`${e.kind}-${e.n}`}>
                  {g.label} {e.n}: {e.caption || <span className="text-gray-400">(캡션 없음)</span>}
                </li>
              ))}
            </ol>
          </div>
        ),
      )}
      {entries.length === 0 && (
        <div className="text-xs text-gray-400">이 문서에는 캡션이 달린 그림 / 표 / 차트가 없습니다.</div>
      )}
    </aside>
  )
}
