# widget-polish-4 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | 오늘 추가 widget 4건 polish 묶음 (사용자 명시 요청) |
| **Completion** | 2026-05-29 |
| **Status** | 4 polish 모두 완료 |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Cycle 1-4 + Pivot Sprint 1-4 까지 빠르게 추가된 위젯들의 실 사용 시나리오에서 마찰 — pivot 축 구성이 select drop 만, conditional fmt rule 작성이 raw JSON 수준, pivot 셀에서 raw 원본 못 봄, sparkline 색이 다 회색 |
| Solution | 4 polish 묶음 — pivot DnD + CF preset 5종 + pivot drill 모달 + sparkline color picker |
| UX | Excel pivot 의 가장 특징적 UX (드래그 축 구성) + "상위 10%" 한 클릭 + 셀 클릭 → raw rows + 시각 시리즈 색 일관성 |
| Core Value | "기능은 있지만 손이 많이 가는" 위젯이 "한 클릭으로 끝나는" 위젯으로 — 위젯 안정 검증 직후 사용자 명시 요청에 즉시 대응 |

## 세부 변경

### 1) Pivot DnD (PivotTableBlockEditor)
- Available Fields 패널 + 3 drop zone (Rows / Cols / Values)
- HTML5 native DnD (외부 lib 0)
- 기존 select dropdown 도 keep — accessibility / keyboard fallback
- Excel pivot 의 시그니처 UX

### 2) CF Preset (TableBlock conditional formatting)
- 5 preset 버튼: 상위 10% / 하위 10% / 평균 초과 / 0 이하 / 중복
- 각 preset 함수가 `ConditionalRule` 반환, 클릭 시 즉시 적용
- cycle 3 의 conditional fmt schema 위에 UI 보강
- 신규 컴포넌트 `ConditionalFormattingPresetsPanel.tsx` + pure helper `conditionalPresets.ts`

### 3) Pivot drill-down
- viewer 셀 클릭 시 그 (row, col) 조합의 raw rows 모달
- `pivotEngine.drillRows()` pure helper 추가
- ESC 닫기 + focus trap (cycle 3 lightbox 패턴 재사용)
- Sprint 5+ deferred 였던 항목 조기 진행

### 4) Sparkline color picker
- schema `KpiItem.sparkline.color` (string) 추가
- `Sparkline` 컴포넌트가 `color` prop 받음
- KpiCard editor 에 swatch preset + custom hex
- backwards compat — 미지정 시 default 회색

## 구현 위치

| 영역 | 파일 |
|---|---|
| Schema | `packages/shared/schemas/document.json` (+9) |
| Codegen | `apps/web/src/types/document.ts` (+8) + `apps/api/app/schemas/document.py` (+8) |
| Pivot DnD | `apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx` (+518/-152) |
| Pivot drill | `apps/web/src/components/blocks/PivotTableBlock.tsx` (+182/-12) + `pivotEngine.ts` (+42 drillRows) |
| CF Preset | `apps/web/src/components/blocks/conditionalPresets.ts` (신규) + `features/editor/blocks/ConditionalFormattingPresetsPanel.tsx` (신규) + `TableBlockEditor.tsx` (+22 wiring) |
| Sparkline color | `apps/web/src/features/home/components/Sparkline.tsx` (+21) + `KpiCardsBlock.tsx` (+2 prop) + `KpiCardsBlockEditor.tsx` (+181 swatch UI) |
| i18n | `apps/web/src/lib/i18n/{en,ko}.ts` (+3 each) |

## 테스트

- 신규 vitest 파일: `conditionalPresets.test.ts`, `ConditionalFormattingPresetsPanel.test.tsx`
- 확장: `PivotTableBlock.test.tsx` (+drill), `pivotEngine.test.ts` (+drillRows), `KpiCardsBlock.test.tsx` (+color), `KpiCardsBlockEditor.test.tsx` (+swatch), `PivotTableBlockEditor.test.tsx` (+DnD), `Sparkline.test.tsx` (+color)
- 신규 누적 vitest +20+. typecheck clean. 회귀 0.

## 작업 방식 회고

- 오늘 작업 안정 검증 (typecheck/vitest/pytest 모두 그린, drift 1 fix) 후 사용자 명시 요청
- 4 polish 모두 외부 lib 0 (DnD 는 HTML5 native, preset 은 pure function, drill 은 cycle 3 lightpattern, color 는 swatch + hex)
- 1 commit 묶음 (efb4ee0)

## 다음 단계

1. archive 누적: 48 → 49
2. main push
3. 다음 트랙 — 새 사용자 요구 또는 Phase 3 (SSO/Grafana)
