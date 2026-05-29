/**
 * Widget export helpers — pure functions only, zero external deps.
 *
 * 사용 맥락: WIDGET-08 (Cycle 3). chart/gantt/org/flow/table/kpi 위젯에
 * hover toolbar 의 export 버튼이 호출. 각 위젯은 `data-export-root` 가
 * 붙은 DOM 노드를 가지고 있고, 메뉴는 그 안의 첫 `<svg>` 를 찾아
 * PNG/SVG 로 변환한다. CSV 빌더는 위젯별 형식이 다르므로 helper 만
 * 모아둔다 — table/kpi/gantt 행렬을 RFC 4180 으로 직렬화.
 *
 * 외부 라이브러리 0:
 *   - SVG → PNG: <img src='data:image/svg+xml;base64,…'> + Canvas.drawImage
 *   - SVG → string: outerHTML (xmlns 강제 부착)
 *   - download: Blob + a[download] 클릭 후 revoke
 */

export interface SvgToPngOptions {
  /** Pixel scale factor (1 = native size, 2 = retina). Default 2. */
  scale?: number
  /** Background fill. `null` = transparent (default). */
  background?: string | null
}

/**
 * Convert an SVG element to a PNG data URL via Canvas. Resolves to `null`
 * if the browser fails to rasterise (e.g. tainted canvas from external
 * images — we don't accept any in our widgets but be defensive).
 *
 * Note: callers must await this in a real browser; jsdom doesn't paint
 * SVG so tests should mock or skip the actual rasterisation step.
 */
export async function svgElementToPng(
  svgEl: SVGSVGElement,
  options: SvgToPngOptions = {},
): Promise<string | null> {
  const scale = Math.max(1, Math.min(4, options.scale ?? 2))
  const background = options.background ?? null

  const svgString = svgElementToString(svgEl)
  const { width, height } = measureSvg(svgEl)
  if (width <= 0 || height <= 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const dataUrl = `data:image/svg+xml;base64,${btoaUnicode(svgString)}`
  return new Promise<string | null>((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

/**
 * Serialize an SVG element to a self-contained string suitable for `.svg`
 * download. Adds the SVG/xlink namespaces if the live element omitted them
 * (browsers tolerate missing xmlns in the DOM but standalone files need it).
 */
export function svgElementToString(svgEl: SVGSVGElement): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }
  return clone.outerHTML
}

/**
 * Trigger a browser download for arbitrary Blob content. Object URL is
 * revoked on the next microtask to avoid leaking large buffers.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer the revoke so Safari has a chance to start the download.
  queueMicrotask(() => URL.revokeObjectURL(url))
}

/**
 * Coerce an arbitrary value to a CSV cell string per RFC 4180 — quote when
 * the value contains comma / quote / CR / LF, escape inner quotes by
 * doubling.
 */
export function csvCell(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  if (s === '') return ''
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Same as `csvCell` but for TSV — tabs/newlines collapsed to space. */
export function tsvCell(value: unknown): string {
  if (value == null) return ''
  return String(value).replace(/[\t\r\n]/g, ' ')
}

/**
 * Build a CSV string from a header row + body rows. Pure — no IO.
 * Empty cells are emitted as the empty token (consecutive commas).
 */
export function rowsToCsv(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines: string[] = []
  lines.push(headers.map(csvCell).join(','))
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','))
  }
  return lines.join('\r\n')
}

/** KPI cards → CSV. Columns: label, value, delta, trend (drop trend if all empty). */
export function kpiCardsToCsv(
  items: ReadonlyArray<{
    label: string
    value: string | number
    delta?: string | number
    trend?: 'up' | 'down' | 'flat'
  }>,
): string {
  const hasTrend = items.some((it) => it.trend != null)
  const headers = hasTrend ? ['label', 'value', 'delta', 'trend'] : ['label', 'value', 'delta']
  const rows = items.map((it) =>
    hasTrend
      ? [it.label, it.value, it.delta ?? '', it.trend ?? '']
      : [it.label, it.value, it.delta ?? ''],
  )
  return rowsToCsv(headers, rows)
}

/** Gantt tasks → CSV. Columns: name, start, end, progress. */
export function ganttTasksToCsv(
  tasks: ReadonlyArray<{
    name: string
    start: string
    end: string
    progress?: number
  }>,
): string {
  return rowsToCsv(
    ['name', 'start', 'end', 'progress'],
    tasks.map((t) => [t.name, t.start, t.end, t.progress ?? '']),
  )
}

/** Flat table (headers + rows) → CSV. Headers are required; sparse cells unsupported. */
export function flatTableToCsv(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rowsToCsv(headers, rows)
}

/**
 * Chart (label-aligned series) → CSV. Columns: `<x_axis>`, then one column
 * per series. Each row = one label; cells are series.values[i] (empty when
 * the series doesn't reach that label).
 *
 * For xy-line charts (where series carry their own `points`) callers should
 * use `buildCsvExport` from ChartBlockEditor.tsx instead — that one does
 * union-x merging.
 */
export function chartLabeledToCsv(
  xAxisLabel: string | undefined,
  labels: ReadonlyArray<string | number>,
  series: ReadonlyArray<{ name: string; values?: ReadonlyArray<number> }>,
): string {
  const headers = [xAxisLabel || 'x', ...series.map((s) => s.name)]
  const rows = labels.map((label, i) => [
    label,
    ...series.map((s) => s.values?.[i] ?? ''),
  ])
  return rowsToCsv(headers, rows)
}

/**
 * Measure an SVG's intrinsic size. Prefers width/height attributes; falls
 * back to viewBox; finally getBoundingClientRect (live DOM only).
 */
function measureSvg(svgEl: SVGSVGElement): { width: number; height: number } {
  const wAttr = svgEl.getAttribute('width')
  const hAttr = svgEl.getAttribute('height')
  const w = parseNumeric(wAttr)
  const h = parseNumeric(hAttr)
  if (w && h) return { width: w, height: h }
  const vb = svgEl.getAttribute('viewBox')
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number)
    const vw = parts[2]
    const vh = parts[3]
    if (parts.length === 4 && Number.isFinite(vw) && Number.isFinite(vh)) {
      return { width: vw as number, height: vh as number }
    }
  }
  try {
    const rect = svgEl.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  } catch {
    return { width: 0, height: 0 }
  }
}

function parseNumeric(raw: string | null): number {
  if (!raw) return 0
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

/**
 * `btoa` only handles latin-1; SVG text may contain Korean. Encode to UTF-8
 * bytes first, then base64.
 */
function btoaUnicode(s: string): string {
  // TextEncoder is universal in browsers + jsdom.
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number)
  // btoa is global in the browser; in node test env we polyfill via globalThis.
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64')
}
