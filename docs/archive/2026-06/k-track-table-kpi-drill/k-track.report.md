# k-track-table-kpi-drill — Completion Report

## Executive Summary
| | |
| --- | --- |
| **Feature** | K 트랙 — TableBlock source + drill (K-1) + KpiCardsBlock drill (K-2) |
| **Completion** | 2026-06-05 |
| **Match Rate** | 100% |
| **Commits** | `58f723c` |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | J 까지 Chart drill 만 land. Table/KpiCards 도 cross-widget filter 를 지원하지만 *읽기 → 원본 trace* 가 chart 만 가능 — 4 widget 일관성 균열 |
| Solution | TableBlock 에 source schema 추가 (Chart/Kpi 와 동일 oneOf shape) + drill modal. KpiCards 의 compute card 클릭 → KpiDrillModal 로 contributing rows |
| Function/UX | 4 widget 모두 *집계값 → 원본 evidence* 추적. Table 은 *숨겨진 컬럼* 까지 명시적으로 표시 (amber 배지) |
| Core Value | cross-widget filter 의 *interactive 양방향* 이 4/4 data widget 에서 일관 적용. drill modal 언어 통일 |

## (K-1) TableBlock — source schema + drill modal

### Schema (`packages/shared/schemas/document.json`)
- `source` optional oneOf — `{kind: 'inline', rows}` 또는 `{kind: 'data-source', dataSourceId}`. Chart/Kpi/Pivot 와 동일.
- `filters[]` optional — `{field, op, value}` 배열. `in/not_in/gt/lt/between/top_n/bottom_n`.
- 100% back-compat — source 미지정 시 today 동작 그대로.

### Viewer (`apps/web/src/components/blocks/TableBlock.tsx`)
- `useHydratedTableBlock(block)` — `{block, drillRawByIndex}` 반환:
  - source 없거나 sparse cells 모드면 early return (`drillRawByIndex: null`)
  - source rows → cell coerce → `applyFilters([rawRows], block.filters + slicerFilters + timelineFilters)` → block.headers 의 컬럼명으로 project → `block.rows` 덮어쓴 clone
  - `drillRawByIndex` = hydrated row idx → 원본 raw row (headers 외 컬럼 포함)
- `FlatTableBody` 에 `onRowClick?: (origIndex: number) => void` 추가 + tr `onClick` wiring + `cursor: pointer` (drill 활성일 때만)
- `TableDrillModal` (export) — block.headers 컬럼 먼저, headers 에 없는 source 키는 amber 배지 (`>hidden<`) + count 표시

### Sparse mode 의 의도적 skip
sparse cells 모드 (merged cell) 는 hydration 자체를 건너뜀. boundSlicers / row-by-row 의 의미가 merge span 과 충돌하는 것과 같은 이유. G4 의 boundSlicers skip 결정과 일관.

## (K-2) KpiCardsBlock — compute card drill

### Viewer (`apps/web/src/components/blocks/KpiCardsBlock.tsx`)
- `useHydratedKpiCardsBlock` 시그니처 객체화 → `{block, drillContext}`.
- `drillContext = {rawRows, allFilters}` (compute 토글된 카드가 하나라도 있을 때만)
- 카드별 클릭 — `compute` 가 있는 카드만 `cursor: pointer + data-drill-clickable`
- 클릭 → `drillIdx` state → `applyFilters([rawRows], baseFilters + per-card when)` 으로 *그 카드만의* contributing rows 계산
- `KpiDrillModal` (export) — ChartDrillModal 패턴 미러. 헤더 `"label — 기여한 행"`, field union (first-seen).

### per-card `when` 의 정확한 의미 재확인
viewer hydration 단계에서 *value 계산* 에 이미 적용된 same filter 가 drill 단계에도 그대로 적용. 즉 카드 표면값 + drill row 들이 *수학적으로 일치*. 사용자가 "이 100 이 어떻게 나왔지" 확인 시 100% 신뢰 가능.

## 테스트
- vitest **2483/2483 pass** (이전 2470 + TableDrillModal 4 + KpiDrillModal 4 + TableHydration 5)
- typecheck clean
- pytest API pass
- chunker `--check` exit 0

## 핵심 설계 결정

### 1. TableBlock 에 source 추가 vs 단순 modal
사용자가 두 option 중 *schema 추가* 선택. impl 양은 더 많지만 **4/4 widget 의 source ref 패턴이 통일**. 미래에 새 widget 추가 시 schema 패턴 그대로 재사용 가능.

