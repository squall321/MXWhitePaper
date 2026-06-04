# h-track-cleanup-chart-slicers — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | H 트랙 — G4 후속 cleanup (H1) + Chart boundSlicers (H2) + stale PDCA 정리 (H0) |
| **Completion** | 2026-06-04 |
| **Match Rate** | 100% |
| **Commits** | `H0` 1c6d6e2 직전 stale 정리 + `H1` 1c6d6e2 + `H2` 6855285 |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | (1) signup/bulk-import active 사본이 archive 와 drift, (2) Slicer/Timeline 의 `default` 가 viewer 에 hydrate 안 됨, (3) palette i18n 키 미연결, (4) cross-widget filter 가 Pivot+Table 만 지원 (Chart 는 G4 의 deferred 상태) |
| Solution | (H0) active stale 파일 archive 로 이동, (H1) mount-시점 default hydration + ko/en i18n + 17번째 sample, (H2) ChartBlock 에 source/labelField/aggregations 추가 + aggregateChartData helper + collectSlicerFilters / collectTimelineFilters 재사용 |
| Function/UX | 5 종 widget (Pivot + Table + Chart + Slicer + Timeline) 이 한 store 로 cross-widget filter. ChartBlock 도 slicer 클릭에 즉시 재집계 |
| Core Value | cross-widget filter coverage 완성 (3/3 data widget) + back-compat 100% (Chart `source` 미지정 시 today 동일) |

## H 트랙 변경

### H0 — stale PDCA 사본 정리 (2026-05-31 archive 의 drift 수정)
- `docs/02-design/features/signup.design.md` + `bulk-import.design.md` → archive 의 해당 폴더로 이동
- `docs/04-report/features/signup.report.md` + `bulk-import.report.md` 의 *active 본문* 을 archive 의 stub 위에 덮어쓰기 (truth 보존)
- active 의 4 파일 git rm
- 이후 `docs/02-design/features/` + `docs/04-report/features/` 는 `MX-WhitePaper.{design,report}.md` 만 (메타 doc 으로 의도된 파일)

### H1 — cleanup quad (commit `1c6d6e2`)
1. **mount-시점 default hydration** — SlicerBlock + TimelineBlock 둘 다 `useEffect` 로 block.default 가 있고 store entry 가 비어있을 때만 setActive 로 한 번 주입. 사용자가 chip/슬라이더를 만진 이후에는 덮어쓰지 않음.
2. **palette i18n keys** — `apps/web/src/lib/i18n/{ko,en}.ts` 에 `palette.pivot` / `palette.slicer` / `palette.timeline` 추가. G1-G4 cycle 에서 키만 등록되고 번들 fallback 으로 동작했던 것을 정식 매핑.
3. **cross-widget filter sample doc** — `packages/shared/samples/17-cross-widget-filter.json` — 8 행 inline 데이터를 Slicer(부서) + Timeline(기간) 가 binding 한 Pivot + Table 데모. ajv validate 17/17 통과.
4. **Slicer pre/post toggle** — defer 유지 (사용자 요구 미발생, scout 추정만)

### H2 — ChartBlock boundSlicers (commit `6855285`)
1. **Schema** — `packages/shared/schemas/document.json` 의 ChartBlock 에 5 개 optional 필드 추가:
   - `source` — Pivot/Slicer/Timeline 과 동일 oneOf (inline rows | data-source ref)
   - `labelField` — distinct values 가 x축 labels
   - `aggregations[]` — 시리즈마다 `{field, agg, name?, color?, yAxisIndex?}`
   - `filters[]` — Pivot 의 FilterSpec 과 동일 shape (`in`/`not_in`/`gt`/`lt`/`between`/`top_n`/`bottom_n`)
   - `boundSlicers[]` — SlicerBlock + TimelineBlock id 목록
2. **Aggregator** — `apps/web/src/components/blocks/pivotEngine.ts` 에 `aggregateChartData(rows, labelField, aggregations, filters?)` 신규 export. 1D 그룹 (Pivot 의 2D 와 다름), `applyFilters` 재사용 (이번 cycle 에서 export 로 승격), null → 0 coerce. expression 미지원.
3. **Viewer hook** — `apps/web/src/components/blocks/ChartBlock.tsx` 에 `useHydratedChartBlock()` — `useHydratedPivotBlock` 패턴 미러. source 가 있으면 `collectSlicerFilters` + `collectTimelineFilters` 로 boundSlicers resolve → `aggregateChartData` → `data` 를 덮은 synthetic clone 반환. recharts 경로 + ECharts 경로 모두 자동 작동 (둘 다 `{labels, series}` 컨트랙트).
4. **Tests** — 신규 `aggregateChartData.test.ts` 9 test. 기존 `ChartBlock.test.tsx` / `ChartBlock.darkmode.test.tsx` / `WidgetExportMenu.mount.test.tsx` 에 `QueryClientProvider` 래퍼 (`ssr` 헬퍼) 추가 — `useQuery` 호출에 필수.
5. **lat** — `docs/lat/documents.md` ChartBlock 항목에 H2 신규 필드 + aggregator 링크 추가.

