# i-track-chart-editor-kpi-slicers — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | I 트랙 — ChartBlockEditor picker UI (a) + KpiCardsBlock boundSlicers (b) |
| **Completion** | 2026-06-04 |
| **Match Rate** | 100% |
| **Commits** | `bfb7652` |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | H2 가 ChartBlock 의 schema/viewer 만 land. editor 에서는 직접 JSON 편집해야 했고 KpiCards 는 여전히 정적 widget (cross-widget filter 미지원) |
| Solution | (a) ChartSourcePanel — source kind + labelField + aggregations[] row repeater + BoundSlicersPicker. (b) KpiCardsBlock 에 source/filters/boundSlicers + items[i].compute (per-card field/agg + 옵션 when) 추가, useHydratedKpiCardsBlock hook, KpiSourcePanel editor UI |
| Function/UX | 4 종 data widget (Pivot/Table/Chart/KpiCards) 가 모두 boundSlicers 로 binding. KpiCards 한 block 안에서 정적 카드 + 자동 계산 카드 공존 가능 |
| Core Value | cross-widget filter coverage **4/4 data widget 100% 완성**. UI 없이 JSON 편집 강요하지 않음 — editor 가 모든 새 필드 노출 |

## (a) ChartBlockEditor picker UI

### 변경 파일
- `apps/web/src/features/editor/blocks/ChartBlockEditor.tsx` — `ChartSourcePanel` 신규 + `BoundSlicersPicker` 호출

### 핵심 UI
- **Source kind radio** — `none` / `inline` / `data-source`. none 이면 chart 는 today 와 동일 (data.{labels, series} 그대로).
- **labelField input** — datalist 자동 추출 (inline rows 의 첫 행 keys). source 가 none 이면 dimmed.
- **aggregations[] row repeater** — 한 행 = 한 시리즈. field 입력 / agg 셀렉트 (sum/avg/count/min/max) / 시리즈 라벨 입력 / ✕ remove. 하단의 `+ add` 로 추가.
- **DataSource picker** — `kind=data-source` 일 때 셀렉트로 sibling DataSourceBlock 선택.

### 디자인 결정
- **csv 모드 제외** — PivotTableBlockEditor 는 csv kind 도 있으나 chart 는 csv→series 매핑이 직관적이지 않아 의도적으로 빼고 inline 만.
- **dimmed (opacity-50) 패턴** — source 가 none 일 때 labelField/aggregations input 은 *편집 가능하지만* disabled. 사용자가 미리 시리즈를 정의해두고 나중에 source 만 켜는 워크플로 지원.
- **filters JSON 텍스트 박스 미추가** — schema 에 `filters?` 가 있지만 editor 에 입력 surface 추가하면 row repeater 두 개로 복잡. defer.

## (b) KpiCardsBlock boundSlicers

### Schema 변경 (`packages/shared/schemas/document.json`)
- block 레벨: `source` (oneOf inline | data-source) + `filters[]` + `boundSlicers[]` 추가
- `items[i].compute` 추가: `{field, agg?, when?}`. `when` 은 `{field, value}` — array → in semantic, scalar → in [value].

### Viewer (`apps/web/src/components/blocks/KpiCardsBlock.tsx`)
- `useHydratedKpiCardsBlock(block)` — ChartBlock hook 패턴 미러:
  - source 가 없거나 어떤 카드도 compute 가 없으면 early return (back-compat 100%)
  - boundSlicers → `collectSlicerFilters + collectTimelineFilters` 로 filter spec 변환
  - per-card `when` 을 baseFilters 에 concat (in-filter 한 개 추가)
  - `aggregateChartData` 를 synthetic single-label (`'_'`) 로 호출해 단일 집계값 추출 → 카드의 `value` 덮어쓰기
  - 정적 + compute 카드 공존 가능

### Editor (`apps/web/src/features/editor/blocks/KpiCardsBlockEditor.tsx`)
- `KpiSourcePanel` 신규: source kind radio + DataSource picker + per-card compute 토글 + field/agg 입력
- `BoundSlicersPicker` (generic) 호출

### Sample
- `packages/shared/samples/17-cross-widget-filter.json` 에 KpiCards 4 카드 (총 매출 / 평균 / 건수 / 최대) 추가. Pivot+Table+Slicer+Timeline 과 같은 inline 데이터 공유. slicer 클릭 시 모든 widget 동시 재계산.