### 2. block.headers 가 *컬럼 projection*, source 의 모든 키가 *raw evidence*
hydration 은 headers 가 정의한 column 만 표시 — 사용자 의도된 view. drill 은 source row 의 *모든 키* (headers 에 없는 컬럼도) 표시 — *원본 evidence*. headers 외 키는 amber 배지로 명시적 강조 → "이건 표에 없던 컬럼" 즉시 인지.

### 3. drill modal 언어 통일 (Pivot/Chart/KpiCards/Table)
| widget | header | empty | row 카운트 |
|---|---|---|---|
| PivotDrillModal | "rowKey × colKey" | "해당 셀에 속한 raw row 가 없습니다." | "{N} rows" |
| ChartDrillModal | "title — labelField: label" | "해당 라벨에 속한 raw row 가 없습니다." | "{N} rows" |
| KpiDrillModal | "label — 기여한 행" | "이 카드에 기여한 row 가 없습니다." | "{N} rows" |
| TableDrillModal | "caption — 행 상세" | (single row, no empty case) | "{N} 개의 숨겨진 컬럼 포함" |

Table 만 단일 row 의 모든 column 표시 (다른 widget 은 다중 row 집계의 trace) — 의미 컨텍스트 차이를 그대로 반영.

### 4. drillContext 재활용 (재계산 회피)
viewer hook 안에서 *이미 계산된* rawRows + filter list 를 객체로 함께 반환. drill modal 은 그 객체를 받아 단일 라벨 / 단일 row 매칭만 추가 수행 — fetch / filter 재실행 없음. Chart 와 동일 패턴.

### 5. TableDrillModal 의 "hidden" 텍스트 매칭 함정
modal wrapper 의 `overflow-hidden` CSS 클래스가 `'hidden'` substring 을 포함 — test 가 false-positive. `>hidden<` 정확한 텍스트 노드로 매칭하도록 assertion 수정. 다른 widget drill modal test 에도 같은 패턴 적용 검토 필요 (defer).

## 잔여 defer

| 항목 | 크기 | 비고 |
|---|---|---|
| Sample doc 의 TableBlock 에 source 예제 추가 | S | 현재 17 번 sample 은 K 이전 |
| TableBlockEditor 에 source/filters picker UI | M | I-a 의 ChartSourcePanel 패턴 재사용 가능 |
| Chart drill: pie/radar/scatter 의 sector/arm 클릭 (activeLabel 추출 다름) | M | J defer 잔여 |
| Drill modal CSV export | S | 4 modal 일괄 |
| ja/zh i18n 번들 | S | |
| PyInstaller hidden import 수정 | M | E3 defer 잔여 |

## 누적 (G+H+I+J+K)

| Cycle | Commit | 핵심 |
|---|---|---|
| G1 | a8e7d68 | Pivot DataSource ref |
| G2 | 9d1d673 | SlicerBlock + boundSlicers |
| G3 | f45c5b8 | viewer 가이드 (한) |
| G4 | b069cfe + 35a59cf | defer quad |
| H0+H1 | 1c6d6e2 | stale + hydration + i18n + sample |
| H2 | 6855285 | Chart boundSlicers + aggregator |
| H archive | 7831e79 | |
| I (a+b) | bfb7652 | Chart editor + KpiCards boundSlicers |
| I archive | a19ce8b | |
| J | 6722387 | Chart drill modal |
| J archive | 4b49ff6 | |
| **K** | **58f723c** | TableBlock source + Table/Kpi drill modal |

## cross-widget filter 완성도 (K 시점)

| Widget | source ref | boundSlicers | editor UI | drill modal |
|---|:---:|:---:|:---:|:---:|
| PivotTable | ✓ G1 | ✓ G2 | ✓ G1/G2 | ✓ (G1 이전) |
| Table | ✓ G4 + **K** | ✓ G4 | ✓ G4 (source UI defer) | **✓ K-1** |
| Chart | ✓ H2 | ✓ H2 | ✓ I-a | ✓ J |
| KpiCards | ✓ I-b | ✓ I-b | ✓ I-b | **✓ K-2** |

**4/4 data widget × 4/4 capability = 16/16 cell 모두 채워짐** (Table editor UI 의 source/filters picker 만 defer).
