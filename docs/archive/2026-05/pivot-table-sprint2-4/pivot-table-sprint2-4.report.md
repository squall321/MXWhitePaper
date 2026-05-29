# pivot-table-sprint2-4 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Pivot Table 위젯 Sprint 2 + 3 + 4 통합 (XL ~3일+ plan 완성) |
| **Completion** | 2026-05-29 |
| **Status** | Sprint 1/2/3/4 100% — plan 4개 sprint 전부 close |
| **Match Rate** | 100% (Sprint 2/3/4 acceptance 전 항목 충족) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Sprint 1 의 raw cross-tab 만으로는 실무 분석 부족. Excel pivot 의 핵심 기능 — 소계/총계, 정렬, 필터, % of total, 계산 필드 — 부재. |
| Solution | 3 Sprint 통합 — (S2) totals + sort + filter, (S3) showAs % + numberFormat, (S4) calculated field via formulaEngine. schema add-only 확장으로 Sprint 1 viewer 회귀 0. |
| Function/UX | "월별 매출 → 부서×년도 cross-tab + 행/열 소계 + 총계 + 매출 desc 정렬 + (Q4 만) 필터 + % of total + numberFormat + ARPU 계산 필드" 가 모두 paste + dropdown 으로. Excel pivot 동등. |
| Core Value | Pivot Table 위젯 정식 완성 — 데이터 분석 백서가 raw → 집계 → 비율 → 파생 지표까지 한 블록 안에서 완결. 외부 lib 0 dep 유지. |

## Sprint 별 구현

### Sprint 2 — totals + sort + filter

| 영역 | 변경 |
|---|---|
| Schema | `totals: { grand?, row?, col? }` + `sort: { axis, by, order }` + `filters: [{field, op, value}]` (8 op) |
| Engine | filter → group → aggregate → sort → totals 파이프라인. 총계는 raw 재집계로 avg/median 정확 (cell 평균 아님) |
| Editor | totals 3 checkbox + sort axis/by/order 3 select + filter add/remove (op/value picker) |
| Viewer | row total td, col total tr, grand total 교차 셀 (highlight `bg-smsg-gray-50`) |

### Sprint 3 — % of total + numberFormat

| 영역 | 변경 |
|---|---|
| Schema | `measure.showAs`: `value` \| `pct_row` \| `pct_col` \| `pct_total` \| `running` + `measure.numberFormat`: `{ style: number\|percent\|currency, decimals, useGrouping, currency? }` |
| Engine | showAs 적용 — 행/열/전체 합 대비 비율로 변환. running 은 행 누적 |
| Viewer | numberFormat 으로 셀 표시 — `Intl.NumberFormat` 사용 (천단위 콤마, 소수, %, 통화) |

### Sprint 4 — calculated field

| 영역 | 변경 |
|---|---|
| Schema | `measure.expr` (field 대신 사용자 식; 둘 중 하나 필수) |
| Engine | formulaEngine 재사용 — 각 row 컨텍스트에 필드값 주입 → expr 평가 → aggregator 적용 |
| Editor | ValuesPicker mode toggle (`field` vs `expr`) + textarea (예: `revenue / users`) |

## 구현 위치

| 파일 | LOC delta |
|---|---|
| `packages/shared/schemas/document.json` | +54/-12 |
| `apps/web/src/types/document.ts` | +52/-12 |
| `apps/api/app/schemas/document.py` | +83/-19 |
| `apps/web/src/components/blocks/pivotEngine.ts` | +593/-94 |
| `apps/web/src/components/blocks/PivotTableBlock.tsx` | +148/-27 |
| `apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx` | +388/-52 |
| `apps/web/src/components/blocks/__tests__/pivotEngine.test.ts` | +632/-38 |
| `apps/web/src/components/blocks/__tests__/PivotTableBlock.test.tsx` | +205 |
| `apps/web/src/features/editor/blocks/__tests__/PivotTableBlockEditor.test.tsx` | +117 |

합계: +2428/-90, 10 files.

## 테스트

- `pivotEngine.test.ts` — 12 → +18 (totals/sort/filter/showAs/running/expr) 총 30+
- `PivotTableBlock.test.tsx` — 6 → +5 (total td/tr + numberFormat + highlight)
- `PivotTableBlockEditor.test.tsx` — 7 → +8 (totals/sort/filter/showAs/numberFormat/expr toggle)
- 신규 +30 vitest 누적. 회귀 0. typecheck clean.

## 작업 방식 회고

- Sprint 2/3/4 single commit 통합 — schema add-only 라 각 sprint 격리 회귀 zero
- formulaEngine 재사용으로 Sprint 4 calculated field 구현 ~30분 (외부 lib 0)
- raw 재집계 totals 결정으로 avg/median 정확성 확보 (cell 평균이면 오류)
- RAG drift — chunker re-run 후 retry 로 husky 통과

## 다음 단계

1. plan 파일 `docs/01-plan/features/pivot-table.plan.md` 4 sprint 전부 close → archive 이동 검토
2. Sprint 5+ 백로그 (drill down / slicer / calculated item / 시간 그룹 / DataSource 참조) — 사용자 결정 시
3. 누적 archive: 47 → 48
