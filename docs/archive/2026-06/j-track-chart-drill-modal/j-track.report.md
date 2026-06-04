# j-track-chart-drill-modal — Completion Report

## Executive Summary
| | |
| --- | --- |
| **Feature** | J 트랙 — ChartBlock drill-down 모달 (Pivot 패턴 미러) |
| **Completion** | 2026-06-04 |
| **Match Rate** | 100% |
| **Commits** | `6722387` |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | H2 + I 로 chart 가 cross-widget filter 를 지원하나, 사용자가 특정 라벨의 *원본 row* 를 확인할 길이 없었음 (Pivot 은 G1 이전부터 drill 존재) |
| Solution | line/bar/area chart 클릭 시 activeLabel 추출 → drillChartRows 로 row 매칭 → ChartDrillModal 로 표시. PivotDrillModal 과 시각·테이블 shape 통일 |
| Function/UX | 사용자가 차트 한 곳에서 "총합 +12%" → 클릭 → 그 라벨의 raw rows 확인 → 검증 / 분석 흐름 단절 없음 |
| Core Value | 4 widget 의 cross-widget filter 가 *읽기 흐름 단방향* 이 아니라 *interactive 양방향* — 집계 결과 → raw evidence trace 가능 |

## 변경 파일

### `apps/web/src/components/blocks/pivotEngine.ts`
- 신규 export `drillChartRows(rawRows, filters, labelField, label)` — RawRow[] 반환. applyFilters 재사용.

### `apps/web/src/components/blocks/ChartBlock.tsx`
- `useHydratedChartBlock` 시그니처 변경: `ChartBlock` → `{ block, drillContext }`. `drillContext` = `{rawRows, allFilters, labelField}` 또는 `null` (source/labelField/aggregations 중 하나라도 없으면 null).
- `ChartBlockView` 에 `useState<drillLabel | null>` 추가. 클릭 시 `setDrillLabel(label)`.
- `renderChart` 에 `onLabelClick` 매개변수 추가 → 각 cartesian 차트 (`LineChart`/`BarChart`/`AreaChart`) 에 `onClick={handleChartClick}` + `style={cursor: 'pointer'}` 부착.
- `ChartDrillModal` 컴포넌트 신규 (exported for testability) — `PivotDrillModal` 패턴 미러: 공용 `Modal` + 헤더 (title + labelField: label) + 0-row empty state + field union (labelField 먼저, 나머지 first-seen).

### `apps/web/src/components/blocks/__tests__/drillChartRows.test.ts` (신규, 6 tests)
- label 정확 매칭, filters → label 순서, between filter (ISO date), 빈 labelField, no-match, null label cell.

### `apps/web/src/components/blocks/__tests__/ChartDrillModal.test.tsx` (신규, 4 tests)
- header + rows + field union 렌더, 0-row empty state, title=undefined 헤더, null cell 빈 문자열.

### `docs/lat/documents.md`
- ChartBlock 항목에 ★ J — drill-down 설명 추가 (`drillChartRows` 링크, 활성 조건, pie/radar/scatter 의도적 제외).

## 검증
- vitest **2470/2470 pass** (2460 + drillChartRows 6 + ChartDrillModal 4)
- typecheck clean
- chunker `--check` exit 0
- pytest API pass

## 핵심 설계 결정

### 1. recharts `onClick` 의 `activeLabel` 만 사용
recharts 의 chart-level onClick 콜백은 `{activeLabel, activePayload}` 를 받는다. label 만으로 drillRows 가 충분하므로 series 별 drill 은 의도적 제외 — 한 series 가 보이지 않는 라벨에도 다른 series 가 contribute 할 수 있어 "라벨 전체 rows" 가 자연스러운 의미.

### 2. `pie`/`radar`/`scatter` 제외
- pie: activeLabel 이 cartesian 라벨과 의미가 다름 (sector name)
- radar: cartesian 이지만 다중 series 의 spider 가 단일 라벨 click 의미를 약하게 함
- scatter: x/y 둘 다 numeric — labelField 가 raw rows 의 어떤 column 인지 불명확

`xy-line` 도 마찬가지로 (x, y) 자유 쌍이라 label concept 부재 — `default` 분기는 fallback이라 drill 미부착.

### 3. `useHydratedChartBlock` 리턴 객체화
기존엔 hydrated `block` 만 반환. drill 을 위해 raw rows + applied filters + labelField 가 필요한데, 둘 다 hook 안에서 이미 계산되었으므로 **재계산 없이 객체로 함께 반환**. drill 미활성 (source 없음) 일 때는 `drillContext: null` — 호출부의 가드 조건이 단순.

### 4. `cursor: 'pointer'` 시각 affordance
drill 이 활성일 때만 cursor 변경. drill 이 없는 chart (정적 data only) 는 today 와 똑같이 default cursor — 사용자가 클릭 가능 여부를 인지.

### 5. ECharts engine 경로는 변경 없음
ECharts 는 자체 brush/zoom/dataZoom 으로 drill 동등 기능 제공 (P3 cycle 에서 land). recharts 경로만 drill 추가.

### 6. Modal 본문은 Pivot 의 PivotDrillModal 과 *의도적으로 비슷한 shape*
- header: title 있으면 "title — labelField: label", 없으면 "labelField: label"
- 0-row 카피: "해당 라벨에 속한 raw row 가 없습니다."
- 표: field union (labelField 먼저)
- null cell → 빈 문자열 (PivotDrillModal 과 동일)

PivotDrillModal 과 함수 합치는 것도 검토했으나, drill 의 *의미 컨텍스트* (Pivot 의 rowKey×colKey vs Chart 의 단일 label) 가 달라 별도 유지가 합리적.

## 잔여 defer

| 항목 | 크기 | 비고 |
|---|---|---|
| ECharts 경로의 native drill 통일 (recharts drill modal 과 같은 UX 로 wrap) | M | ECharts 가 이미 brush/zoom 제공 |
| Pie/Radar 의 drill (sector / arm 클릭 → 그 카테고리의 raw rows) | M | activeLabel 추출 방법 다름 |
| Series 별 drill ("Sales H1 의 row만") | S | activePayload 의 dataKey 활용 |
| Drill 모달의 CSV export (Pivot 도 미지원) | S | 사용자 요청 없음 |

## 누적 (G+H+I+J)

| Cycle | Commit | 핵심 |
|---|---|---|
| G1 | a8e7d68 | Pivot DataSource ref |
| G2 | 9d1d673 | SlicerBlock + boundSlicers |
| G3 | f45c5b8 | viewer 가이드 (한) |
| G4 | b069cfe + 35a59cf | defer quad |
| H0+H1 | 1c6d6e2 | stale + hydration + i18n + sample |
| H2 | 6855285 | Chart boundSlicers + source ref + aggregator |
| H archive | 7831e79 | |
| I (a+b) | bfb7652 | Chart editor UI + KpiCards boundSlicers |
| I archive | a19ce8b | |
| **J** | **6722387** | Chart drill-down modal |

## cross-widget filter 완성도 (J 시점)

| Widget | source ref | boundSlicers | editor UI | drill modal |
|---|:---:|:---:|:---:|:---:|
| PivotTable | ✓ | ✓ | ✓ | ✓ (G1 이전) |
| Table | ✓ | ✓ | ✓ | — |
| Chart | ✓ | ✓ | ✓ | ✓ (J) |
| KpiCards | ✓ | ✓ | ✓ | — |
| Slicer / Timeline | source only | (producer) | ✓ | — |
