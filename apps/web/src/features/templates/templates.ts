import type {
  Block,
  CalloutBlock,
  ChartBlock,
  CodeBlock,
  FlowBlock,
  GanttBlock,
  Heading4Block,
  KpiCardsBlock,
  ListBlock,
  MathBlock,
  ParagraphBlock,
  TableBlock,
  AccordionBlock,
  DataSourceBlock,
} from '@/types/document'

/**
 * Document templates — small library of pre-filled DocumentJSON section
 * blueprints loadable from the "+ 새 문서" page. Each template ships a
 * suggested title and a single top-level section seeded with a pragmatic
 * starter mix of block types so the user can hit the ground running.
 *
 * IDs are deliberately omitted in the static template — the consumer
 * (`templateToSections`) injects fresh ULIDs at instantiation time so two
 * documents created from the same template never collide.
 *
 * Composition design notes:
 *   - 월간 보고서: kpi-cards + chart + paragraph + callout — exec summary
 *   - 프로젝트 킥오프: heading + list + gantt + table — schedule + owners
 *   - 기술 설계서: heading + code + math + flow — algorithm-first layout
 *   - 회의록: heading + check-list + table — actions + attendees
 *   - FAQ: accordion — Q&A collapsibles
 *   - 데이터 분석: data-source + chart + kpi-cards — live dashboards
 */

import { ulid } from '@/features/editor/ulid'

export interface TemplateBlockSeed {
  block: Omit<Block, 'id'>
}

export interface TemplateSectionSeed {
  /** Section title shown in the TOC. */
  title: string
  /** Pre-built block list — IDs are filled by `templateToSections`. */
  blocks: Omit<Block, 'id'>[]
}

export interface TemplateDef {
  id: string
  title: string
  description: string
  /** A 1-line set of block kinds for the gallery thumbnail. */
  thumbnailIcons: string[]
  /** Flat, ordered list of one or more sections. */
  sections: TemplateSectionSeed[]
}

/** Helpers that strip `id` for type-safe template authoring. */
type Seed<B extends Block> = Omit<B, 'id'>

const para = (text: string): Seed<ParagraphBlock> => ({ type: 'paragraph', text })
const heading = (level: 2 | 3 | 4, title: string): Seed<Heading4Block> => ({
  type: 'heading-4',
  title,
  meta: { level },
})
const list = (style: ListBlock['style'], items: string[]): Seed<ListBlock> => ({
  type: 'list',
  style,
  items,
})
const callout = (
  variant: CalloutBlock['variant'],
  text: string,
  title?: string,
): Seed<CalloutBlock> => ({ type: 'callout', variant, text, ...(title ? { title } : {}) })
const code = (language: string, codeStr: string): Seed<CodeBlock> => ({
  type: 'code',
  language,
  code: codeStr,
})
const math = (expression: string): Seed<MathBlock> => ({ type: 'math', expression })
const table = (headers: string[], rows: string[][]): Seed<TableBlock> => ({
  type: 'table',
  headers,
  rows,
})
const chart = (
  chartType: ChartBlock['chartType'],
  title: string,
  data: ChartBlock['data'],
): Seed<ChartBlock> => ({ type: 'chart', chartType, title, data })
const gantt = (tasks: GanttBlock['tasks']): Seed<GanttBlock> => ({ type: 'gantt', tasks })
const flow = (engine: FlowBlock['engine'], source: string): Seed<FlowBlock> => ({
  type: 'flow',
  engine,
  source,
})
const kpi = (items: KpiCardsBlock['items']): Seed<KpiCardsBlock> => ({
  type: 'kpi-cards',
  items,
})
const dataSource = (
  endpoint: string,
  render: DataSourceBlock['render'],
): Seed<DataSourceBlock> => ({ type: 'data-source', endpoint, render, refreshInterval: 60 })
const accordion = (items: AccordionBlock['items']): Seed<AccordionBlock> => ({
  type: 'accordion',
  items,
})