## 검증
- vitest **2454/2454 pass** (이전 2445 + aggregateChartData 9)
- pytest API pass
- typecheck clean
- chunker `--check` exit 0
- ajv samples 17/17 valid (17 번째 cross-widget-filter 포함)

## 핵심 설계 결정

### 1. ChartBlock 의 boundSlicers 가 의미를 가지려면 `source` 가 선행
Scout 결론: chart 의 `data.series[i].values` 는 pre-aggregated 라 row provenance 가 없음. raw rows 가 있어야 filter 가 의미를 가짐. 따라서 schema 에서 `boundSlicers` 가 단독으로 적힐 수 있지만 viewer 는 `source` 가 없으면 silently no-op. *옵션 조합의 의미* 를 schema description 에 명시.

### 2. Aggregator 의 1D 단순화 (vs Pivot 의 2D)
chart 는 x축 한 줄 + 시리즈 N 개. `labelField` 하나 + `aggregations: [{field, agg, name}]`. Pivot 의 `rows × cols × values` 3D 구조는 chart 의 사용처와 맞지 않음. 미래 확장이 필요해지면 `groupBy: [field1, field2]` 같은 multi-field 그룹 옵션을 추가하면 됨 — *현재 미요청*.

### 3. boundSlicers 의 generic helper 재사용
`collectSlicerFilters(boundSlicers, sections, active)` + `collectTimelineFilters(...)` 가 G4 에서 generic (Pivot block 의존 X) 으로 만들어졌기에 ChartBlock 에서 그대로 호출. 두 helper 가 함께 `[...slicer, ...timeline]` concat 으로 들어가 `applyFilters` 가 처리.

### 4. `useHydratedPivotBlock` 패턴 그대로 미러 — `synthetic clone`
viewer 가 `block` 자체를 변경하지 않고 `{...block, data: {labels, series}}` clone 만 반환. recharts + ECharts 두 경로 모두 그 clone 을 받아 변경 없이 render. 이 패턴은 G1 에서 처음 등장했고 G2/G4 에서도 일관 적용.

### 5. ChartBlockEditor 의 picker UI 는 defer
ChartBlockEditor 는 paste/CSV/툴바/통계 패널 등 surface 가 큼. source/aggregations picker UI 를 그 안에 끼우는 것은 별도 작업 — schema 와 viewer 만 우선 land 시켜 *문서를 JSON 으로 작성하는 LLM* 이 즉시 활용 가능하도록 함. UI 는 후속 cycle.

## Defer / 후속

- **ChartBlockEditor 의 source/aggregations picker UI** — SourceKindPicker (Pivot 과 공유 가능) + labelField dropdown + per-series field/agg row repeater. 별도 cycle.
- **KpiCardsBlock boundSlicers** — `items[i].compute: {field, agg, when}` 룰 schema 도입 필요. XL.
- **Chart drill-down (Pivot 처럼 raw rows 모달)** — chart 클릭 → bucket 의 raw rows 표시. Pivot 패턴 그대로 가능.
- **ja/zh i18n 번들 추가** — 현재 ko/en 만. 한국 사내 사용이 우선이지만 글로벌 배포 시 필요.

## H 트랙 누적

| Cycle | commit | 핵심 |
|---|---|---|
| H0 | (1c6d6e2 직전 staging 통합) | stale PDCA active 사본 archive 로 이동 |
| H1 | 1c6d6e2 | Slicer/Timeline default hydration + i18n + sample doc |
| H2 | 6855285 | ChartBlock boundSlicers + source ref + aggregateChartData |

## 전체 G+H 누적

| Cycle | commit |
|---|---|
| G1 | a8e7d68 (Pivot DataSource ref) |
| G2 | 9d1d673 (SlicerBlock + boundSlicers) |
| G3 | f45c5b8 (viewer 가이드 한) |
| G4 | b069cfe + 35a59cf (defer quad + archive) |
| **H1** | **1c6d6e2** (Slicer/Timeline hydration + i18n + sample) |
| **H2** | **6855285** (Chart boundSlicers) |
