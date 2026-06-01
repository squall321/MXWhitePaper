# pivot-sprint5 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | E2 — Pivot Table Sprint 5: 시간 자동 그룹 + Calculated items |
| **Completion** | 2026-06-01 |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Pivot Sprint 1-4 의 deferred 백로그 5건 중 2건. raw row 의 date 필드를 사용자가 사전 가공해야 했음 (year/quarter 컬럼 따로 만들기). 행/열 안 가상 항목 (예: 'Q1=Jan+Feb+Mar') 불가능 — Excel pivot 의 핵심 "그룹화" 기능 부족 |
| Solution | (1) `rows`/`cols` schema 를 `(string | {field, group?})` union 으로 확장 + engine 의 `bucketDate(v, group)` 가 ISO date / epoch ms / Date 를 year/quarter/month/week(ISO)/day 라벨로 변환. (2) `calculatedItems?: [{axis, name, formula}]` schema + `applyCalculatedItems` 가 base 결과 위에 axis 별 가상 항목 합성. formula 는 백틱 식별자로 같은-축 라벨 참조 |
| Function/UX | "월별 매출" 한 줄 — 사용자가 `rows: [{field:'date', group:'month'}]` 로 즉시. 분기 묶음 — calculatedItems 한 줄로 `Q1 = `Jan` + `Feb` + `Mar``. 후속 item 이 선행 item 참조 — `H1 = `Q1` + `Q2``. 잘못된 formula / 0 분모 / unknown ref → null cell (throw 없음) |
| Core Value | Excel pivot table 의 마지막 핵심 기능 2건 (Group by Time, Calculated Items) 도달. raw row 의 사전 가공 불필요 → LLM 산출 데이터를 그대로 pivot 가능 |

## 변경

### 1) Schema — `packages/shared/schemas/document.json`

- `PivotTableBlock.rows[]` / `cols[]` items 를 `oneOf: [string, {field, group?}]` 로 확장.
  group ∈ `year`|`quarter`|`month`|`week`|`day`
- `calculatedItems?: [{axis: 'row'|'col', name, formula}]` 신설. formula 백틱 라벨 명세.
- codegen TS + Python 갱신 (pnpm -F @mx/shared gen)

### 2) Engine — `apps/web/src/components/blocks/pivotEngine.ts`

| 추가 | 설명 |
|---|---|
| `export type DimSpec` | union alias |
| `export type DateGroup` | `'year'\|'quarter'\|'month'\|'week'\|'day'` |
| `export dimField(d)` | union → field name |
| `export dimLabel(d)` | union → display label (`field_group` 합성) |
| `export bucketDate(v, group)` | ISO 8601 week 포함 5 단위 bucket |
| 내부 `dimBucket(row, spec)` | dimValue 의 group-aware wrapper |
| `applyCalculatedItems(result, items)` | axis 별 가상 항목 합성. 선행 item 참조 지원 |
| 내부 `evalCalcExpr(node, ctx)` | label→number ctx 평가, null propagation + div-by-zero=null |
| tokenizer 확장 | 백틱 식별자 `` `Q1` `` ident 토큰화. 미종료 시 throw |
| `buildPivot` 의 `rowDims`/`colDims` 타입 `DimSpec[]` 로 갱신 |
| `dimValue(...)` 호출들 `dimBucket(...)` 으로 교체 (drillRows 포함) |
| `sort.by` 매칭 `rowDims.indexOf(by)` → `findIndex(d => dimLabel(d) === by)` |

### 3) Viewer — `apps/web/src/components/blocks/PivotTableBlock.tsx`

- `detectFields` 가 `dimField` 로 narrowing
- CSV header 가 `result.rowDims.map(dimLabel)` (이전엔 `[...rowDims]` 가 string 가정)

### 4) Editor — `apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx`

- DimPicker 시그니처 `DimSpec[]`. 각 chip 옆 시간 그룹 dropdown (raw / year / quarter / month / week / day)
- 같은 field 를 다른 group 으로 중복 추가 가능 (year(date) + month(date))
- `byOptions` 가 dimLabel 로 string narrowing
- CalculatedItemsPicker 신설 — axis (row/col) + name + formula + remove 행 + add 버튼

### 5) Lat — `docs/lat/documents.md`

PivotTableBlock 항목에 Sprint 5 명세 추가: rows/cols union, calculatedItems shape, 파이프라인에 calculatedItems 단계, dimField/dimLabel/bucketDate helper, 백틱 식별자.

### 6) Tests

- `pivotEngine.test.ts` +19 신규:
  - bucketDate: year/quarter/month/day/week (ISO boundary) + epoch ms + Date + 파싱 실패
  - dimField / dimLabel: string / object / grouped
  - 시간 그룹 통합: rows 에 month bucket, cols 에 quarter bucket
  - calculatedItems: row 축 / col 축 / 후속 ref / 잘못된 formula skip / 0 분모 null / unknown ref null

## 검증

- typecheck: clean
- vitest: **2421 / 2421** (+19 신규). 기존 회귀 0
- codegen 통과 (16/16 sample valid)

## Defer (Sprint 6+)

- Slicer / Timeline cross-widget filter (XL)
- DataSourceBlock 참조 (실시간 raw rows, async + 캐시) (L)

## 다음 단계

다음 큰 트랙은 사용자 결정에 위임 — Slicer / DataSource 참조 / LLM 위젯 가이드 보강 / 새 트랙 등
