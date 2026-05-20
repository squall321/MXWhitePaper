interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  ariaLabel: string
}

export function Sparkline({ data, width = 80, height = 20, ariaLabel }: SparklineProps) {
  if (!data?.length) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = Math.max(max - min, 1)
  const dx = width / Math.max(data.length - 1, 1)
  const y = (v: number) => height - ((v - min) / range) * height
  const path = data
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * dx).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
