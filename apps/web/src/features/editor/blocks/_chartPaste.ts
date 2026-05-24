/**
 * TSV/CSV → chart series 변환 (순수 모듈).
 *
 * 사용자가 엑셀에서 N×K 데이터를 복사해서 chart 블록에 paste 했을 때
 * 자동으로 시리즈를 생성하기 위한 헬퍼. 헤더에서 시리즈명/축 라벨/제목 추출.
 *
 * raw CSV/TSV 파싱은 `extensions/csv-paste.ts` 의 parseCsv 를 재사용한다.
 */

import { parseCsv } from '../extensions/csv-paste'

// `_fits.ts` 가 아직 없을 수 있어 임시 type alias 를 정의 (export 하지 않는다).
// _fits.ts 가 완성되면 `import type { XYPoint } from './_fits'` 로 바꾼다.
interface XYPoint {
  x: number
  y: number
}

export interface ChartPasteSeries {
  name: string
  points: XYPoint[]
  /** 헤더에 있던 단위 등 추가 정보. 이번 버전에서는 채우지 않는다. */
  caption?: string
}

export interface ChartPasteResult {
  /** 차트 제목 — paste 의 첫 행이 단일 셀이면 그것. */
  title?: string
  /** x 축 라벨 (단위 포함). 헤더의 첫 컬럼명. */
  xAxisLabel?: string
  /** y 축 라벨. 단일 시리즈면 y 컬럼명, 여러면 비움 (각 시리즈 name 으로 구분). */
  yAxisLabel?: string
  /**
   * x 축 데이터 유형 — 첫 컬럼이 ISO date/datetime/슬래시 패턴이면 'time'.
   * 미지정 = 'value' (기존 동작 유지). points[].x 는 'time' 인 경우 unix ms.
   */
  xAxisType?: 'value' | 'time'
  series: ChartPasteSeries[]
  /**
   * 시리즈별 5σ 이상 outlier 가 1% 초과인 경우만 채워짐 (P4 §2.11).
   * 사용자에게 toast/hint 로 데이터 확인을 권고한다. n<10 시리즈는 검사 skip.
   */
  outliers?: ChartPasteOutlier[]
}

export interface ChartPasteOutlier {
  seriesName: string
  count: number
  total: number
}

/**
 * 헤더 텍스트에서 단위 추출. "Stress [MPa]" → {name:"Stress", unit:"MPa"}.
 * 대괄호 [], 소괄호 (), 중괄호 {} 모두 인식. 단위 없으면 unit 빈 문자열.
 */
export function extractUnit(header: string): { name: string; unit: string } {
  const trimmed = (header ?? '').trim()
  // 마지막에 등장하는 [..] / (..) / {..} 를 단위로 본다.
  const match = trimmed.match(/^(.*?)\s*[\[\(\{]([^\[\]\(\)\{\}]+)[\]\)\}]\s*$/)
  if (!match) return { name: trimmed, unit: '' }
  const name = (match[1] ?? '').trim()
  const unit = (match[2] ?? '').trim()
  // 단위만 있고 name 이 비었으면 그대로 단위만 반환 (name 빈 문자열).
  return { name, unit }
}

/**
 * TSV/CSV 텍스트를 chart series 배열로 변환. parsing 실패 또는 데이터 부족이면 null.
 */
