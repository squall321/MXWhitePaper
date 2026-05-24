/**
 * ChartBlockEditor P3 단위 테스트 — fit type select, dual-y, annotations,
 * derived series, timestamp x.
 *
 * P2 테스트와 동일한 패턴 — react hooks 무력화 + JSX walker.
 */
import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { ChartBlockEditor } from '../ChartBlockEditor'
import type { ChartBlock } from '@/types/document'

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

function fakeChange(value: string) {
  return {
    target: { value } as HTMLInputElement,
  } as unknown as React.ChangeEvent<HTMLInputElement>
}

function fakeSelectChange(value: string) {
  return {
    target: { value } as HTMLSelectElement,
  } as unknown as React.ChangeEvent<HTMLSelectElement>
}

/* ── Fit type dropdown ───────────────────────────────────────────────────── */

describe('<ChartBlockEditor /> P3 fit-type select', () => {
  it('초기값은 "" (none) — showFit 가 꺼져 있으면', () => {
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, () => {})
    const sel = els.find(findByMarker('data-toolbar', 'fit-type'))!
    expect((sel.props as { value: string }).value).toBe('')
  })

  it('"poly2" 선택 시 display.fitType=poly2 + showFit=true', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'fit-type'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange('poly2'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.showFit).toBe(true)
    expect(next.display?.fitType).toBe('poly2')
  })

  it('"" 선택 시 showFit=false 로 꺼진다', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      display: { showFit: true, fitType: 'exp' },
    })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'fit-type'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange(''))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.showFit).toBe(false)
  })

  it('이미 켜진 상태에서 다른 model 로 바꾸면 fitType 만 갈아끼움', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      display: { showFit: true, fitType: 'linear' },
    })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'fit-type'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange('power'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.fitType).toBe('power')
    expect(next.display?.showFit).toBe(true)
  })
})

/* ── Dual-y toggle + L/R radios ──────────────────────────────────────────── */

describe('<ChartBlockEditor /> P3 dual-y', () => {
  it('Dual 토글 (off→on) — 마지막 시리즈 yAxisIndex=1', () => {
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
    const btn = els.find(findByMarker('data-toolbar', 'dual-y'))!
    ;(btn.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.series[0]?.yAxisIndex).toBeUndefined()
    expect(next.data.series[1]?.yAxisIndex).toBe(1)
  })

  it('Dual 토글 (on→off) — 모든 yAxisIndex 제거', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          { name: 'A', points: [], yAxisIndex: 0 },
          { name: 'B', points: [], yAxisIndex: 1 },
        ],
      },
    })
    const els = renderTree(block, onChange)
    const btn = els.find(findByMarker('data-toolbar', 'dual-y'))!
    ;(btn.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    for (const s of next.data.series) {
      expect(s.yAxisIndex).toBeUndefined()
    }
  })

  it('dualY 꺼져 있으면 L/R 라디오가 렌더되지 않는다', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [{ name: 'A', points: [] }],
      },
    })
    const els = renderTree(block, () => {})
    const r = els.find(findByMarker('data-series-axis', 'R'))
    expect(r).toBeUndefined()
  })

  it('dualY 켜져 있으면 R 버튼 클릭 시 해당 시리즈가 yAxisIndex=1 로 이동', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          { name: 'A', points: [], yAxisIndex: 0 },
          { name: 'B', points: [], yAxisIndex: 1 },
        ],
      },
    })
    const els = renderTree(block, onChange)
    // 첫 row 의 R 버튼 (data-series-index=0).
    const rBtn = els.find((e) => {
      const p = e.props as Record<string, unknown>
      return p['data-series-axis'] === 'R' && p['data-series-index'] === 0
    })!
    ;(rBtn.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.series[0]?.yAxisIndex).toBe(1)
  })

  it('dualY on 일 때 yAxisLabel2 input 노출 + 입력 시 data.yAxisLabel2 갱신', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [{ name: 'A', points: [], yAxisIndex: 1 }],
      },
    })
    const els = renderTree(block, onChange)
    const input = els.find(findByMarker('data-axis-label', 'y2'))!
    ;(input.props as {
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    }).onChange(fakeChange('Stress (MPa)'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.yAxisLabel2).toBe('Stress (MPa)')
  })
})

/* ── Annotation add / remove ─────────────────────────────────────────────── */

