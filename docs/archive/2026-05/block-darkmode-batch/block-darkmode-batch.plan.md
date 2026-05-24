# Block Darkmode Batch — Planning Document

> **Summary**: SVG-block-audit 후 발견된 *비-SVG 블록*의 `bg-white`/`border-gray-200`/
> `text-gray-*` light-only Tailwind 패턴 전수 점검 + dark 변형 추가. 26 파일 ~50줄.
>
> **Project**: MX White Paper
> **Feature**: block-darkmode-batch
> **Date**: 2026-05-24

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | 직전 svg-block-audit 사이클이 SVG 블록만 봤음. 나머지 블록의 `bg-white`/`border-gray-200`/`text-gray-900` 등 light-only Tailwind 클래스가 26 파일에 ~50줄 잔존 → 다크 모드에서 흰 박스 떠 있고 텍스트 깨짐. |
| **Solution** | 검증된 패턴 (`dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100/200/300/400`) 일괄 적용. 새 토큰/hook 신설 X. AllBlocksRender snapshot 갱신 (영향 블록 다수). |
| **Function/UX Effect** | 다크 테마에서 *모든* 블록 표면이 어두운 surface로. 위젯 전반 다크 일관성 100% 달성 (SVG audit + block batch). |
| **Core Value** | "위젯 다크 일관성 완성" — table/spreadsheet/list/kpi/bibliography/figure-index/gantt/chart/orgchart + 나머지 26 블록 = **전체** 위젯이 다크 대응. 향후 새 블록 추가 시 `dark:` 변형 의무화 (코드리뷰 체크리스트). |

---

## 1. Overview

### 1.1 Audit 결과 (heuristic grep)

| 파일 | 위반 라인 |
|---|---|
| AccordionBlock | 2 |
| CalculatorBlock | 1 |
| CalloutBlock | 1 |
| CodeBlock | 2 |
| DashboardEmbedBlock | 2 |
| DataSourceBlock | 1 |
| DocLinkCardBlock | 2 |
| FigureIndexBlock | 3 |
| FileBlock | 1 |
| FlowBlock | 1 |
| FormBlock | 4 |
| GalleryBlock | 2 |
| GlossaryRefBlock | 2 |
| IframeBlock | 2 |
| ImageAnnotationBlock | 1 |
| ImageBlock | 1 |
| KpiCardsBlock | 2 |
| PdfBlock | 1 |
| PlaceholderBlock | 1 |
| QuizBlock | 2 |
| SpreadsheetBlock | 6 |
| TableBlock | 5 |
| TabsBlock | 3 |
| VideoBlock | 3 |
| WhiteboardBlock | 1 |
| BlockRenderer | 1 (utility) |
| **합계** | **~50** |

### 1.2 색 매핑 표준

| Light Tailwind | Dark 변형 |
|---|---|
| `bg-white` | `dark:bg-gray-900` |
| `bg-gray-50` | `dark:bg-gray-800` |
| `bg-gray-100` | `dark:bg-gray-800` |
| `border-gray-200` | `dark:border-gray-700` |
| `border-gray-300` | `dark:border-gray-600` |
| `text-gray-900` | `dark:text-gray-100` |
| `text-gray-700` | `dark:text-gray-300` |
| `text-gray-600` | `dark:text-gray-400` |
| `text-gray-500` | `dark:text-gray-500` (변경 없음 — 다크에서도 약한 회색 의도) |
| `text-smsg-900` | `dark:text-gray-100` (smsg 토큰 그대로 두는 게 더 좋음 — tokens.css 자동) |

### 1.3 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | 작업 방식 | 26 파일 직접 순차 — 각 파일 평균 2분, 합 ~1시간 |
| 2 | smsg-* 클래스 처리 | smsg-text, smsg-900 등 토큰 기반 className은 tokens.css가 자동 처리 — 건드리지 않음 |
| 3 | 사용자 입력 색 (Whiteboard `el.color` 등) | 변경 안 함 — UX 의도 |
| 4 | hover/focus 변형 | `hover:bg-gray-50` 같은 hover는 *그대로 둠* — 다크에서도 lighter on dark는 작동 (Tailwind hover 자동) |
| 5 | snapshot 갱신 | AllBlocksRender, BlockBoundary 등 영향 받는 모든 snapshot `-u` |
| 6 | 테스트 신설 | 1 통합 케이스 — "어떤 블록도 dark: variant 없는 bg-white가 안 남는다" 정규식 검증 |
| 7 | matchRate 기준 | 90% |
| 8 | lat 갱신 | `docs/lat/documents.md` 에 darkmode 표준 1 문단 추가 |