export function parseChartPaste(text: string): ChartPasteResult | null {
  // 1) 타이틀 행 선처리.
  //    paste 의 첫 줄이 delimiter 없는 단일 셀이면 looksLikeCsv 가 false 가 되어
  //    parseCsv 자체가 실패한다. 따라서 첫 줄을 떼서 title 후보로 두고,
  //    나머지로 parseCsv 를 한 번 더 시도한다.
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const nonEmpty = lines.filter((l) => l.length > 0)
  if (nonEmpty.length < 2) return null

  let titleCandidate: string | undefined
  let bodyText = normalized
  const firstNonEmpty = nonEmpty[0]!
  if (!firstNonEmpty.includes('\t') && !firstNonEmpty.includes(',')) {
    // 첫 비어있지 않은 줄을 title 로 떼고, 그 줄까지 제거한 나머지로 재해석.
    titleCandidate = firstNonEmpty.trim()
    const idx = normalized.indexOf(firstNonEmpty)
    bodyText = normalized.slice(idx + firstNonEmpty.length).replace(/^\n+/, '')
  }

  const raw = parseCsv(bodyText)
  if (!raw) return null
  const rawRows: string[][] = [raw.headers, ...raw.rows]
  if (rawRows.length < 2) return null

  const result: ChartPasteResult = { series: [] }
  if (titleCandidate) result.title = titleCandidate

  // 2) (선처리 안 한 경우 대비) 첫 행이 단일 셀이면 title 로 빼낸다.
  let cursor = 0
  const first = rawRows[0]!
  if (!titleCandidate && isSingleCellRow(first)) {
    result.title = (first[0] ?? '').trim()
    cursor = 1
  }
  const remaining = rawRows.slice(cursor)
  if (remaining.length < 1) return null

  // 3) 헤더 행 추론 — 남은 첫 행의 셀이 모두 숫자 또는 timestamp 패턴이면 헤더 없음.
  //    (P3) ISO date `2024-01-01` 는 Number() 로 NaN 이라 헤더로 오인되는 회귀 방지.
  const firstRemaining = remaining[0]!
  const hasHeader = !firstRemaining.every(
    (c) => isNumericCell(c) || isTimestampCell(c),
  )

  let headerCells: string[] | null = null
  let dataRows: string[][]
  if (hasHeader) {
    headerCells = firstRemaining.map((c) => (c ?? '').trim())
    dataRows = remaining.slice(1)
  } else {
    dataRows = remaining
  }
  if (dataRows.length < 1) return null

  // 4) 컬럼 분배. 첫 데이터 행의 컬럼 수로 결정 (헤더가 있으면 헤더 길이 기준).
  const colCount = headerCells ? headerCells.length : (dataRows[0]?.length ?? 0)
  if (colCount < 2) return null

  // 헤더에서 name / unit 분리.
  const parsedHeaders = headerCells
    ? headerCells.map((h) => extractUnit(h))
    : null

  // 첫 컬럼이 timestamp 인지 추론. 'time' 이면 dataRows 의 0번 셀을 unix ms 로 미리 치환.
  // 헤더가 time/date 키워드면 unix-like 큰 정수도 허용; 그 외엔 ISO/슬래시 패턴만.
  const xHeaderHint = headerCells ? headerCells[0] : undefined
  const isTime = detectTimestampColumn(dataRows, 0, xHeaderHint)
  if (isTime) {
    result.xAxisType = 'time'
    for (const r of dataRows) {
      const raw = (r[0] ?? '').trim()
      if (raw === '') continue
      // 큰 정수 (unix ms / s) 는 그대로 number 로 통과시킴.
      const asNum = /^\d{10,13}$/.test(raw) ? Number(raw) : Date.parse(raw)
      // NaN 이면 toPoints 의 isFinite 검사가 알아서 그 행을 skip.
      r[0] = Number.isFinite(asNum) ? String(asNum) : ''
    }
  }

  if (colCount === 2) {
    // 2 컬럼: 단일 시리즈.
    const points = toPoints(dataRows, 0, 1)
    if (points.length < 1) return null
    const yLabelRaw = headerCells ? headerCells[1] : undefined
    const yName = parsedHeaders ? parsedHeaders[1]!.name || 'Series 1' : 'Series 1'
    result.series = [{ name: yName, points }]
    if (headerCells) {
      result.xAxisLabel = headerCells[0]
      result.yAxisLabel = yLabelRaw
    }
  } else {
    // ≥3 컬럼: 첫 컬럼 공통 x, 나머지가 각 시리즈 y.
    const series: ChartPasteSeries[] = []
    for (let i = 1; i < colCount; i++) {
      const points = toPoints(dataRows, 0, i)
      if (points.length < 1) continue
      const name = parsedHeaders
        ? parsedHeaders[i]!.name || `Series ${i}`
        : `Series ${i}`
      series.push({ name, points })
    }
    if (series.length < 1) return null
    result.series = series
    if (headerCells) {
      result.xAxisLabel = headerCells[0]
      // 시리즈 여러 개면 y 축 라벨은 비운다 (시리즈 name 으로 구분).
      result.yAxisLabel = undefined
    }
  }

  // P4 §2.11 — 5σ outlier 검사. n<10 시리즈는 통계적 의미가 약해 skip.
  // |y - mean| > 5σ 인 점이 1% 초과면 outliers 에 등록.
  const outliers: ChartPasteOutlier[] = []
  for (const s of result.series) {
    const ys = s.points.map((p) => p.y).filter((y) => Number.isFinite(y))
    const total = ys.length
    if (total < 10) continue
    let sum = 0
    for (const y of ys) sum += y
    const mean = sum / total
    let sq = 0
    for (const y of ys) sq += (y - mean) ** 2
    const std = Math.sqrt(sq / total)
    if (std === 0) continue
    let count = 0
    const threshold = 5 * std
    for (const y of ys) {
      if (Math.abs(y - mean) > threshold) count++
    }
    if (count / total > 0.01) {
      outliers.push({ seriesName: s.name, count, total })
    }
  }
  if (outliers.length > 0) result.outliers = outliers

  return result
}

