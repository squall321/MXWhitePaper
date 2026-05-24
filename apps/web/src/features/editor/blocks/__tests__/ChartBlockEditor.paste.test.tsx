/**
 * ChartBlockEditor — paste 핸들러 + applyChartPasteToBlock 단위 테스트.
 *
 * 프로젝트 테스트 인프라가 jsdom 을 의도적으로 회피하므로 (CellBlockEditor
 * 테스트의 주석 참고), 여기서는 (1) 순수 함수 `applyChartPasteToBlock` 의
 * 동작과 (2) ChartBlockEditor 를 일반 함수처럼 호출해 반환된 JSX 트리에서
 * onPaste 핸들러를 찾아 가짜 ClipboardEvent 로 호출하는 방식으로 검증한다.
 */
import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import {
  ChartBlockEditor,
  applyChartPasteToBlock,
} from '../ChartBlockEditor'
import type { ChartBlock } from '@/types/document'
import type { ChartPasteResult } from '../_chartPaste'

// React hooks 가 render 컨텍스트 밖이라 invalid — passthrough 로 무력화.
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

// zustand store hook 도 render 컨텍스트가 필요 — selector 만 호출하는
// 가짜 hook 으로 대체. ChartBlockEditor 는 `draft` 만 읽어 findFirstTable
// 에 넘기므로 draft=null 로 충분 (toolbar/paste 경로와 무관).
vi.mock('@/features/editor/state', () => ({
  useEditorStore: <T,>(selector: (state: { draft: null }) => T): T =>
    selector({ draft: null }),
}))

// i18n useT 도 내부적으로 useSettingsStore (zustand) 를 호출해 hook 컨텍스트가
// 필요하므로, key 와 params 의 형태만 보존하는 간단한 fake 로 대체.
vi.mock('@/lib/i18n', () => ({
  useT:
    () =>
    (key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
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

/* ── applyChartPasteToBlock — 순수 함수 ───────────────────────────────── */

describe('applyChartPasteToBlock', () => {
  it('xy-line 차트에 기존 series 가 있으면 paste 결과를 append 한다', () => {
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          { name: '시료 A', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        ],
      },
    })
    const parsed: ChartPasteResult = {
      series: [
        { name: '시료 B', points: [{ x: 0, y: 0 }, { x: 2, y: 4 }] },
      ],
    }
    const next = applyChartPasteToBlock(block, parsed)
    expect(next.chartType).toBe('xy-line')
    expect(next.data.series).toHaveLength(2)
    expect(next.data.series[0]?.name).toBe('시료 A')
    expect(next.data.series[1]?.name).toBe('시료 B')
  })

  it('다른 chartType 일 때는 xy-line 으로 전환하고 series 를 교체한다', () => {
    const block = makeBlock({
      chartType: 'line',
      data: {
        labels: ['1월', '2월'],
        series: [{ name: '기존', values: [1, 2] }],
      },
    })
    const parsed: ChartPasteResult = {
      title: 'Stress-Strain',
      xAxisLabel: 'Strain',
      yAxisLabel: 'Stress [MPa]',
      series: [{ name: 'Stress', points: [{ x: 0, y: 0 }, { x: 1, y: 100 }] }],
    }
    const next = applyChartPasteToBlock(block, parsed)
    expect(next.chartType).toBe('xy-line')
    expect(next.data.series).toHaveLength(1)
    expect(next.data.series[0]?.name).toBe('Stress')
    // 빈 title/축 라벨은 paste 결과로 채워진다.
    expect(next.title).toBe('Stress-Strain')
    expect(next.data.xAxisLabel).toBe('Strain')
    expect(next.data.yAxisLabel).toBe('Stress [MPa]')
  })

  it('기존 title / 축 라벨이 있으면 paste 결과로 덮어쓰지 않는다', () => {
    const block = makeBlock({
      title: '기존 제목',
      data: {
        labels: [],
        series: [],
        xAxisLabel: '기존 X',
        yAxisLabel: '기존 Y',
      },
    })
    const parsed: ChartPasteResult = {
      title: 'New Title',
      xAxisLabel: 'New X',
      yAxisLabel: 'New Y',
      series: [{ name: 's1', points: [{ x: 1, y: 2 }] }],
    }
    const next = applyChartPasteToBlock(block, parsed)
    expect(next.title).toBe('기존 제목')
    expect(next.data.xAxisLabel).toBe('기존 X')
    expect(next.data.yAxisLabel).toBe('기존 Y')
  })
})

/* ── ChartBlockEditor onPaste 핸들러 — 트리 탐색 방식 ──────────────────── */

/**
 * 트리 walker — host element (string type) 만 yield 한다. 자식 function
 * component (ChartBlockView, InteractionsPanel 등) 는 자체 hook 을 가질 수
 * 있으므로 expand 하지 않는다. ChartBlockEditor 가 직접 그린 wrapper div /
 * toolbar / 버튼만 찾으면 충분.
 */
function* walk(node: unknown): Generator<React.ReactElement> {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n)
    return
  }
  if (typeof node !== 'object') return
  const el = node as React.ReactElement
  if (!el.props) return
  if (typeof el.type === 'function') return // function component — skip subtree
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

