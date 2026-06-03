/**
 * G4 — TimelineBlock unit tests.
 *
 * collectTimelineFilters resolves bound TimelineBlocks to engine `between`
 * filter specs; the SlicerBlock shape is intentionally rejected so the
 * sibling resolver `collectSlicerFilters` keeps producing slicer filters.
 *
 * The viewer itself is integration-level (range inputs + zustand store);
 * here we cover the pure helper so widget viewers can rely on it.
 */
import { describe, expect, it } from 'vitest'
import { collectTimelineFilters } from '../TimelineBlock'

describe('collectTimelineFilters', () => {
  const mkTimeline = (id: string, field: string) => ({
    type: 'timeline' as const,
    id,
    field,
    source: { kind: 'inline' as const, rows: [] },
  })

  it('boundSlicers 가 비어있으면 []', () => {
    expect(collectTimelineFilters([], [], {})).toEqual([])
  })

  it('timeline 의 active 가 [from, to] 일 때만 between 필터 생성', () => {
    const sections = [
      { blocks: [mkTimeline('TIMELINE00000000000000000A', 'date')] },
    ]
    const filters = collectTimelineFilters(
      ['TIMELINE00000000000000000A'],
      sections,
      { TIMELINE00000000000000000A: ['2026-01-01', '2026-03-31'] },
    )
    expect(filters).toEqual([
      { field: 'date', op: 'between', value: ['2026-01-01', '2026-03-31'] },
    ])
  })

  it('active 가 빈 배열이면 그 timeline 은 필터 미생성 (All semantic)', () => {
    const sections = [
      { blocks: [mkTimeline('TIMELINE00000000000000000A', 'date')] },
    ]
    expect(
      collectTimelineFilters(['TIMELINE00000000000000000A'], sections, {
        TIMELINE00000000000000000A: [],
      }),
    ).toEqual([])
  })

  it('active 길이가 2 가 아니면 무시 (방어적 — store 가 깨진 경우)', () => {
    const sections = [
      { blocks: [mkTimeline('TIMELINE00000000000000000A', 'date')] },
    ]
    expect(
      collectTimelineFilters(['TIMELINE00000000000000000A'], sections, {
        TIMELINE00000000000000000A: ['2026-01-01'],
      }),
    ).toEqual([])
  })

  it('SlicerBlock id 는 timeline 으로 해석하지 않음 (resolver 분리)', () => {
    const sections = [
      {
        blocks: [
          {
            type: 'slicer' as const,
            id: 'SLICER00000000000000000000',
            field: 'dept',
            source: { kind: 'inline' as const, rows: [] },
          },
        ],
      },
    ]
    expect(
      collectTimelineFilters(['SLICER00000000000000000000'], sections, {
        SLICER00000000000000000000: ['2026-01-01', '2026-03-31'],
      }),
    ).toEqual([])
  })

  it('boundSlicer 가 draft 에 없으면 skip (no throw)', () => {
    expect(
      collectTimelineFilters(['MISSING000000000000000000U'], [], {
        MISSING000000000000000000U: ['2026-01-01', '2026-03-31'],
      }),
    ).toEqual([])
  })
})