/* ── Internal helpers ──────────────────────────────────────────────────── */

function isSingleCellRow(row: string[]): boolean {
  if (row.length === 0) return false
  if ((row[0] ?? '').trim() === '') return false
  for (let i = 1; i < row.length; i++) {
    if ((row[i] ?? '').trim() !== '') return false
  }
  return true
}

function isNumericCell(cell: string): boolean {
  const t = (cell ?? '').trim()
  if (t === '') return false
  const n = Number(t)
  return Number.isFinite(n)
}

/** ISO date/datetime/슬래시 패턴 매칭. unix-like 큰 정수는 별도 처리 (헤더 hint 필요). */
const TIMESTAMP_PATTERNS: RegExp[] = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
  /^\d{4}\/\d{2}\/\d{2}$/,
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,
]

function isTimestampCell(cell: string): boolean {
  const t = (cell ?? '').trim()
  if (t === '') return false
  return TIMESTAMP_PATTERNS.some((re) => re.test(t))
}

const TIME_HEADER_KEYWORDS = ['time', 'date', 'timestamp', '날짜', '시간']

function looksLikeTimeHeader(header: string | undefined): boolean {
  if (!header) return false
  const lower = header.toLowerCase()
  return TIME_HEADER_KEYWORDS.some((k) => lower.includes(k))
}

/**
 * 모든 dataRow 의 첫 컬럼 (비어있지 않은 셀) 이 timestamp 패턴이면 true.
 * unix-like 10~13 자리 정수는 헤더에 time/date/... 키워드가 있을 때만 timestamp 로 본다.
 */
function detectTimestampColumn(
  rows: string[][],
  col: number,
  headerHint: string | undefined,
): boolean {
  let seen = 0
  const headerHinted = looksLikeTimeHeader(headerHint)
  for (const r of rows) {
    const raw = (r[col] ?? '').trim()
    if (raw === '') continue
    seen++
    const isIsoLike = TIMESTAMP_PATTERNS.some((re) => re.test(raw))
    if (isIsoLike) continue
    if (headerHinted && /^\d{10,13}$/.test(raw)) continue
    return false
  }
  return seen > 0
}

function toPoints(rows: string[][], xCol: number, yCol: number): XYPoint[] {
  const out: XYPoint[] = []
  for (const r of rows) {
    const x = Number((r[xCol] ?? '').trim())
    const y = Number((r[yCol] ?? '').trim())
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push({ x, y })
  }
  return out
}
