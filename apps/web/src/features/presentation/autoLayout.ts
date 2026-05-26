import type { Block, Section } from '@/types/document'

/**
 * Slide layout 자동 추천 (auto-layout 사이클).
 *
 * 사용자가 문서 작성 시 `section.layout` 을 일일이 지정하지 않으면 슬라이드는
 * 모두 stack (세로 나열) 으로 보여 *프레젠테이션 같지 않음*. 이 헬퍼는 chunk
 * 의 블록 구성을 분석해 더 자연스러운 layout 을 *추천* 한다.
 *
 * 호출자 (Presentation page) 는:
 *   1. `section.layout` 이 명시되어 있으면 그것을 우선 사용 (사용자 의도 존중).
 *   2. 명시 안 되어 있고 *auto-layout* 옵션이 켜져 있으면 `pickAutoLayout(chunk)`
 *      결과 사용.
 *   3. 발표 모드 toolbar 의 override (사용자 즉시 조정) 가 있으면 그것 우선.
 *
 * 결과 layout 종류는 SectionLayoutKind 와 정확히 일치 — SectionLayout 컴포넌트가
 * 그대로 받아 렌더한다.
 */
export type AutoLayoutKind =
  | 'stack'
  | 'two-col'
  | 'image-left'
  | 'image-right'
  | 'full-bleed'
  | 'title-only'

const TEXT_TYPES = new Set([
  'paragraph',
  'heading-4',
  'quote',
  'callout',
  'code',
  'math',
  'list',
])

const VISUAL_TYPES = new Set([
  'chart',
  'gantt',
  'flow',
  'org-chart',
  'whiteboard',
  'spreadsheet',
  'image-annotation',
  'kpi-cards',
  'gallery',
  'pdf',
  'iframe',
  'video',
])

const IMAGE_LIKE = new Set(['image', 'gallery', 'image-annotation'])

/**
 * 한 chunk (= 1 슬라이드 분량의 blocks) 분석 → 추천 layout.
 *
 * 휴리스틱 (우선순위 순):
 *  1. 블록 1개 → 'stack' (단독은 어떤 layout 도 의미 없음).
 *  2. *image* + 텍스트 — 첫 image의 위치에 따라 'image-left' or 'image-right'.
 *     image가 청크의 *처음* 1/3 안에 있으면 left, 끝 1/3 이면 right.
 *  3. *시각 블록 (chart/gantt/...) 1개 + 텍스트 ≤ 3 블록* → 'image-right'
 *     (시각 우측, 텍스트 좌측 = 캡션 패턴).
 *  4. *시각 블록 ≥ 2* (kpi-cards 다수 등) → 'two-col'.
 *  5. *paragraph + list + paragraph + list ...* 같은 텍스트 7개 이상 → 'two-col'.
 *  6. 그 외 → 'stack' (안전한 default).
 */
export function pickAutoLayout(chunk: readonly Block[]): AutoLayoutKind {
  if (!chunk || chunk.length === 0) return 'stack'
  if (chunk.length === 1) return 'stack'

  const types = chunk.map((b) => (b?.type as string) || '')
  const visualCount = types.filter((t) => VISUAL_TYPES.has(t)).length
  const textCount = types.filter((t) => TEXT_TYPES.has(t)).length
  const imageIdx = types.findIndex((t) => IMAGE_LIKE.has(t))

  // 2. image + 텍스트 — image 위치 따라 left/right
  if (imageIdx >= 0 && textCount >= 1) {
    const third = chunk.length / 3
    if (imageIdx < third) return 'image-left'
    if (imageIdx >= chunk.length - third) return 'image-right'
    // 가운데면 image-right 가 자연 (텍스트 먼저, 그림 나중)
    return 'image-right'
  }

  // 3. 시각 1 + 텍스트 짧음 — 시각 우측 캡션 패턴.
  //    textCount 5 까지 인정 (paragraph + math + callout + heading + 1 시각 = 5).
  if (visualCount === 1 && textCount >= 1 && textCount <= 5) {
    return 'image-right'
  }

  // 4. 시각 다수 — 2단 그리드 (kpi-cards/chart 등 나열)
  if (visualCount >= 2) {
    return 'two-col'
  }

  // 5. 텍스트만 많이 (예: paragraph 5+, list-heavy) → 2단 분리
  if (textCount >= 7 && visualCount === 0) {
    return 'two-col'
  }

  // 6. default
  return 'stack'
}

/**
 * Section 자체에 명시 layout 이 있으면 그것 우선, 아니면 chunk 로 자동 추천.
 * Presentation page 에서 한 줄 호출하기 위한 wrapper.
 */
export function resolveLayout(
  section: Pick<Section, 'layout'> | undefined,
  chunk: readonly Block[],
  autoLayoutEnabled: boolean,
): AutoLayoutKind {
  const explicit = section?.layout as AutoLayoutKind | undefined
  if (explicit) return explicit
  if (autoLayoutEnabled) return pickAutoLayout(chunk)
  return 'stack'
}