export const TEMPLATES: ReadonlyArray<TemplateDef> = [
  {
    id: 'monthly-report',
    title: '월간 보고서',
    description: 'KPI 카드 + 차트 + 본문 + 콜아웃으로 한 장짜리 월간 요약을 작성',
    thumbnailIcons: ['📊', '📈', '¶', '!'],
    sections: [
      {
        title: '요약',
        blocks: [
          kpi([
            { label: '매출', value: 1200, delta: '+8%', trend: 'up' },
            { label: '신규 고객', value: 132, delta: '+12%', trend: 'up' },
            { label: '이탈률', value: '2.1%', delta: '-0.3%', trend: 'down' },
          ]),
          chart('bar', '월별 매출', {
            labels: ['1월', '2월', '3월', '4월', '5월'],
            series: [{ name: '매출', values: [800, 950, 1020, 1100, 1200] }],
          }),
          para('이번 달 매출은 전월 대비 8% 증가했고, 신규 고객 유입이 빠르게 늘었습니다.'),
          callout('tip', '다음 달 캠페인을 5월 셋째 주에 미리 시작하면 6월 분기 마감에 영향이 큽니다.', '액션 아이템'),
        ],
      },
    ],
  },
  {
    id: 'project-kickoff',
    title: '프로젝트 킥오프',
    description: '제목/목적/오너 리스트 + 간트 + 마일스톤 표로 킥오프 미팅 자료',
    thumbnailIcons: ['H₂', '•', '🗓', '▦'],
    sections: [
      {
        title: '프로젝트 개요',
        blocks: [
          heading(2, '목표'),
          list('bullet', [
            '핵심 가설을 3개월 내 검증',
            'MVP 사용자 50명 확보',
            '최소 1개 유료 전환',
          ]),
          heading(2, '일정'),
          gantt([
            { name: '요구분석', start: '2026-05-12', end: '2026-05-30', progress: 0 },
            { name: '설계', start: '2026-06-01', end: '2026-06-20', progress: 0 },
            { name: '개발', start: '2026-06-15', end: '2026-08-15', progress: 0 },
            { name: 'QA', start: '2026-08-01', end: '2026-08-31', progress: 0 },
          ]),
          heading(2, '오너십'),
          table(
            ['역할', '담당자', '책임'],
            [
              ['PM', '', '일정/리스크'],
              ['Tech Lead', '', '아키텍처'],
              ['Design', '', 'UX/UI'],
            ],
          ),
        ],
      },
    ],
  },
  {
    id: 'tech-design',
    title: '기술 설계서',
    description: '제목 + 알고리즘 코드 + 수식 + 다이어그램으로 설계 의사 결정 기록',
    thumbnailIcons: ['H₂', '<>', '∑', '🔁'],
    sections: [
      {
        title: '문제 정의',
        blocks: [
          heading(2, '배경'),
          para('레이턴시가 높은 핵심 API 의 캐시 전략을 새로 설계합니다.'),
          heading(2, '알고리즘'),
          code(
            'python',
            'def lru_get(key: str) -> str | None:\n    if key in cache:\n        cache.move_to_end(key)\n        return cache[key]\n    return None',
          ),
          heading(2, '복잡도'),
          math('O(\\log n) \\;\\text{평균},\\; O(n) \\;\\text{최악}'),
          heading(2, '플로우'),
          flow(
            'mermaid',
            'flowchart TD\n  A[Request] --> B{Cache hit?}\n  B -- yes --> C[Return]\n  B -- no --> D[Compute]\n  D --> E[Store]\n  E --> C',
          ),
        ],
      },
    ],
  },
  {
    id: 'meeting-notes',
    title: '회의록',
    description: '제목 + 액션 체크리스트 + 참석자 표로 1분 안에 회의 정리',
    thumbnailIcons: ['H₂', '☑', '▦'],
    sections: [
      {
        title: '회의록',
        blocks: [
          heading(2, '주요 결정'),
          list('check', [
            '결정 사항을 여기에 기록',
            '미해결 이슈는 “TODO” 항목으로 분리',
          ]),
          heading(2, '액션 아이템'),
          list('check', ['담당자 / 기한 / 항목 형태로 기록']),
          heading(2, '참석자'),
          table(['이름', '소속', '역할'], [['', '', ''], ['', '', '']]),
        ],
      },
    ],
  },
  {
    id: 'faq',
    title: 'FAQ',
    description: '아코디언으로 묶인 질문/답변 모음 — 자주 묻는 질문 페이지',
    thumbnailIcons: ['❓', '▾'],
    sections: [
      {
        title: 'FAQ',
        blocks: [
          accordion([
            { label: '서비스를 시작하려면 어떻게 하나요?', blocks: [{ ...para('첫 화면 우상단의 “시작하기” 버튼을 누르세요.'), id: ulid() }] },
            { label: '비용은 얼마인가요?', blocks: [{ ...para('14일 무료 체험 후 월 ₩9,900부터 시작합니다.'), id: ulid() }] },
            { label: '계정은 어떻게 삭제하나요?', blocks: [{ ...para('환경설정 → 계정 → “계정 삭제” 메뉴에서 진행할 수 있습니다.'), id: ulid() }] },
          ]),
        ],
      },
    ],
  },
  {
    id: 'data-analysis',
    title: '데이터 분석',
    description: 'data-source + 차트 + KPI 카드 — 라이브 데이터 대시보드',
    thumbnailIcons: ['🔌', '📈', '📊'],
    sections: [
      {
        title: '대시보드',
        blocks: [
          dataSource('/widgets/kpi/finance-daily', 'kpi-cards'),
          chart('line', '핵심 지표 추이', {
            labels: ['월', '화', '수', '목', '금'],
            series: [{ name: 'DAU', values: [120, 132, 110, 145, 160] }],
          }),
          kpi([
            { label: 'DAU', value: 160, delta: '+33%', trend: 'up' },
            { label: 'MAU', value: 1200, delta: '+5%', trend: 'up' },
          ]),
        ],
      },
    ],
  },
]

/**
 * Materialise a template into freshly-id'd `SectionLevel1[]` for the
 * `DocumentJSONV10.sections` field. We assign IDs eagerly so the editor
 * mounts with a stable shape (no second pass to `setBlocksRecursive`).
 */
export function templateToSections(tpl: TemplateDef): {
  id: string
  level: 1
  number: string
  title: string
  blocks: Block[]
  subsections: never[]
}[] {
  return tpl.sections.map((sec, i) => ({
    id: ulid(),
    level: 1,
    number: String(i + 1),
    title: sec.title,
    blocks: sec.blocks.map((seed) => ({ ...seed, id: ulid() }) as Block),
    subsections: [],
  }))
}

/** Lookup a template by id, undefined when not found. */
export function findTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