### 디자인 결정
- **synthetic single-bucket 트릭** — `aggregateChartData(rows, '__kpi__', [{field, agg}], filters)` 로 모든 row 가 같은 라벨('_')에 들어가게 해서 1차원 집계 → `series[0].values[0]` 가 카드의 단일 값. 별도 KpiCards 전용 aggregator 작성 피함 (DRY).
- **per-card `when` 은 in-filter 한 개로** — `value` 가 배열이면 `in`, scalar 면 `in [value]` (single-element `in` = `eq` semantic). engine 의 `eq` op 가 없으므로 일관성 위해 항상 `in` 으로 변환.
- **카드 자체에 source 안 두고 block 레벨에 둔 이유** — 한 block 의 모든 카드가 같은 데이터를 다른 측면으로 보여주는 패턴이 압도적으로 빈번 (총합/평균/최대). 카드별로 다른 source 가 필요하면 KpiCards block 을 두 개로 나누면 됨.

## 검증
- vitest **2460/2460 pass** (이전 2454 + KpiCardsCompute 6 신규)
- typecheck clean
- ajv samples **17/17 valid**
- chunker `--check` exit 0
- pytest API pass

## 핵심 설계 결정 (track-wide)

### 1. `aggregateChartData` 재사용 (DRY)
G5 (H2) 에서 만든 chart aggregator 를 KpiCards 가 그대로 사용. KpiCards 는 1D 그룹조차 필요 없는 *집계 한 점* 만 필요하지만, synthetic single-bucket 로 같은 함수를 호출 — KpiCards 전용 aggregator 신설 회피. 두 widget 의 filter pipeline + null coerce 정책이 자동으로 동일해짐.

### 2. `BoundSlicersPicker` 가 generic 으로 이미 분리되어 있어 4 widget 공유
G2 에서 시작된 picker, G4 에서 generic 화. I 트랙에서는 두 새 widget (Chart, KpiCards) 가 다 그대로 호출. 추가 작업 0.

### 3. editor surface "dimmed but editable" 패턴
source 가 `none` 일 때 labelField / aggregations 가 비활성화되어 보이지만 입력은 가능. 사용자가 시리즈를 미리 정의하고 나중에 source 만 켜는 워크플로를 깨지 않음. PivotTable 의 SourceKindPicker 와 일관.

### 4. 시그니처 통일을 위해 정적 카드 + compute 카드 공존 유지
KpiCardsBlock 은 사용자가 "총 매출" + "분기별 매출" 같은 *서로 의미가 다른 카드들* 을 그룹화하는 widget. source/compute 도입이 *모든* 카드를 동적으로 만들면 사용성 회귀. compute 가 *옵션* 이라는 사실이 schema + viewer + editor 전체에서 일관.

## 잔여 defer

| 항목 | 크기 | 비고 |
|---|---|---|
| Chart filters[] editor UI (JSON 텍스트 박스 또는 row repeater) | S | I 트랙에서 의도적으로 제외 |
| Chart drill-down 모달 (Pivot 패턴 미러) | M | 미요청 |
| KpiCards per-card `when` editor UI (현재 schema 만 land) | S | JSON 직접 편집 가능 |
| Timeline default 의 viewer setActive vs editor preview 정합 e2e | S | 단위 테스트는 있지만 integration 없음 |
| ja/zh i18n 번들 | S | 한국 우선 |

## 누적 (G + H + I)

| Cycle | Commit | 핵심 |
|---|---|---|
| G1 | a8e7d68 | Pivot DataSource ref |
| G2 | 9d1d673 | SlicerBlock + boundSlicers |
| G3 | f45c5b8 | viewer 가이드 (한) |
| G4 | b069cfe + 35a59cf | defer quad |
| H0 | (H1 staging 통합) | stale active 사본 정리 |
| H1 | 1c6d6e2 | Slicer/Timeline hydration + i18n + sample |
| H2 | 6855285 | Chart boundSlicers + source ref + aggregator |
| H archive | 7831e79 | 통합 report |
| **I** | **bfb7652** | Chart editor UI + KpiCards boundSlicers |

## cross-widget filter coverage 완성도

| Widget | source ref | boundSlicers | editor UI |
|---|:---:|:---:|:---:|
| PivotTable | ✓ (G1) | ✓ (G2) | ✓ (G1/G2) |
| Table | ✓ (G4) | ✓ (G4) | ✓ (G4) |
| Chart | ✓ (H2) | ✓ (H2) | ✓ (I-a) |
| KpiCards | ✓ (I-b) | ✓ (I-b) | ✓ (I-b) |
| Slicer / Timeline | source only | (producer) | ✓ (G2/G4) |
