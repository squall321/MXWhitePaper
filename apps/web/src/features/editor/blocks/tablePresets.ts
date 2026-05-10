import { ulid } from '../ulid'
import type { TableBlock } from '@/types/document'

/**
 * Pre-built TableBlock seeds surfaced via the slash menu / insert palette.
 *
 * Each preset returns a brand-new TableBlock with sensible defaults — a
 * realistic example row so the user immediately sees the formatting in
 * action (sortable / footer / column dtypes), and column metadata that
 * showcases the dtype machinery (currency / date / etc.).
 *
 * Keep these seeds compact: they're starting points, not exhaustive
 * fixtures. Users will edit the rows on the spot anyway.
 */

export type TablePresetKind =
  | 'blank'
  | 'comparison'
  | 'schedule'
  | 'budget'
  | 'checklist'

export type TablePresetDef = {
  kind: TablePresetKind
  label: string
  emoji: string
  build: () => TableBlock
}

export const TABLE_PRESETS: TablePresetDef[] = [
  {
    kind: 'blank',
    label: '표 (빈 표)',
    emoji: '⊞',
    build: () => ({
      type: 'table',
      id: ulid(),
      headers: ['열 1', '열 2'],
      rows: [['', '']],
    }),
  },
  {
    kind: 'comparison',
    label: '비교표',
    emoji: '⚖',
    build: () => ({
      type: 'table',
      id: ulid(),
      headers: ['항목', '옵션 A', '옵션 B'],
      rows: [
        ['가격', '월 ₩50,000', '월 ₩80,000'],
        ['지원 인원', '10명', '50명'],
        ['주요 기능', '기본 + 분석', '기본 + 분석 + 자동화'],
        ['장점', '단순/저렴', '확장성/고급'],
        ['단점', '확장 한계', '학습 곡선'],
      ],
      columns: [
        { width: '20%', align: 'left' },
        { align: 'left' },
        { align: 'left' },
      ],
      options: { stripe: true, borderStyle: 'horizontal' },
    }),
  },
  {
    kind: 'schedule',
    label: '일정표',
    emoji: '📅',
    build: () => ({
      type: 'table',
      id: ulid(),
      headers: ['날짜', '담당', '작업', '상태'],
      rows: [
        ['2026-05-12', '홍길동', '요구사항 정리', '진행중'],
        ['2026-05-15', '김철수', '디자인 리뷰', '대기'],
        ['2026-05-20', '이영희', '구현 착수', '예정'],
      ],
      columns: [
        { width: '120px', dtype: 'date', format: 'YYYY-MM-DD', align: 'center' },
        { width: '100px' },
        {},
        { width: '90px', align: 'center' },
      ],
      options: {
        stripe: true,
        sortable: true,
        searchable: true,
      },
    }),
  },
  {
    kind: 'budget',
    label: '예산표',
    emoji: '💰',
    build: () => ({
      type: 'table',
      id: ulid(),
      headers: ['항목', 'Q1', 'Q2', 'Q3', 'Q4'],
      rows: [
        ['인건비', '120,000,000', '120,000,000', '125,000,000', '125,000,000'],
        ['장비', '30,000,000', '0', '20,000,000', '0'],
        ['외주', '10,000,000', '15,000,000', '15,000,000', '20,000,000'],
        ['기타', '5,000,000', '5,000,000', '5,000,000', '5,000,000'],
      ],
      columns: [
        { width: '160px' },
        { dtype: 'currency', format: 'KRW' },
        { dtype: 'currency', format: 'KRW' },
        { dtype: 'currency', format: 'KRW' },
        { dtype: 'currency', format: 'KRW' },
      ],
      footer: {
        show: true,
        label: '합계',
        aggregates: ['', 'sum', 'sum', 'sum', 'sum'],
      },
      options: {
        stripe: true,
        stickyFirstCol: true,
        borderStyle: 'all',
      },
    }),
  },
  {
    kind: 'checklist',
    label: '체크리스트 표',
    emoji: '☑',
    build: () => ({
      type: 'table',
      id: ulid(),
      headers: ['', '작업', '담당', '마감'],
      rows: [
        ['☐', '요구사항 명세 작성', '홍길동', '2026-05-12'],
        ['☐', '데이터 모델 검토', '김철수', '2026-05-14'],
        ['☐', 'API 스켈레톤', '이영희', '2026-05-18'],
        ['☐', '단위 테스트', '박지민', '2026-05-22'],
      ],
      columns: [
        { width: '40px', align: 'center' },
        {},
        { width: '120px' },
        { width: '120px', dtype: 'date', format: 'YYYY-MM-DD', align: 'center' },
      ],
      options: {
        stripe: false,
        borderStyle: 'horizontal',
        rowNumbers: true,
      },
    }),
  },
]

/**
 * Convenience lookup — used by the insert palette where we want to map
 * preset keys directly without scanning the array.
 */
export function getTablePreset(kind: TablePresetKind): TablePresetDef {
  const found = TABLE_PRESETS.find((p) => p.kind === kind)
  if (!found) throw new Error(`Unknown table preset: ${kind}`)
  return found
}
