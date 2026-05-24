/**
 * ChartBlockEditor P2 단위 테스트 — toolbar 확장 (축 범위, fit 범위, stats,
 * PNG/CSV export, 시리즈 정리 panel).
 *
 * 프로젝트 테스트 인프라가 jsdom 을 의도적으로 회피하기 때문에 (paste 테스트
 * 파일의 주석 참고), 여기서도 (1) 순수 헬퍼 (`buildCsvExport`,
 * `computeSeriesStats`) 와 (2) ChartBlockEditor 를 함수로 호출해 JSX 트리에서
 * data-* 마커로 버튼을 찾아 핸들러를 직접 호출하는 방식을 쓴다.
 */
import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import {
  ChartBlockEditor,
  buildCsvExport,
  computeSeriesStats,
} from '../ChartBlockEditor'
import type { ChartBlock } from '@/types/document'

// React hooks 무력화 — render 컨텍스트 밖에서 함수 그대로 호출하기 위해.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useState: <T,>(initial: T | (() => T)) => {
      const init =
        typeof initial === 'function' ? (initial as () => T)() : initial
      return [init, vi.fn()] as [T, (v: T) => void]
    },
    useEffect: () => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
  }
})

vi.mock('@/features/editor/state', () => ({
  useEditorStore: <T,>(selector: (state: { draft: null }) => T): T =>
    selector({ draft: null }),
}))

vi.mock('@/lib/i18n', () => ({
  useT:
    () =>
    (key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
}))

// EChartsView 는 echarts 의존성을 끌고 들어와 무겁고, P2 테스트는 ref 호출이
// 필요 없으므로 placeholder 컴포넌트로 대체.
vi.mock('@/components/blocks/EChartsView', () => ({
  EChartsView: () => null,
}))

function makeBlock(overrides: Partial<ChartBlock> = {}): ChartBlock {
  return {
    type: 'chart',
    id: '01TESTBLOCK00000000000CHRT',
    chartType: 'xy-line',
    data: { labels: [], series: [] },
    ...overrides,
  } as ChartBlock
}

/* ── 순수 헬퍼 ───────────────────────────────────────────────────────────── */

describe('buildCsvExport', () => {
  it('단일 시리즈 — header + 한 컬럼', () => {
    const csv = buildCsvExport([
      { name: 'A', points: [{ x: 0, y: 10 }, { x: 1, y: 20 }] },
    ])
    expect(csv).toBe('x,A\n0,10\n1,20')
  })

  it('서로 다른 x 의 시리즈 union — 빈 칸으로 채움', () => {
    const csv = buildCsvExport([
      { name: 'A', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
      { name: 'B', points: [{ x: 1, y: 5 }, { x: 2, y: 6 }] },
    ])
    // x = 0, 1, 2. A 는 x=2 없음, B 는 x=0 없음.
    expect(csv).toBe('x,A,B\n0,1,\n1,2,5\n2,,6')
  })

  it('시리즈 이름에 콤마 있으면 quote 처리 (RFC 4180)', () => {
    const csv = buildCsvExport([
      { name: 'A, with comma', points: [{ x: 0, y: 1 }] },
    ])
    expect(csv.split('\n')[0]).toBe('x,"A, with comma"')
  })

  it('이름에 " 있으면 "" 로 escape', () => {
    const csv = buildCsvExport([
      { name: 'A "quoted"', points: [{ x: 0, y: 1 }] },
    ])
    expect(csv.split('\n')[0]).toBe('x,"A ""quoted"""')
  })

  it('빈 시리즈 배열 — header 만 (data 행 없음)', () => {
    const csv = buildCsvExport([])
    expect(csv).toBe('x')
  })

  it('NaN/Infinity 가 섞인 점은 skip', () => {
    const csv = buildCsvExport([
      {
        name: 'A',
        points: [
          { x: 0, y: 1 },
          { x: NaN, y: 2 },
          { x: 1, y: Infinity },
          { x: 2, y: 3 },
        ],
      },
    ])
    // y=Infinity 인 (1, Inf) 는 lookup 에 안 들어가서 빈 칸이 됨.
    // 하지만 x=1 은 valid 한 (x finite, y Infinity 라 x 만 union 에 추가될까?)
    // — buildCsvExport 는 union x 단계에서 x 만 finite 면 추가, lookup 에는
    // 양쪽 finite 만. 그래서 x=1 도 union 에 포함되지만 lookup 에 없어 빈 칸.
    expect(csv).toBe('x,A\n0,1\n1,\n2,3')
  })
})

describe('computeSeriesStats', () => {
  it('빈 series 는 n=0 + NaN 통계', () => {
    const stats = computeSeriesStats([{ name: 'A', points: [] }])
    expect(stats).toHaveLength(1)
    expect(stats[0]!.n).toBe(0)
    expect(stats[0]!.slope).toBeNull()
    expect(Number.isNaN(stats[0]!.yMean)).toBe(true)
  })

  it('y = 2x 위의 4 점이면 slope≈2, yMean=평균', () => {
    const stats = computeSeriesStats([
      {
        name: 'A',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 2 },
          { x: 2, y: 4 },
          { x: 3, y: 6 },
        ],
      },
    ])
    expect(stats[0]!.n).toBe(4)
    expect(stats[0]!.xMin).toBe(0)
    expect(stats[0]!.xMax).toBe(3)
    expect(stats[0]!.yMean).toBeCloseTo(3, 10)
    expect(stats[0]!.slope!).toBeCloseTo(2, 10)
  })

  it('n=1 이면 std=0, slope=null', () => {
    const stats = computeSeriesStats([
      { name: 'A', points: [{ x: 5, y: 7 }] },
    ])
    expect(stats[0]!.n).toBe(1)
    expect(stats[0]!.yStd).toBe(0)
    expect(stats[0]!.slope).toBeNull()
  })

  it('NaN 점은 제외', () => {
    const stats = computeSeriesStats([
      {
        name: 'A',
        points: [
          { x: 0, y: 1 },
          { x: NaN, y: 2 },
          { x: 1, y: 3 },
        ],
      },
    ])
    expect(stats[0]!.n).toBe(2)
  })
})

