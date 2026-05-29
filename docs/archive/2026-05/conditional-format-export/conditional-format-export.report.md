# conditional-format-export — Completion Report

## Executive Summary

| Perspective | Content |
|---|---|
| **Feature** | TableBlock 조건부 서식 + 위젯 export 매트릭스 2건 |
| **Completion** | 2026-05-29 |
| **Match Rate** | **100%** |
| **Tests** | +12 이상 신규 vitest (operator 11 + 매트릭스 분기), 회귀 0 |
| **Regression** | 0건 |

### Value Delivered

| Perspective | Outcome |
|---|---|
| **Problem** | 1) TableBlock 에 Excel 수준 조건부 서식 없음 → 강조가 필요한 데이터 표가 모두 *수동 색칠*. 2) 위젯별 export 가능 형식이 코드 산재라 사용자가 "어떤 위젯이 어떻게 export 되나" 모름. |
| **Solution** | 1) pure helper `evaluateConditionalFormatting()` + 11 operator (gt/lt/eq/between/topN/bottomN/contains/blank/duplicates/regex/formula) + schema add-only. 2) `lib/widgetExport.ts` 단일 매트릭스 + `WidgetExportMenu` 공통 컴포넌트. |
| **Function/UX Effect** | 표 셀에 규칙 기반 색/굵게 자동 적용. 위젯 우상단 `…` 메뉴에서 PNG/SVG/CSV/JSON 등 형식 선택 (위젯 종류에 맞는 옵션만 노출). |
| **Core Value** | 조건부 서식 = *데이터 강조 자동화*. 위젯 export 매트릭스 = *위젯 → 외부 도구* 단방향 마찰 해소. |

## 세부 변경

### WIDGET-02 — TableBlock conditionalFormatting
- `apps/web/src/lib/conditionalFormatting.ts` 신설 — pure helper
- `evaluateConditionalFormatting(row, col, value, rules)` → `{ bg?, color?, bold?, italic?, underline? }`
- 11 operator: `gt` / `lt` / `eq` / `ne` / `between` / `topN` / `bottomN` / `contains` / `blank` / `duplicates` / `regex` / `formula`
- schema add-only — `rules?: ConditionalRule[]` (기존 데이터 무영향)
- TableBlock 렌더 분기 — 규칙 평가 결과를 cell style 에 머지
- 12+ 신규 vitest (operator 단위 + 머지 우선순위)

### WIDGET-08 — 위젯 export 매트릭스
- `apps/web/src/lib/widgetExport.ts` 신설 — 단일 진실 매트릭스
  - `widgetExportFormats: Record<BlockType, ExportFormat[]>`
  - `exportWidget(block, format)` 디스패치
- `apps/web/src/components/WidgetExportMenu.tsx` — `…` 메뉴 공통 컴포넌트
  - 위젯 종류에 맞는 옵션만 동적 노출
  - SVG/PNG: html2canvas 또는 native SVG serialize
  - CSV/TSV: spreadsheet/table 만
  - JSON: 모든 위젯 (디버그용)
- `docs/lat/widget-export.md` 신설 — 매트릭스 정식 문서

## 구현 위치

- `apps/web/src/lib/conditionalFormatting.ts` (신설)
- `apps/web/src/lib/widgetExport.ts` (신설)
- `apps/web/src/components/WidgetExportMenu.tsx` (신설)
- `apps/web/src/components/blocks/TableBlock.tsx` (분기 추가)
- `packages/schema/src/blocks/table.ts` (`rules?: ConditionalRule[]`)
- `docs/lat/widget-export.md` (신설)

## 테스트

| 단계 | 결과 |
|---|---|
| typecheck | clean |
| web vitest | +12 이상 신규, 회귀 0 |

## 후속

- 조건부 서식 editor UI — 현재는 raw JSON 편집, toolbar dropdown 후속
- 위젯 export PDF — 단일 위젯 PDF (전체 문서 export 와 별개) 사용자 요청 시 추가
- `widget-export.md` 매트릭스가 추후 위젯 추가 시 drift 가드 — 신규 위젯 PR 에 필수 항목으로 lint