### 1.4 Acceptance Criteria

1. **C1**: 26 블록 모두 `bg-white` 사용처에 `dark:bg-gray-900` 동반
2. **C2**: 동일 — `border-gray-200` → `dark:border-gray-700` 동반
3. **C3**: 동일 — `text-gray-900` → `dark:text-gray-100` 동반
4. **C4**: 사용자 입력 색 (Whiteboard) 미변경
5. **C5**: 회귀 0 — vitest/typecheck/pytest 모두 통과
6. **C6**: 회귀 테스트 1 (정규식 grep)
7. **C7**: AllBlocksRender snapshot 갱신
8. **C8**: lat 갱신
9. **C9**: 사이클 보고서 + archive

---

## 2. Estimate

| 작업 | 시간 |
|---|---|
| 26 파일 × ~2분 sed/edit | ~50분 |
| snapshot 갱신 | 5분 |
| 통합 회귀 테스트 1 신설 | 10분 |
| typecheck + vitest + pytest | 10분 |
| lat 1 문단 | 5분 |
| commit + push | 5분 |
| **합계** | **~1.5시간** |

---

## 3. Risks

| 위험 | 대응 |
|---|---|
| className 변경량 많음 — snapshot 다수 갱신 필요 | `-u` 한 번에 갱신, 시각적 회귀는 다크 토글로 manual 확인 |
| 일부 블록의 `bg-white`는 *의도적* (예: 이미지 위 캡션 박스) | 각 위반마다 컨텍스트 확인 후 *유지 결정 시 dark: 변형 안 추가* + lat 명시 |
| hover/focus state가 다크에서 부자연 | hover는 변경 안 함 — Tailwind default가 lighter on dark 자동 |
| 통합 회귀 정규식이 false positive (예: 주석 안 `bg-white`) | 코드만 검사 — `// dark:` 같은 escape 패턴 제외 |

---

## 4. 작업 순서

26 파일을 빠르게 순차 처리. 각 파일:
1. `bg-white` → `bg-white dark:bg-gray-900`
2. `border-gray-200` → `border-gray-200 dark:border-gray-700`
3. (필요 시) `border-gray-300` → `border-gray-300 dark:border-gray-600`
4. `text-gray-900` → `text-gray-900 dark:text-gray-100` (smsg-900은 건드리지 X)
5. `text-gray-700` → `text-gray-700 dark:text-gray-300`
6. `text-gray-600` → `text-gray-600 dark:text-gray-400`
7. `bg-gray-50` → `bg-gray-50 dark:bg-gray-800`

그 후:
- snapshot 갱신 (`pnpm vitest run -u`)
- 통합 회귀 테스트 1 신설
- typecheck + vitest + pytest
- lat 1 문단
- 단일 커밋 + push

---

## 5. 의도 예외 후보 (작업 중 발견 시 결정)

| 가능성 | 처리 |
|---|---|
| 이미지 위 흰 캡션 박스 (ImageAnnotation 같은 패턴) | 의도적 유지 + lat 명시 |
| 인쇄용 (`print:`) 클래스 | 그대로 |
| 사용자 자체 입력 색 | 그대로 |

---

## 6. Open Questions

| # | 질문 | 결정 |
|---|---|---|
| Q1 | sed로 한 번에 vs 파일별 직접 검토? | **파일별 직접** — sed는 의도 예외를 못 봄 |
| Q2 | smsg-900 → dark:text-gray-100 추가? | **No** — smsg-* 는 tokens.css가 처리 |
| Q3 | hover variant도 dark 추가? | **No** — Tailwind hover가 light/dark 양쪽 자동 작동 |