/* ── ChartBlockEditor JSX 트리 walker — paste 테스트와 동일 패턴 ──────────── */

function* walk(node: unknown): Generator<React.ReactElement> {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n)
    return
  }
  if (typeof node !== 'object') return
  const el = node as React.ReactElement
  if (!el.props) return
  if (typeof el.type === 'function') return
  yield el
  const kids = (el.props as { children?: unknown }).children
  if (kids !== undefined) yield* walk(kids)
}

function renderTree(
  block: ChartBlock,
  onChange: (b: ChartBlock) => void,
): React.ReactElement[] {
  const tree = (
    ChartBlockEditor as unknown as (p: {
      block: ChartBlock
      onChange: (b: ChartBlock) => void
    }) => React.ReactElement
  )({ block, onChange })
  return Array.from(walk(tree))
}

const findByMarker =
  (key: string, value: string) =>
  (el: React.ReactElement): boolean =>
    (el.props as Record<string, unknown>)[key] === value

function fakeInputChange(value: string): React.ChangeEvent<HTMLInputElement> {
  return {
    target: { value } as HTMLInputElement,
  } as unknown as React.ChangeEvent<HTMLInputElement>
}

/* ── Axis 범위 input ──────────────────────────────────────────────────── */

describe('<ChartBlockEditor /> axis range', () => {
  it('xMin input 변경 시 display.xMin 이 갱신된다', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const input = els.find(findByMarker('data-axis-range', 'xMin'))
    expect(input).toBeDefined()
    const handler = (input!.props as {
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    }).onChange
    handler(fakeInputChange('1.5'))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.xMin).toBe(1.5)
  })

  it('빈 칸 입력 시 해당 키가 display 에서 제거된다 (auto)', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      display: { xMax: 10 },
    })
    const els = renderTree(block, onChange)
    const input = els.find(findByMarker('data-axis-range', 'xMax'))!
    ;(input.props as {
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    }).onChange(fakeInputChange(''))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.xMax).toBeUndefined()
  })

  it('숫자가 아닌 입력은 무시 (onChange 가 호출되지 않음)', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const input = els.find(findByMarker('data-axis-range', 'yMin'))!
    ;(input.props as {
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    }).onChange(fakeInputChange('abc'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

/* ── Fit range ──────────────────────────────────────────────────────────── */

describe('<ChartBlockEditor /> fit range', () => {
  it('showFit 가 꺼져 있으면 fit-range 섹션이 안 보인다', () => {
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, () => {})
    const section = els.find(findByMarker('data-section', 'fit-range'))
    expect(section).toBeUndefined()
  })

  it('showFit 가 켜져 있으면 두 input 이 노출된다', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      display: { showFit: true },
    })
    const els = renderTree(block, () => {})
    const xMin = els.find(findByMarker('data-fit-range', 'xMin'))
    const xMax = els.find(findByMarker('data-fit-range', 'xMax'))
    expect(xMin).toBeDefined()
    expect(xMax).toBeDefined()
  })

  it('xMin 입력 시 display.fitRange.xMin 갱신', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      display: { showFit: true, fitRange: { xMin: 0, xMax: 10 } },
    })
    const els = renderTree(block, onChange)
    const xMinInput = els.find(findByMarker('data-fit-range', 'xMin'))!
    ;(xMinInput.props as {
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    }).onChange(fakeInputChange('2'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.fitRange?.xMin).toBe(2)
    expect(next.display?.fitRange?.xMax).toBe(10)
  })

  it('한쪽 칸 비우면 fitRange 자체가 제거 (전체 회귀)', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      display: { showFit: true, fitRange: { xMin: 0, xMax: 10 } },
    })
    const els = renderTree(block, onChange)
    const xMaxInput = els.find(findByMarker('data-fit-range', 'xMax'))!
    ;(xMaxInput.props as {
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    }).onChange(fakeInputChange(''))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.fitRange).toBeUndefined()
  })

  it('xMin >= xMax 인 invalid 입력이면 경고 role=alert 가 표시된다', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      display: { showFit: true, fitRange: { xMin: 10, xMax: 5 } },
    })
    const els = renderTree(block, () => {})
    const alert = els.find((e) => (e.props as { role?: string }).role === 'alert')
    expect(alert).toBeDefined()
  })
})

