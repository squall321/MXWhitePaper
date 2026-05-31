import { useCallback, useEffect, useMemo, useState } from 'react'
import { getZebraClass } from '@/features/editor/blocks/zebra'
import type { ZebraOpts } from '@/features/editor/blocks/zebra'
import { useT } from '@/lib/i18n'

/**
 * Renders a self-updating table of figures.
 *
 * Walks the article DOM after mount and lists every <figure
 * data-block-type=... data-has-caption="true"> with its CSS-counter
 * label and caption text. Three sub-lists (그림/표/차트) controlled
 * by the `kinds` prop. Re-runs when the article mutates (caption
 * edits, block adds/removes) via MutationObserver — and also when the
 * user clicks the 갱신 button (manual refresh for stubborn cases
 * where the observer missed an async re-render).
 */
export function FigureIndexBlockView({
  block,
}: {
  block: {
    title?: string
    kinds?: ('image' | 'table' | 'chart')[]
    options?: ZebraOpts
  }
}) {
  const t = useT()
  const kinds = block.kinds && block.kinds.length ? block.kinds : (['image', 'table', 'chart'] as const)
  const [entries, setEntries] = useState<
    { kind: 'image' | 'table' | 'chart'; n: number; caption: string }[]
  >([])

  const collect = useCallback(() => {
    const root = document.querySelector('article') ?? document.body
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
  }, [])

  useEffect(() => {
    const root = document.querySelector('article') ?? document.body
    collect()
    const obs = new MutationObserver(() => collect())
    obs.observe(root, { subtree: true, childList: true, characterData: true })
    return () => obs.disconnect()
  }, [collect])

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
      className="my-3 rounded-md border border-gray-200 bg-gray-50/60 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/60"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold text-gray-800">{block.title ?? t('block.figureIndex.defaultTitle')}</div>
        <button
          type="button"
          onClick={collect}
          aria-label={t('block.figureIndex.refreshAria')}
          data-action="figure-index-refresh"
          className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('block.figureIndex.refresh')}
        </button>
      </div>
      {grouped.map((g) =>
        g.entries.length === 0 ? null : (
          <div key={g.kind} className="mb-2 last:mb-0">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
              {g.label}
            </div>
            <ol className="ml-3 list-decimal text-gray-700 dark:text-gray-300">
              {g.entries.map((e, idx) => {
                const zebra = getZebraClass('figure-index', block.options, idx)
                return (
                  <li key={`${e.kind}-${e.n}`} className={zebra}>
                    {g.label} {e.n}: {e.caption || <span className="text-gray-400">(캡션 없음)</span>}
                  </li>
                )
              })}
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