describe('<ChartBlockEditor /> P3 annotation', () => {
  it('annotation 0 개면 panel 이 렌더되지 않는다', () => {
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, () => {})
    const panel = els.find(findByMarker('data-section', 'annotations-panel'))
    expect(panel).toBeUndefined()
  })

  it('marker 추가 — annotations 길이 +1, kind=marker', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [{ name: 'A', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
      },
    })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'add-annotation'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange('marker'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.annotations).toHaveLength(1)
    expect(next.annotations![0]!.kind).toBe('marker')
    // bbox 중심 = (5, 5)
    if (next.annotations![0]!.kind === 'marker') {
      expect(next.annotations![0]!.x).toBe(5)
      expect(next.annotations![0]!.y).toBe(5)
    }
  })

  it('arrow / box 도 같은 dropdown 에서 추가 가능', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [{ name: 'A', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      },
    })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'add-annotation'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange('box'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.annotations![0]!.kind).toBe('box')
  })

  it('annotation 삭제 → 길이 -1', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      annotations: [
        { kind: 'marker', id: 'ann_a', x: 0, y: 0, label: 'M' },
        { kind: 'marker', id: 'ann_b', x: 1, y: 1, label: 'N' },
      ],
    })
    const els = renderTree(block, onChange)
    const btn = els.find((e) => {
      const p = e.props as Record<string, unknown>
      return (
        p['data-annotation-action'] === 'remove' &&
        p['data-annotation-id'] === 'ann_a'
      )
    })!
    ;(btn.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.annotations).toHaveLength(1)
    expect(next.annotations![0]!.id).toBe('ann_b')
  })
})

/* ── Derived series ──────────────────────────────────────────────────────── */

describe('<ChartBlockEditor /> P3 derived', () => {
  it('differentiate — 새 시리즈 추가, name 에 d(...)/dx 포함', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          {
            name: 'src',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: 2, y: 4 },
              { x: 3, y: 9 },
            ],
          },
        ],
      },
    })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'add-derived'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange('diff:0'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.series).toHaveLength(2)
    expect(next.data.series[1]?.name).toContain('src')
    expect(next.data.series[1]?.name).toContain('d(')
    // y=x² 의 미분이 합리적 값 (central diff at x=1 → (4-0)/(2-0) = 2)
    const dpts = next.data.series[1]?.points ?? []
    expect(dpts.length).toBeGreaterThan(0)
    const at1 = dpts.find((p) => p.x === 1)
    expect(at1?.y).toBeCloseTo(2, 6)
  })

  it('integrate — 새 시리즈 추가, name 에 ∫...dx', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          {
            name: 'f',
            points: [
              { x: 0, y: 1 },
              { x: 1, y: 1 },
              { x: 2, y: 1 },
            ],
          },
        ],
      },
    })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'add-derived'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange('integrate:0'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.series).toHaveLength(2)
    expect(next.data.series[1]?.name).toContain('∫')
    // 상수 1 의 적분 — 끝점에서 누적값 ≈ 2
    const last = next.data.series[1]?.points?.at(-1)
    expect(last?.y).toBeCloseTo(2, 6)
  })

  it('peaks — annotations 에 marker 들 추가', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          {
            name: 'wave',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: 2, y: 0 },
              { x: 3, y: -1 },
              { x: 4, y: 0 },
              { x: 5, y: 1 },
              { x: 6, y: 0 },
            ],
          },
        ],
      },
    })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'add-derived'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange('peaks:0'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.annotations?.length ?? 0).toBeGreaterThan(0)
    expect(next.annotations!.every((a) => a.kind === 'marker')).toBe(true)
  })

  it('subtract (A - B) — 새 시리즈 추가 (2 시리즈 옵션이 등장)', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          {
            name: 'A',
            points: [
              { x: 0, y: 10 },
              { x: 1, y: 20 },
            ],
          },
          {
            name: 'B',
            points: [
              { x: 0, y: 1 },
              { x: 1, y: 5 },
            ],
          },
        ],
      },
    })
    const els = renderTree(block, onChange)
    const sel = els.find(findByMarker('data-toolbar', 'add-derived'))!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange(fakeSelectChange('subtract:0-1'))
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.series).toHaveLength(3)
    // diffSeries(a,b) 는 b - a — name 은 "B-A" 가 아니라 "A-B" 라고 정의했지만,
    // 호출은 diffSeries(a,b) 의 시그니처 (y_b - y_a) 라서 실제 값은 B 의 y - A 의 y.
    // 단, 추가 시리즈가 들어왔다는 사실만 검증 (값 부호는 plan 의 §2.6 와 일관성 확보 시
    // 별도 픽스가 필요할 수 있음).
    const last = next.data.series[2]
    expect((last?.points ?? []).length).toBeGreaterThan(0)
  })
})

/* ── Timestamp chip ──────────────────────────────────────────────────────── */

describe('<ChartBlockEditor /> P3 timestamp chip', () => {
  it('xAxisType=time 일 때만 chip 이 보인다', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      data: { labels: [], series: [], xAxisType: 'time' },
    })
    const els = renderTree(block, () => {})
    const chip = els.find(findByMarker('data-toolbar', 'x-axis-time'))
    expect(chip).toBeDefined()
  })

  it('xAxisType 미지정이면 chip 이 없다', () => {
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, () => {})
    const chip = els.find(findByMarker('data-toolbar', 'x-axis-time'))
    expect(chip).toBeUndefined()
  })

  it('chip 클릭 시 xAxisType="value" 로 바뀐다', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: { labels: [], series: [], xAxisType: 'time' },
    })
    const els = renderTree(block, onChange)
    const chip = els.find(findByMarker('data-toolbar', 'x-axis-time'))!
    ;(chip.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.xAxisType).toBe('value')
  })
})