/* ── Stats toggle + panel ───────────────────────────────────────────────── */

describe('<ChartBlockEditor /> stats panel', () => {
  it('Stats 토글 버튼 클릭 시 display.showStats 가 true 로 바뀐다', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const btn = els.find(findByMarker('data-toolbar', 'stats'))!
    ;(btn.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.showStats).toBe(true)
  })

  it('showStats 가 켜지면 통계 panel 이 렌더된다', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      display: { showStats: true },
      data: {
        labels: [],
        series: [
          { name: 'A', points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
        ],
      },
    })
    const els = renderTree(block, () => {})
    const panel = els.find(findByMarker('data-section', 'stats-panel'))
    expect(panel).toBeDefined()
  })

  it('showStats 가 꺼져 있으면 panel 이 렌더되지 않는다', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [{ name: 'A', points: [{ x: 0, y: 1 }] }],
      },
    })
    const els = renderTree(block, () => {})
    const panel = els.find(findByMarker('data-section', 'stats-panel'))
    expect(panel).toBeUndefined()
  })
})

/* ── PNG / CSV export 버튼 ──────────────────────────────────────────────── */

describe('<ChartBlockEditor /> export buttons', () => {
  it('시리즈가 없으면 PNG/CSV 버튼이 disabled', () => {
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, () => {})
    const png = els.find(findByMarker('data-toolbar', 'export-png'))!
    const csv = els.find(findByMarker('data-toolbar', 'export-csv'))!
    expect((png.props as { disabled?: boolean }).disabled).toBe(true)
    expect((csv.props as { disabled?: boolean }).disabled).toBe(true)
  })

  it('시리즈가 있으면 enabled', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [{ name: 'A', points: [{ x: 0, y: 1 }] }],
      },
    })
    const els = renderTree(block, () => {})
    const png = els.find(findByMarker('data-toolbar', 'export-png'))!
    const csv = els.find(findByMarker('data-toolbar', 'export-csv'))!
    expect((png.props as { disabled?: boolean }).disabled).toBe(false)
    expect((csv.props as { disabled?: boolean }).disabled).toBe(false)
  })
})

/* ── 시리즈 정리 panel (E4) ─────────────────────────────────────────────── */

describe('<ChartBlockEditor /> series panel', () => {
  it('reorder ↓ 클릭 시 두 시리즈가 swap 된다', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          { name: 'A', points: [{ x: 0, y: 0 }] },
          { name: 'B', points: [{ x: 0, y: 0 }] },
        ],
      },
    })
    const els = renderTree(block, onChange)
    // 첫 row 의 down 버튼을 찾는다 (data-series-index=0, action=down).
    const btn = els.find((e) => {
      const p = e.props as Record<string, unknown>
      return (
        p['data-series-action'] === 'down' && p['data-series-index'] === 0
      )
    })!
    ;(btn.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.series[0]?.name).toBe('B')
    expect(next.data.series[1]?.name).toBe('A')
  })

  it('첫 row 의 ↑ 버튼은 disabled', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          { name: 'A', points: [] },
          { name: 'B', points: [] },
        ],
      },
    })
    const els = renderTree(block, () => {})
    const btn = els.find((e) => {
      const p = e.props as Record<string, unknown>
      return p['data-series-action'] === 'up' && p['data-series-index'] === 0
    })!
    expect((btn.props as { disabled?: boolean }).disabled).toBe(true)
  })

  it('remove × 클릭 시 해당 시리즈가 제거된다', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          { name: 'A', points: [] },
          { name: 'B', points: [] },
          { name: 'C', points: [] },
        ],
      },
    })
    const els = renderTree(block, onChange)
    const btn = els.find((e) => {
      const p = e.props as Record<string, unknown>
      return (
        p['data-series-action'] === 'remove' && p['data-series-index'] === 1
      )
    })!
    ;(btn.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.series).toHaveLength(2)
    expect(next.data.series.map((s) => s.name)).toEqual(['A', 'C'])
  })
})
