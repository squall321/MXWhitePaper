import { describe, it, expect } from 'vitest'
import { pickAutoLayout, resolveLayout } from '../autoLayout'
import type { Block } from '@/types/document'

const para = (id: string, text = 'p'): Block => ({ type: 'paragraph', id, text } as Block)
const chart = (id: string): Block => ({ type: 'chart', id } as unknown as Block)
const gantt = (id: string): Block => ({ type: 'gantt', id } as unknown as Block)
const image = (id: string): Block => ({ type: 'image', id, imageId: id } as unknown as Block)
const kpi = (id: string): Block => ({ type: 'kpi-cards', id, items: [] } as unknown as Block)
const list = (id: string): Block => ({ type: 'list', id, items: [] } as unknown as Block)

describe('pickAutoLayout', () => {
  it('빈 청크 → stack', () => {
    expect(pickAutoLayout([])).toBe('stack')
  })

  it('단일 블록 → stack (어떤 layout도 의미 없음)', () => {
    expect(pickAutoLayout([chart('c1')])).toBe('stack')
    expect(pickAutoLayout([para('p1')])).toBe('stack')
  })

  it('image + 텍스트 (image 앞쪽) → image-left', () => {
    const out = pickAutoLayout([image('i1'), para('p1'), para('p2'), para('p3')])
    expect(out).toBe('image-left')
  })

  it('image + 텍스트 (image 뒷쪽) → image-right', () => {
    const out = pickAutoLayout([para('p1'), para('p2'), para('p3'), image('i1')])
    expect(out).toBe('image-right')
  })

  it('image 가운데 → image-right (텍스트 먼저, 그림 나중)', () => {
    const out = pickAutoLayout([para('p1'), para('p2'), image('i1'), para('p3'), para('p4'), para('p5')])
    expect(out).toBe('image-right')
  })

  it('시각 1 + 텍스트 적음 (≤3) → image-right (캡션 패턴)', () => {
    const out = pickAutoLayout([para('p1'), chart('c1')])
    expect(out).toBe('image-right')
    const out2 = pickAutoLayout([para('p1'), para('p2'), gantt('g1')])
    expect(out2).toBe('image-right')
  })

  it('시각 다수 (kpi 등) → two-col', () => {
    const out = pickAutoLayout([kpi('k1'), kpi('k2'), kpi('k3'), kpi('k4')])
    expect(out).toBe('two-col')
  })

  it('chart 2개 → two-col', () => {
    expect(pickAutoLayout([chart('c1'), chart('c2')])).toBe('two-col')
  })

  it('텍스트만 많이 (7+) → two-col', () => {
    const blocks = Array.from({ length: 8 }, (_, i) => para(`p${i}`))
    expect(pickAutoLayout(blocks)).toBe('two-col')
  })

  it('텍스트 7 + 시각 1 → stack (textCount > 5, 시각1 캡션 룰 미적용)', () => {
    const blocks = [...Array.from({ length: 7 }, (_, i) => para(`p${i}`)), chart('c1')]
    // 텍스트 7 + 시각 1, chunk 8, textCount>5 라 image-right 룰 미적용.
    // 텍스트 7+ 룰은 visualCount===0 조건 못 맞춰 미적용 → 'stack'
    expect(pickAutoLayout(blocks)).toBe('stack')
  })

  it('텍스트 5 + 시각 1 → image-right (룰 확장)', () => {
    const blocks = [...Array.from({ length: 5 }, (_, i) => para(`p${i}`)), chart('c1')]
    expect(pickAutoLayout(blocks)).toBe('image-right')
  })

  it('list 2 + chart 1 → image-right (시각 1 + 텍스트 적음)', () => {
    const out = pickAutoLayout([list('l1'), list('l2'), chart('c1')])
    expect(out).toBe('image-right')
  })
})

describe('resolveLayout', () => {
  it('section.layout 명시 → 그것 우선 (사용자 의도 존중)', () => {
    const section = { layout: 'two-col' as const }
    const chunk = [chart('c1')]
    expect(resolveLayout(section, chunk, true)).toBe('two-col')
    expect(resolveLayout(section, chunk, false)).toBe('two-col')
  })

  it('section.layout 없음 + auto 켜짐 → pickAutoLayout', () => {
    const out = resolveLayout({}, [para('p1'), chart('c1')], true)
    expect(out).toBe('image-right')
  })

  it('section.layout 없음 + auto 꺼짐 → stack (default)', () => {
    const out = resolveLayout({}, [para('p1'), chart('c1')], false)
    expect(out).toBe('stack')
  })

  it('section undefined → auto 동작', () => {
    expect(resolveLayout(undefined, [kpi('k1'), kpi('k2'), kpi('k3')], true)).toBe('two-col')
    expect(resolveLayout(undefined, [chart('c1')], true)).toBe('stack')
  })
})