function fakeClipboardEvent(text: string): React.ClipboardEvent<HTMLDivElement> {
  return {
    target: { tagName: 'DIV', isContentEditable: false } as HTMLElement,
    clipboardData: { getData: (_: string) => text },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.ClipboardEvent<HTMLDivElement>
}

describe('<ChartBlockEditor /> onPaste', () => {
  it('TSV paste 시 onChange 가 호출되고 series 가 채워진다', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    // 가장 바깥 div (paste 핸들러 부착된) 를 찾는다.
    const wrapper = els.find(
      (e) =>
        e.type === 'div' &&
        typeof (e.props as { onPaste?: unknown }).onPaste === 'function',
    )
    expect(wrapper).toBeDefined()
    const onPaste = (
      wrapper!.props as {
        onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
      }
    ).onPaste
    const tsv = 'x\ty\n0\t0\n1\t2\n2\t4'
    onPaste(fakeClipboardEvent(tsv))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.chartType).toBe('xy-line')
    expect(next.data.series).toHaveLength(1)
    expect(next.data.series[0]?.points).toHaveLength(3)
  })

  it('xy-line + 기존 series 가 있으면 paste 는 append 한다', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'xy-line',
      data: {
        labels: [],
        series: [
          { name: '기존', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        ],
      },
    })
    const els = renderTree(block, onChange)
    const wrapper = els.find(
      (e) =>
        e.type === 'div' &&
        typeof (e.props as { onPaste?: unknown }).onPaste === 'function',
    )!
    const onPaste = (
      wrapper.props as {
        onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
      }
    ).onPaste
    onPaste(fakeClipboardEvent('x\ty\n0\t10\n1\t20'))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.data.series).toHaveLength(2)
  })

  it('다른 chartType 일 때 paste 는 xy-line 으로 전환한다', () => {
    const onChange = vi.fn()
    const block = makeBlock({
      chartType: 'bar',
      data: {
        labels: ['1', '2'],
        series: [{ name: 'old', values: [1, 2] }],
      },
    })
    const els = renderTree(block, onChange)
    const wrapper = els.find(
      (e) =>
        e.type === 'div' &&
        typeof (e.props as { onPaste?: unknown }).onPaste === 'function',
    )!
    const onPaste = (
      wrapper.props as {
        onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
      }
    ).onPaste
    onPaste(fakeClipboardEvent('x\ty\n0\t0\n1\t1'))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.chartType).toBe('xy-line')
  })

  it('CSV/TSV 가 아닌 텍스트 paste 는 onChange 를 호출하지 않는다', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const wrapper = els.find(
      (e) =>
        e.type === 'div' &&
        typeof (e.props as { onPaste?: unknown }).onPaste === 'function',
    )!
    const onPaste = (
      wrapper.props as {
        onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
      }
    ).onPaste
    onPaste(fakeClipboardEvent('그냥 평문 텍스트입니다.'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('input 안에서 paste 해도 표 모양이면 가로챈다 (직관적 UX)', () => {
    // 사용자 보고로 정책 변경 — 차트 블록의 input 셀에 paste 했을 때도
    // 클립보드 내용이 표 모양 (multi-line + tab/comma) 이면 차트 데이터로
    // 인식해야 한다. 표 모양 아닌 평문은 native paste 그대로 (이 테스트
    // 범위 밖).
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const wrapper = els.find(
      (e) =>
        e.type === 'div' &&
        typeof (e.props as { onPaste?: unknown }).onPaste === 'function',
    )!
    const onPaste = (
      wrapper.props as {
        onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
      }
    ).onPaste
    const ev = {
      target: { tagName: 'INPUT', isContentEditable: false } as HTMLElement,
      clipboardData: { getData: (_: string) => 'x\ty\n0\t0\n1\t1' },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.ClipboardEvent<HTMLDivElement>
    onPaste(ev)
    expect(onChange).toHaveBeenCalled()
    expect(ev.preventDefault).toHaveBeenCalled()
    expect(ev.stopPropagation).toHaveBeenCalled()
  })
})

/* ── toolbar — xy-line 차트에서만 보이고 토글이 display 를 업데이트 ─── */

describe('<ChartBlockEditor /> toolbar', () => {
  it('xy-line 일 때 toolbar 가 렌더된다', () => {
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, () => {})
    const toolbar = els.find(
      (e) => (e.props as { role?: string }).role === 'toolbar',
    )
    expect(toolbar).toBeDefined()
  })

  it('다른 chartType 에서는 toolbar 가 렌더되지 않는다', () => {
    const block = makeBlock({
      chartType: 'line',
      data: { labels: ['1'], series: [{ name: 'a', values: [1] }] },
    })
    const els = renderTree(block, () => {})
    const toolbar = els.find(
      (e) => (e.props as { role?: string }).role === 'toolbar',
    )
    expect(toolbar).toBeUndefined()
  })

  it('grid 토글 버튼 클릭 시 display.gridOn 이 false 로 바뀐다', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const btn = els.find(
      (e) =>
        e.type === 'button' &&
        (e.props as { 'data-toolbar'?: string })['data-toolbar'] === 'grid',
    )
    expect(btn).toBeDefined()
    const handler = (btn!.props as { onClick: () => void }).onClick
    handler()
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.gridOn).toBe(false)
  })

  it('X log 토글 버튼 클릭 시 display.xLog 가 true 로 바뀐다', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const btn = els.find(
      (e) =>
        e.type === 'button' &&
        (e.props as { 'data-toolbar'?: string })['data-toolbar'] === 'xlog',
    )!
    ;(btn.props as { onClick: () => void }).onClick()
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.xLog).toBe(true)
  })

  // P3 — 기존 fit 토글 버튼은 select (data-toolbar="fit-type") 로 대체됨.
  // 'linear' 옵션 선택 시 showFit + fitType 가 같이 갱신된다.
  it('Fit select 에서 "linear" 선택 시 display.showFit/fitType 가 갱신된다', () => {
    const onChange = vi.fn()
    const block = makeBlock({ chartType: 'xy-line' })
    const els = renderTree(block, onChange)
    const sel = els.find(
      (e) =>
        e.type === 'select' &&
        (e.props as { 'data-toolbar'?: string })['data-toolbar'] === 'fit-type',
    )!
    ;(sel.props as {
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    }).onChange({
      target: { value: 'linear' } as HTMLSelectElement,
    } as unknown as React.ChangeEvent<HTMLSelectElement>)
    const next = onChange.mock.calls[0]![0] as ChartBlock
    expect(next.display?.showFit).toBe(true)
    expect(next.display?.fitType).toBe('linear')
  })
})
