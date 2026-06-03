# pivot-sprint6-data-source — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | G1 — Pivot Table Sprint 6: DataSourceBlock 참조 |
| **Completion** | 2026-06-03 |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Sprint 5 까지 Pivot 의 source 가 inline/csv 만 — 실시간 데이터를 가지려면 raw rows 를 매번 paste 해야 했고 같은 문서에 이미 mount 된 DataSourceBlock 의 결과를 *재사용* 불가 |
| Solution | source schema 를 oneOf 로 확장 — 기존 `{kind:"inline"\|"csv", rows[]}` *또는* 신규 `{kind:"data-source", dataSourceId}`. viewer 가 같은 문서 안 DataSourceBlock 을 찾아 useQuery 로 hydration (동일 query key 로 캐시 공유) 후 synthetic clone 만들어 buildPivot 호출 — engine 변경 0 |
| Function/UX | 사용자가 DataSourceBlock 한 번 mount 해두면 Pivot 이 같은 데이터를 cross-tab 으로 즉시 표현. loading/error 상태 표시 + dataSourceId 가 draft 에 없을 때 명확한 에러 메시지 |
| Core Value | Pivot 이 라이브 데이터 위에 cross-tab + 시간 그룹 + calculated items 모두 동작. 실시간 보고서 자동 갱신 가능 |

## 변경

### 1) Schema — `packages/shared/schemas/document.json`

- `PivotTableBlock.source` 를 oneOf 두 분기로 확장
- 기존 inline/csv 형식 그대로 + 신규 `{kind:"data-source", dataSourceId: ULID}`
- codegen TS + Python 갱신

### 2) Engine — `apps/web/src/components/blocks/pivotEngine.ts`

- `sourceRows(source)` helper export — union narrowing. inline/csv 의 rows 또는 `[]`
- `RawRow` 타입 정의를 `ReturnType<typeof sourceRows>[number]` 로 narrowing
- buildPivot + drillRows 의 `block.source?.rows ?? []` 호출들 → `sourceRows(...)`

### 3) Viewer — `apps/web/src/components/blocks/PivotTableBlock.tsx`

- `useHydratedPivotBlock(block)` hook — kind 분기:
  - inline/csv → `{status:'inline', block}`
  - data-source + dataSourceId 가 draft 에 없음 → `{status:'error', error}`
  - data-source + 정상 → useQuery 로 fetch + payloadToRows 적용 후 synthetic inline clone
- 같은 query key (`['data-source', endpoint, JSON.stringify(params)]`) 라
  DataSourceBlockView 와 캐시 공유 (TanStack 자동 dedupe)
- `payloadToRows(payload)` pure export — 두 shape 지원:
  - `{rows: [{...}]}` (이미 flat object 배열)
  - `{headers, rows: [[...]]}` (tabular — headers 와 zip)
- 상태별 banner (`data-pivot-source-state="loading"|"error"`)
- `Block` / `DataSourceBlock as DataSourceBlockType` import 로 narrowing
- `buildDrillTitle` 의 dim 표시도 dimLabel 호환

### 4) Editor — `apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx`

- `SourceKindPicker` 신규 컴포넌트 — inline/csv/data-source 라디오 + draft
  에서 모든 DataSourceBlock 자동 수집 후 select 노출 (`id` 8자 + endpoint 표시)
- paste section 은 `kind !== 'data-source'` 일 때만 노출
- 헤더 의 row count 옆 `(live)` 인디케이터
- detectFields / parseCsv 시그니처가 `ReturnType<typeof sourceRows>` 사용

### 5) DataSourceBlock fetcher export — `apps/web/src/components/blocks/DataSourceBlock.tsx`

- `fetchDataSource` 비공개 → `export async function`. Pivot viewer 가 같은
  queryFn 사용해 cache key 공유

### 6) Test 인프라

- `PivotTableBlock.test.tsx` + `PivotTableBlockEditor.test.tsx` 의 SSR helper
  에 `QueryClientProvider` wrap 추가 (`harness()` + `ssr()`). 사유 — viewer 가
  hydration hook 으로 useQuery 호출 → SSR 시 QueryClient 없으면 throw
- `renderToStaticMarkup(...)` 호출 모두 `ssr(...)` 로 일괄 교체 (sed)

### 7) Tests +5 신규

- `payloadToRows`: 빈/non-object → `[]`
- `payloadToRows`: 이미 flat object 배열 → 그대로 통과
- `payloadToRows`: tabular {headers, rows:[[…]]} → zip 으로 변환
- `payloadToRows`: cell 객체 → String 강제 변환
- viewer: data-source kind + dataSourceId 미존재 → error banner + 명확한 메시지

### 8) Lat — `docs/lat/documents.md`

PivotTableBlock 항목에 Sprint 6 명세 추가: source union 확장, Sprint 6 helper
(sourceRows + payloadToRows), editor 의 SourceKindPicker.

## 검증

- typecheck clean
- vitest **2426 / 2426** (+5 신규). 회귀 0
- codegen 16/16 valid

## 작업 방식

- engine 은 pure 유지 — viewer 에서 hydration 후 synthetic clone 만들어 호출
- 캐시 공유는 query key 일치만으로 자동 처리 (TanStack 의존)
- 두 shape (`{rows}` vs `{headers, rows}`) 모두 받는 payloadToRows pure helper
  로 시그니처 안정화

## Defer / 후속

- Pivot 외 다른 widget (chart/table/kpi-cards) 도 같은 data-source 참조 패턴
  적용 — 이번 사이클은 Pivot 한정. 동일 helper 재사용 가능
- Slicer (G2) — cross-widget filter coordinator 가 같은 hydration pattern 위
  에서 동작
