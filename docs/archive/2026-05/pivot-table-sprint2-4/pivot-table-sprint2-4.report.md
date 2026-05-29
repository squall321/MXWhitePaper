# pivot-table-sprint2-4 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Pivot Table 위젯 Sprint 2 + 3 + 4 통합 (XL plan 의 3/4) |
| **Completion** | 2026-05-29 |
| **Status** | Sprint 2-4 동시 완료 — plan 100% (Sprint 5+ deferred 백로그) |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Sprint 1 의 기본 cross-tab 만으로는 실무 Excel pivot 대체 부족 — subtotal/sort/filter/%/계산식 모두 필요 |
| Solution | Sprint 2 (subtotal+grand total+sort+filter) + Sprint 3 (showAs % of total/running + numberFormat) + Sprint 4 (calculated field — formulaEngine 산술 식 평가) 합쳐 진행 |
| Function/UX | "월별 매출 + 작년 동월 대비 %" 단일 위젯에서 calc field + pct_row 로 즉시. 거대 표는 filter top_n 으로 자르고 sort by measure desc 로 순위 |
| Core Value | Excel pivot table 완전 대체 — 화이트페이퍼 안 데이터 분석 흐름 (raw → 집계 → 비율/누적 → 사용자 식 → 정렬/필터 → export) 한 위젯 + cycle 3 widgetExport 시너지로 종결 |

## 세부 변경

### Sprint 2 — subtotal + sort + filter
- schema: totals(grand/row/col) + sort(axis/by/order) + filters[{field,op,value}]
- engine: filter 먼저 적용 → group → aggregate → sort → totals
- totals.row/col/grand 는 **raw rows 재집계** (avg(avg) 의 부정확 회피)
- filter ops: in / not_in / gt / lt / top_n / bottom_n
- sort axis row/col + by (dimension or measure label) + order asc/desc
- editor: totals 3 checkbox + sort axis/by/order picker + filter add/remove
- viewer: row total td, col total tr, grand total 교차 셀 (amber highlight)

### Sprint 3 — % of total + numberFormat
- measure.showAs ∈ {value, pct_row, pct_col, pct_total, running}
- pct_row = 셀 / row total, pct_col = 셀 / col total, pct_total = 셀 / grand total, running = row 안 col 순서 누적
- measure.numberFormat: '#,##0.00' / '0.0%' / '#,##0' 등 toLocaleString 옵션 매핑
- viewer formatNumber 가 measure context 받아 적용

### Sprint 4 — calculated field
- measure.expr (field 대신, 산술 식) — engine 의 parseExpr + evalExprForRow
- 지원 연산: + - * / 와 괄호. row 의 fields 가 ref context
- aggregate 가 expr 값 평가 후 numeric pool 에 모음 → 기존 agg 적용
- editor ValuesPicker mode toggle (field vs expr) + textarea
- 잘못된 expr / missing field → graceful (그 row skip)

## 구현 위치

| 영역 | 파일 |
|---|---|
| Schema | `packages/shared/schemas/document.json` (totals/sort/filters + showAs/numberFormat + expr) |
| Codegen | `apps/web/src/types/document.ts` + `apps/api/app/schemas/document.py` |
| Engine | `apps/web/src/components/blocks/pivotEngine.ts` (219 → 687 LOC; filter/sort/totals/showAs/expr 추가) |
| Viewer | `apps/web/src/components/blocks/PivotTableBlock.tsx` (cross-tab + totals 렌더 + numberFormat) |
| Editor | `apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx` (totals/sort/filter UI + values mode toggle) |

## 테스트

- pivotEngine.test.ts — Sprint 1 12 + Sprint 2-4 추가 → 누적 큰 폭 확장
- PivotTableBlock.test.tsx — Sprint 1 6 + Sprint 2-4 추가
- PivotTableBlockEditor.test.tsx — Sprint 1 7 + Sprint 2-4 추가
- 신규 누적 53 vitest (Sprint 1 25 → 78 누적). web 2243 → **2296**.
- typecheck clean. api 1106 무변경.

## 작업 방식 회고

- Workflow 가 백그라운드에서 Sprint 2 + 3 + 4 모두 완성 (사용자 알림 도착 시 이미 디스크에 변경 적용됨)
- 합산: Sprint 1 (1.5h) + Sprint 2-4 (~2h) = ~3.5h 실측 (plan XL ~3일+ 대비 ~10% 시간)
- 외부 lib 0 — cycle 1 formulaEngine, cycle 3 widgetExport, cycle 2 scroll-fade 모두 재사용

## 후속 (Sprint 5+ deferred)

- Drill down (셀 클릭 → 원본 raw rows 모달)
- Slicer / Timeline (cross-widget visual filter)
- Calculated item (행/열 안 가상 항목)
- 시간 자동 그룹 (year/quarter/month auto-bucket)
- DataSourceBlock 참조 (실시간 데이터)

## 다음 단계

1. plan `docs/01-plan/features/pivot-table.plan.md` archive 로 이동 (Sprint 1-4 모두 완료)
2. 누적 archive: 47 → 48
3. 다음 트랙 — Phase 3 (SSO/Grafana) 또는 새 사용자 요구
