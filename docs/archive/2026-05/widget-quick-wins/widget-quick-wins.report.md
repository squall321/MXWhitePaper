# widget-quick-wins — Completion Report

## Executive Summary

| Perspective | Content |
|---|---|
| **Feature** | 위젯 Quick Wins 4건 (freeze panes / sparkline KPI / docs drift / boxplot) |
| **Completion** | 2026-05-29 |
| **Match Rate** | **100%** |
| **Tests** | +19 신규 vitest (5 + 7 + 7), 전체 회귀 0 |
| **Regression** | 0건 |

### Value Delivered

| Perspective | Outcome |
|---|---|
| **Problem** | 위젯 백로그 small wins 4건이 각자 ≤1h 라 단일 사이클이 비효율. 한 번에 묶어 처리. |
| **Solution** | 4 영역 병렬 — SpreadsheetBlock CSS-only freeze, KpiCard 스파크라인, llm-widgets 문서 drift 정정, ChartBlock boxplot enum 추가. |
| **Function/UX Effect** | freeze: 큰 표 스크롤 시 헤더 고정. KPI: 카드 안 트렌드 미니차트. boxplot: 분포 비교 차트 추가. 문서: LLM 가 잘못된 표 만드는 혼선 제거. |
| **Core Value** | 위젯 라이브러리의 "실용성 갭" 4건 동시 해소 — 누적되면 사용자가 *외부 도구 의존* 으로 빠지는 마찰. |

## 세부 변경

### WIDGET-04 — Spreadsheet freeze panes
- SpreadsheetBlock CSS-only (`position: sticky` + z-index 계층)
- schema 무변경 — `freezeRows` / `freezeCols` 기존 필드 활용
- 5 신규 vitest

### WIDGET-09 — KpiCard sparkline
- schema 에 optional `sparkline?: { kind: 'line'|'bar'|'area', values: number[] }` 추가
- Sparkline 컴포넌트 신설 (SVG, ≤60 LOC)
- KpiCard 렌더에 분기 — 미지정 시 종전 그대로
- 7 신규 vitest

### USR-11 — docs drift 정정
- `docs/llm-widgets-via-api.md` — TableBlock "혼합 셀 표" 미지원 표기 *제거*
- 실제로는 web-cell-edit 사이클 (2026-05-15) 에서 paragraph/list/image 풀 셀 편집 지원됨
- 코드 변경 0, docs only

### CHART-05 — Boxplot
- ChartBlock chartType enum 에 `'boxplot'` 추가
- EChartsView `buildOption` 에 boxplot 분기 (ECharts `dataset` + `series: boxplot`)
- schema/repr/render/test 4단계
- 7 신규 vitest

## 구현 위치

- `apps/web/src/components/blocks/SpreadsheetBlock.tsx` — freeze CSS
- `apps/web/src/components/blocks/KpiCard.tsx` + `apps/web/src/components/Sparkline.tsx` 신설
- `apps/web/src/components/blocks/ChartBlock.tsx` + `apps/web/src/components/EChartsView.ts`
- `packages/schema/src/blocks/kpi-card.ts` + `packages/schema/src/blocks/chart.ts`
- `docs/llm-widgets-via-api.md`

## 테스트

| 단계 | 결과 |
|---|---|
| typecheck | clean |
| web vitest | +19 신규, 회귀 0 |

## 후속

- KpiCard sparkline 의 다중 시리즈 (비교용) — 사용자 요청 시 추가
- boxplot outlier marker 색 토큰화 (다크 대응) — chart-recharts-palette 패턴 재사용
- freeze panes 의 sticky 동작 시각 회귀는 visual-regression baseline 갱신 후속 사이클
