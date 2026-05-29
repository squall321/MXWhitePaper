import { useCallback, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import {
  downloadBlob,
  svgElementToPng,
  svgElementToString,
} from '@/lib/widgetExport'

export type WidgetExportFormat = 'png' | 'svg' | 'csv' | 'tsv'

/**
 * `WidgetExportMenu` — generic hover toolbar for read-mode widgets that
 * exposes a small dropdown of export targets (PNG/SVG/CSV/TSV). The host
 * widget controls which formats are available and supplies a CSV/TSV
 * payload up front; PNG/SVG are derived from the first `<svg>` inside the
 * `data-export-root` ancestor at click time.
 *
 * Visibility: relies on the host wrapping the widget in a `.group` so the
 * menu is hidden until hover/focus, matching the pattern used by
 * `BlockToolbar`.
 */
export interface WidgetExportMenuProps {
  /** Formats this widget supports, in display order. */
  formats: ReadonlyArray<WidgetExportFormat>
  /** Lazily produce CSV text (called only when the user clicks CSV). */
  getCsv?: () => string
  /** Lazily produce TSV text. */
  getTsv?: () => string
  /** Default download filename (no extension). Sanitised by host. */
  filename: string
  /**
   * Optional SVG accessor — defaults to `querySelector('svg')` on the
   * nearest `[data-export-root]` ancestor. Override when the widget hides
   * the real svg behind a portal or shadow root.
   */
  getSvg?: (anchor: HTMLElement) => SVGSVGElement | null
}

export function WidgetExportMenu({
  formats,
  getCsv,
  getTsv,
  filename,
  getSvg,
}: WidgetExportMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<WidgetExportFormat | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  const resolveSvg = useCallback((): SVGSVGElement | null => {
    const anchor = anchorRef.current
    if (!anchor) return null
    const root =
      (anchor.closest('[data-export-root]') as HTMLElement | null) ?? anchor.parentElement
    if (!root) return null
    if (getSvg) return getSvg(root)
    return root.querySelector('svg') as SVGSVGElement | null
  }, [getSvg])

  const run = useCallback(
    async (fmt: WidgetExportFormat) => {
      setBusy(fmt)
      try {
        const safeName = filename.replace(/[^\w.-]+/g, '_') || 'widget'
        if (fmt === 'csv' && getCsv) {
          const text = getCsv()
          downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${safeName}.csv`)
        } else if (fmt === 'tsv' && getTsv) {
          const text = getTsv()
          downloadBlob(
            new Blob([text], { type: 'text/tab-separated-values;charset=utf-8' }),
            `${safeName}.tsv`,
          )
        } else if (fmt === 'svg') {
          const svg = resolveSvg()
          if (!svg) return
          const text = svgElementToString(svg)
          downloadBlob(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), `${safeName}.svg`)
        } else if (fmt === 'png') {
          const svg = resolveSvg()
          if (!svg) return
          const dataUrl = await svgElementToPng(svg, { scale: 2 })
          if (!dataUrl) return
          const res = await fetch(dataUrl)
          const blob = await res.blob()
          downloadBlob(blob, `${safeName}.png`)
        }
      } finally {
        setBusy(null)
        setOpen(false)
      }
    },
    [filename, getCsv, getTsv, resolveSvg],
  )

  if (formats.length === 0) return null
  const label = t('editor.export.menu')

  return (
    <div ref={anchorRef} className="absolute right-1 top-1 z-popover hidden group-hover:block group-focus-within:block">
      <div className="relative">
        <button
          type="button"
          data-widget-export-toggle
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-gray-200 bg-white/95 px-2 py-0.5 text-[11px] text-gray-700 shadow-sm hover:bg-smsg-50 dark:border-gray-600 dark:bg-gray-800/95 dark:text-gray-200"
        >
          ⬇ {label}
        </button>
        {open && (
          <div
            role="menu"
            aria-label={label}
            className="absolute right-0 mt-1 flex min-w-[7rem] flex-col rounded border border-gray-200 bg-white text-xs shadow-md dark:border-gray-600 dark:bg-gray-800"
          >
            {formats.map((fmt) => (
              <button
                key={fmt}
                type="button"
                role="menuitem"
                disabled={busy === fmt}
                data-widget-export-format={fmt}
                onClick={() => void run(fmt)}
                className="px-2 py-1 text-left hover:bg-smsg-50 disabled:opacity-50 dark:hover:bg-gray-700"
              >
                {t(`editor.export.${fmt}`)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
