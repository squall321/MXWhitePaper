interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  ariaLabel: string
  /**
   * line=경향선 (path), bar=막대 (rect 양수 기준), win-loss=양/음 1-칸 막대 (0 기준).
   * Excel Insert→Sparkline 동등. default 'line'.
   */
  kind?: 'line' | 'bar' | 'win-loss'
  /**
   * Single color override. Applied as stroke (line) or fill (bar/win-loss).
   * Falls back to `currentColor` so parent text color drives the sparkline.
   */
  color?: string
  /**
   * bar-only — per-bar color cycle (`palette[i % palette.length]`). Wins over
   * `color` when present. Ignored for line/win-loss (single-color shapes).
   */
  palette?: string[]
}

export function Sparkline({
  data,
  width = 80,
  height = 20,
  ariaLabel,
  kind = 'line',
  color,
  palette,
}: SparklineProps) {
  if (!data?.length) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = Math.max(max - min, 1)
  const n = data.length
  const slot = width / Math.max(n, 1)
  const fill = color ?? 'currentColor'
  const hasPalette = Array.isArray(palette) && palette.length > 0

  let body: React.ReactNode
  if (kind === 'bar') {
    // 모든 막대를 min→max 기준으로 정규화, 컬럼 너비 = slot, gap 1px
    const barW = Math.max(slot - 1, 1)
    body = data.map((v, i) => {
      const h = ((v - min) / range) * height
      const barFill = hasPalette ? palette![i % palette!.length] : fill
      return (
        <rect
          key={i}
          x={(i * slot).toFixed(1)}
          y={(height - h).toFixed(1)}
          width={barW.toFixed(1)}
          height={Math.max(h, 0.5).toFixed(1)}
          fill={barFill}
        />
      )
    })
  } else if (kind === 'win-loss') {
    // 0 기준 — 양수 위쪽 절반, 음수 아래쪽 절반, 0 은 그리지 않음
    const half = height / 2
    const barW = Math.max(slot - 1, 1)
    body = data.map((v, i) => {
      if (v === 0) return null
      const up = v > 0
      return (
        <rect
          key={i}
          x={(i * slot).toFixed(1)}
          y={(up ? half - half * 0.8 : half).toFixed(1)}
          width={barW.toFixed(1)}
          height={(half * 0.8).toFixed(1)}
          fill={fill}
          opacity={up ? 0.9 : 0.55}
        />
      )
    })
  } else {
    // line — 기존 로직
    const dx = width / Math.max(n - 1, 1)
    const y = (v: number) => height - ((v - min) / range) * height
    const path = data
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * dx).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(' ')
    body = (
      <path
        d={path}
        fill="none"
        stroke={fill}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {body}
    </svg>
  )
}
