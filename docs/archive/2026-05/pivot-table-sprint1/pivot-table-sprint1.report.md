# pivot-table-sprint1 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Pivot Table 위젯 Sprint 1 (Excel pivot table 동등 — XL 사이클의 1/4) |
| **Completion** | 2026-05-29 |
| **Status** | Sprint 1 / 4 완료 (M ~1일, 실제 — schema phase workflow + 나머지 phase 직접 rate limit 회피) |
| **Match Rate** | 100% (acceptance C1~C7 모두 충족) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | raw rows 를 row×col cross-tab 으로 보려면 SpreadsheetBlock SUMIFS 수동 작성 또는 TableBlock 손작업. Excel drag-drop pivot 동등 부재. |
| Solution | 신규 36번째 블록 `pivot-table`. inline JSON 또는 CSV paste → field auto-detect → rows/cols/values 축 picker → 즉시 cross-tab. 8 aggregator (cycle 1 통계 함수 재사용 — sum/count/avg/min/max/median/stdev/var). WidgetExportMenu (cycle 3) 의 CSV export 통합. |
| Function/UX | "월별 매출 데이터 100행 CSV → 부서×년도 cross-tab + sum/avg" 가 paste + dropdown 으로. Excel 사용자 즉시 인지. |
| Core Value | Excel pivot 대체 — 화이트페이퍼 안에서 raw → 집계 표 + (cycle 2 sparkline + cycle 3 conditional formatting) 시너지로 데이터 분석 백서 완성 |

## 구현 위치

| 영역 | 파일 |
|---|---|
| Schema | `packages/shared/schemas/document.json` (PivotTableBlock + Block union 36th) |
| Codegen | `apps/web/src/types/document.ts` + `apps/api/app/schemas/document.py` |
| Engine | `apps/web/src/components/blocks/pivotEngine.ts` (219줄, pure helper) |
| Viewer | `apps/web/src/components/blocks/PivotTableBlock.tsx` (cross-tab render + CSV export 통합) |
| Editor | `apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx` (source paste + DimPicker + ValuesPicker + Preview) |
| Dispatcher | `apps/web/src/components/blocks/BlockRenderer.tsx` (case 'pivot-table') |
| Palette | `apps/web/src/features/editor/components/BlockInsertPalette.tsx` (🔀 피벗 표 item) |

## 테스트

- `pivotEngine.test.ts` — 12 케이스 (cross-tab + 8 aggregator + edge case)
- `PivotTableBlock.test.tsx` — 6 케이스 (SSR + emptyCell + 다중 measure + export)
- `PivotTableBlockEditor.test.tsx` — 7 케이스 (SSR + detectFields + parseCsv + preview)
- 신규 25 vitest. web 2218 → 2243 (+25). 회귀 0.
- typecheck clean. api 1106/1106 (codegen 만 영향).

## 후속 Sprint (백로그)

- **Sprint 2** (M ~1일): subtotal + grand total + 다중 measure 지원 확장 + sort/filter
- **Sprint 3** (S ~반나절): % of total / 누적 / numberFormat
- **Sprint 4** (S ~반나절): calculated field (formulaEngine 통합)
- **Sprint 5+** deferred: drill down / slicer / calculated item / 시간 그룹 / DataSource 참조

## 작업 방식 회고

- Workflow rate limit 으로 7 phase 중 schema 만 cached 통과
- 나머지 6 phase (Engine + UI + Verify + Commit) 는 직접 작업으로 단축 — rate limit 회피
- 결과: ~1.5h, plan 명세대로 모두 산출. 외부 lib 0 dep, cycle 1/3 helper 재사용

## 다음 단계

1. plan 파일 `docs/01-plan/features/pivot-table.plan.md` 유지 (Sprint 2-4 활성)
2. 사용자 결정 시 Sprint 2 진행 (subtotal + sort/filter)
3. 누적 archive: 46 → 47
