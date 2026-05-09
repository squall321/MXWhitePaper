import type {
  Block,
  CalloutBlock,
  ChartBlock,
  CodeBlock,
  ColumnsBlock,
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

/**
 * Coarse buckets used by the gallery's filter row. Keeping it small (4 buckets)
 * keeps the filter UI compact and avoids the "every template gets a unique
 * category" anti-pattern that defeats the purpose of grouping.
 */
export type TemplateCategory = 'report' | 'collab' | 'tech' | 'announce'

export interface TemplateDef {
  id: string
  title: string
  description: string
  /** Filter bucket for the gallery's category row. */
  category: TemplateCategory
  /** A 1-line set of block kinds for the gallery thumbnail. */
  thumbnailIcons: string[]
  /** Flat, ordered list of one or more sections. */
  sections: TemplateSectionSeed[]
}

/** Display labels for the category filter row, in the order the UI shows them. */
export const TEMPLATE_CATEGORY_LABELS: ReadonlyArray<{
  value: TemplateCategory | 'all'
  label: string
}> = [
  { value: 'all', label: '전체' },
  { value: 'report', label: '보고서' },
  { value: 'collab', label: '협업' },
  { value: 'tech', label: '기술 문서' },
  { value: 'announce', label: '공지' },
]

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
const columns3 = (
  c1: Block[],
  c2: Block[],
  c3: Block[],
): Seed<ColumnsBlock> => ({
  type: 'columns',
  columns: [c1, c2, c3],
})
/** Wrap a Seed<Block> as a fully-formed Block with a fresh ULID. Used inside
 *  container blocks (columns / accordion / tabs) where children must already
 *  carry IDs at the moment the seed is materialised. */
const withId = <B extends Block>(seed: Omit<B, 'id'>): B =>
  ({ ...seed, id: ulid() }) as B

export const TEMPLATES: ReadonlyArray<TemplateDef> = [
  {
    id: 'monthly-report',
    title: '월간 보고서',
    description: 'KPI 카드 + 차트 + 본문 + 콜아웃으로 한 장짜리 월간 요약을 작성',
    category: 'report',
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
    category: 'collab',
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
    category: 'tech',
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
    category: 'collab',
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
    category: 'announce',
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
    category: 'report',
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
  {
    id: 'one-on-one',
    title: '1:1 미팅',
    description: '진행 상황 + 양방향 피드백 + 액션 체크리스트로 1:1 대화 정리',
    category: 'collab',
    thumbnailIcons: ['H₂', '¶', '•', '☑'],
    sections: [
      {
        title: '1:1 미팅',
        blocks: [
          heading(2, '진행 상황'),
          para('이번 주 업무 진행률과 블로커를 한 단락으로 정리하세요.'),
          heading(2, '피드백'),
          list('bullet', [
            '잘 진행되고 있는 점',
            '바뀌면 좋겠다고 느낀 점',
            '매니저에게 바라는 지원',
          ]),
          heading(2, '행동 계획'),
          list('check', [
            '다음 1:1 전에 끝낼 일 1',
            '다음 1:1 전에 끝낼 일 2',
          ]),
        ],
      },
    ],
  },
  {
    id: 'okr',
    title: 'OKR 분기 계획',
    description: '목표 + 핵심 결과 KPI + 위험 요소 + 주간 진척 차트로 분기 OKR 작성',
    category: 'report',
    thumbnailIcons: ['🎯', '📊', '!', '📈'],
    sections: [
      {
        title: 'OKR',
        blocks: [
          heading(2, '목표 (Objective)'),
          para('이번 분기 우리 팀이 달성할 한 줄짜리 상위 목표를 적습니다.'),
          heading(2, '핵심 결과 (Key Results)'),
          kpi([
            { label: 'KR1: 활성 사용자', value: 4500, delta: '목표 8000', trend: 'up' },
            { label: 'KR2: NPS', value: 42, delta: '목표 60', trend: 'up' },
            { label: 'KR3: 리텐션', value: '38%', delta: '목표 50%', trend: 'flat' },
          ]),
          heading(2, '위험 요소 + 의존성'),
          callout(
            'warn',
            '인프라 마이그레이션 일정이 OKR 달성 기간과 겹칩니다 — 예비 인력 확보 필요.',
            '리스크',
          ),
          heading(2, '주간 진척'),
          chart('line', '주간 진척률', {
            labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
            series: [{ name: '진척률(%)', values: [5, 12, 22, 31, 40, 48] }],
          }),
        ],
      },
    ],
  },
  {
    id: 'rfc',
    title: 'RFC',
    description: '요약 / 동기 / 제안 / 대안 / 미해결 질문 / 부록 — 의사결정 RFC',
    category: 'tech',
    thumbnailIcons: ['H₂', '¶', 'H₂', 'H₂'],
    sections: [
      {
        title: 'RFC',
        blocks: [
          heading(2, '요약'),
          para('한 단락 TL;DR — 무엇을 제안하며 왜 지금 결정해야 하는지.'),
          heading(2, '동기 (Motivation)'),
          para('이 결정을 내리지 않으면 어떤 문제가 발생하는지 구체적으로 적습니다.'),
          heading(2, '제안 (Proposal)'),
          para('제안하는 방법을 단계별로 설명합니다.'),
          heading(2, '대안 (Alternatives Considered)'),
          list('bullet', [
            '대안 A — 기각 사유',
            '대안 B — 기각 사유',
          ]),
          heading(2, '미해결 질문'),
          list('bullet', [
            '아직 결정하지 못한 점 1',
            '아직 결정하지 못한 점 2',
          ]),
          heading(2, '부록 (참고자료)'),
          list('bullet', [
            '관련 RFC / 문서 링크',
            '관련 데이터 / 측정 결과',
          ]),
        ],
      },
    ],
  },
  {
    id: 'retro',
    title: '회고 (Retrospective)',
    description: 'Keep / Problem / Try + 액션 아이템 표 — 스프린트/프로젝트 회고',
    category: 'collab',
    thumbnailIcons: ['H₂', '•', '☑', '▦'],
    sections: [
      {
        title: '회고',
        blocks: [
          heading(2, '잘한 점 (Keep)'),
          list('bullet', [
            '계속 유지하고 싶은 점 1',
            '계속 유지하고 싶은 점 2',
          ]),
          heading(2, '개선할 점 (Problem)'),
          list('bullet', [
            '아쉬웠던 점 1',
            '아쉬웠던 점 2',
          ]),
          heading(2, '시도해볼 것 (Try)'),
          list('check', [
            '다음 사이클에 시도해볼 실험 1',
            '다음 사이클에 시도해볼 실험 2',
          ]),
          heading(2, '액션 아이템'),
          table(
            ['액션', '담당', 'D-day'],
            [
              ['', '', ''],
              ['', '', ''],
            ],
          ),
        ],
      },
    ],
  },
  {
    id: 'postmortem',
    title: '장애 부검 (Postmortem)',
    description: '요약 + 영향도 KPI + 타임라인 표 + 근본 원인 + 액션 + 교훈',
    category: 'tech',
    thumbnailIcons: ['H₂', '📊', '▦', 'H₂'],
    sections: [
      {
        title: '장애 부검',
        blocks: [
          heading(2, '요약'),
          para('어떤 장애가 언제 발생해 어떻게 복구되었는지 한 단락으로 요약합니다.'),
          kpi([
            { label: '영향도', value: 'P1' },
            { label: '다운타임', value: '37분' },
            { label: '영향 사용자', value: '12,400' },
          ]),
          heading(2, '타임라인'),
          table(
            ['시각 (KST)', '이벤트', '담당'],
            [
              ['14:02', '알림 발생', '오너'],
              ['14:09', '원인 추정', '오너'],
              ['14:39', '롤백 완료', '오너'],
            ],
          ),
          heading(2, '근본 원인'),
          para('5 Whys 또는 Fishbone 형태로 근본 원인을 적습니다.'),
          heading(2, '액션 아이템'),
          list('check', [
            '재발 방지 액션 1',
            '재발 방지 액션 2',
          ]),
          heading(2, '교훈'),
          callout('tip', '비난 없는(blameless) 회고로 시스템적 개선 포인트를 적습니다.', '교훈'),
        ],
      },
    ],
  },
  {
    id: 'design-doc',
    title: '기능 설계서 (Design Doc)',
    description: '배경 / 목표 / 아키텍처 / API / 데이터 모델 / 보안 / 테스트 / 출시',
    category: 'tech',
    thumbnailIcons: ['H₂', '🔁', '▦', 'H₂'],
    sections: [
      {
        title: '기능 설계서',
        blocks: [
          heading(2, '배경'),
          para('어떤 사용자 문제를 풀려는지 한 단락으로 정리합니다.'),
          heading(2, '목표 / 비목표'),
          list('bullet', [
            '목표: 측정 가능한 성공 기준 1',
            '목표: 측정 가능한 성공 기준 2',
            '비목표: 이번 범위에서 제외되는 항목',
          ]),
          heading(2, '시스템 아키텍처'),
          flow(
            'mermaid',
            'flowchart LR\n  U[사용자] --> W[Web]\n  W --> A[API]\n  A --> D[(DB)]\n  A --> Q[[Queue]]\n  Q --> WK[Worker]',
          ),
          heading(2, 'API 설계'),
          table(
            ['Method', 'Path', '요약'],
            [
              ['GET', '/api/v1/foo', '리스트 조회'],
              ['POST', '/api/v1/foo', '생성'],
              ['PATCH', '/api/v1/foo/{id}', '부분 수정'],
            ],
          ),
          heading(2, '데이터 모델'),
          para('주요 엔티티와 관계를 표 또는 ERD로 설명합니다.'),
          heading(2, '보안 / 권한'),
          list('bullet', [
            '인증 방식 (JWT / 세션 등)',
            '권한 매트릭스 (RBAC / ABAC)',
            '민감 데이터 처리',
          ]),
          heading(2, '테스트 전략'),
          list('check', [
            '단위 테스트 범위',
            '통합 테스트 시나리오',
            '부하/회귀 테스트',
          ]),
          heading(2, '출시 계획'),
          list('bullet', [
            '내부 베타',
            '점진적 롤아웃 (10% → 50% → 100%)',
            '롤백 기준',
          ]),
        ],
      },
    ],
  },
  {
    id: 'brainstorm',
    title: '브레인스토밍',
    description: '주제 + 3-컬럼 아이디어 평가 (가능성 / 비용 / 영향) + 다음 단계',
    category: 'collab',
    thumbnailIcons: ['H₂', '¶', '▥', '▶'],
    sections: [
      {
        title: '브레인스토밍',
        blocks: [
          heading(2, '주제'),
          para('해결하려는 문제를 1줄로 적으세요.'),
          heading(2, '아이디어'),
          columns3(
            [
              withId<Heading4Block>(heading(3, '가능성')),
              withId<ListBlock>(list('bullet', ['아이디어 A', '아이디어 B'])),
            ],
            [
              withId<Heading4Block>(heading(3, '비용')),
              withId<ListBlock>(list('bullet', ['아이디어 A: 중', '아이디어 B: 저'])),
            ],
            [
              withId<Heading4Block>(heading(3, '영향')),
              withId<ListBlock>(list('bullet', ['아이디어 A: 고', '아이디어 B: 중'])),
            ],
          ),
          heading(2, '다음 단계'),
          list('check', [
            '가장 가능성 높은 아이디어 1개 선정',
            '담당자 / 기한 정하기',
          ]),
        ],
      },
    ],
  },
  {
    id: 'announce',
    title: '공지사항',
    description: '요약 + 중요 안내 콜아웃 + 적용일 + 영향 범위 + FAQ 아코디언',
    category: 'announce',
    thumbnailIcons: ['¶', '!', 'H₂', '▾'],
    sections: [
      {
        title: '공지사항',
        blocks: [
          para('한 단락으로 변경 내용을 요약합니다 — 무엇이 / 왜 / 언제부터.'),
          callout('info', '본 공지는 모든 사용자에게 적용됩니다. 적용일 이전에 한 번 더 확인해 주세요.', '중요 안내'),
          heading(2, '적용일'),
          para('YYYY-MM-DD 부터 적용됩니다.'),
          heading(2, '영향 범위'),
          list('bullet', [
            '대상 사용자 / 조직',
            '영향 받는 기능',
            '영향 받지 않는 기능',
          ]),
          heading(2, 'FAQ'),
          accordion([
            { label: '이 변경이 내 작업에 영향을 주나요?', blocks: [withId<ParagraphBlock>(para('대부분의 경우 별도 조치가 필요하지 않습니다.'))] },
            { label: '이전 동작으로 돌아갈 수 있나요?', blocks: [withId<ParagraphBlock>(para('전환 기간 동안 환경설정에서 임시로 되돌릴 수 있습니다.'))] },
            { label: '문의는 어디로 하나요?', blocks: [withId<ParagraphBlock>(para('지원 채널 또는 담당자에게 문의해 주세요.'))] },
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
