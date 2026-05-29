import type { KpiCardsBlock } from '@/types/document'
import { getZebraClass } from '@/features/editor/blocks/zebra'
import { Sparkline } from '@/features/home/components/Sparkline'

const TREND_GLYPH: Record<NonNullable<KpiCardsBlock['items'][number]['trend']>, string> = {
  up: '▲',
  down: '▼',
  flat: '→',
}

const TREND_COLOR: Record<NonNullable<KpiCardsBlock['items'][number]['trend']>, string> = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  flat: 'text-gray-500',
}

/**
 * KPI cards: small grid of label + value + delta. Trend glyph drives color.
 */
export function KpiCardsBlockView({ block }: { block: KpiCardsBlock }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {block.items.map((item, idx) => {
        const zebra = getZebraClass('kpi-cards', block.options, idx)
        const surface = zebra || 'bg-white dark:bg-gray-900'
        return (
          <li
            key={idx}
            className={`rounded border border-gray-200 ${surface} p-3 shadow-sm dark:border-gray-700`}
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
            <p className="mt-1 text-xl font-semibold text-smsg-900">{item.value}</p>
            {item.delta != null && (
              <p
                className={
                  'mt-1 text-xs ' +
                  (item.trend ? TREND_COLOR[item.trend] : 'text-gray-500')
                }
              >
                {item.trend ? TREND_GLYPH[item.trend] + ' ' : ''}
                {item.delta}
              </p>
            )}
            {item.sparkline && item.sparkline.values.length > 0 && (
              <div className={'mt-2 ' + (item.trend ? TREND_COLOR[item.trend] : 'text-smsg-600')}>
                <Sparkline
                  data={item.sparkline.values}
                  kind={item.sparkline.kind ?? 'line'}
                  width={120}
                  height={24}
                  ariaLabel={`${item.label} sparkline`}
                />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
