# Chart-XY-Line Gap Analysis

> Plan↔구현 gap 검증 — `/pdca analyze chart-xy-line` 결과.
> Plan: `docs/01-plan/features/chart-xy-line.plan.md` (4 phase, §6 19 작업, §2 31 항목)

## Match Rate

**97.5%** (19.5 / 20, intentional skip 제외).

- 사용자 9 요구 (P1): **100%** (9/9)
- §6 작업 분해: **100%** (16/16 implemented, 3 intentional skip)
- §2 functional items: **97.5%** (19.5/20 implemented, 10 intentional skip, 1 partial)

## Work Item Status (Plan §6)

| Phase | # | 작업 | 상태 | Evidence |
|:-----:|:-:|------|:----:|----------|
| P1 | 1 | Schema 확장 + regen | ✓ | `packages/shared/schemas/document.json:438+` (enum), `:462-490` (points/yAxisIndex/color), `:502-509` (yAxisLabel2/xAxisType), `:557-579` (display), `:582+` (annotations) |
| P1 | 2 | `linearFit` 순수 함수 | ✓ | `_fits.ts:37` (linearFit), `:95` (formatFit), `:123` (fitLine) |
| P1 | 3 | `_chartPaste` 파서 | ✓ | `_chartPaste.ts:56` (extractUnit), `:70` (parseChartPaste), `:253` (timestamp) |
| P1 | 4 | EChartsView xy-line 분기 | ✓ | `EChartsView.tsx:262-687` (xy-line case, tooltip formatter, dataZoom, axis log) |
| P1 | 5 | ChartBlockEditor paste + toolbar | ✓ | `ChartBlockEditor.tsx:83-136` (applyChartPasteToBlock), `:375-397` (onWrapperPaste), `:690-728` (toolbar) |
| P1 | 6 | 단위 테스트 | ✓ | _fits 35 + _chartPaste 26 + EChartsView.option 4 + paste 13 |
| P2 | 7 | toolbar — fit-range/축범위/stats/PNG/CSV | ✓ | `ChartBlockEditor.tsx:149-191` (buildCsvExport), `:207-250` (computeSeriesStats), `:644-668` (exportPng/Csv), `:856-972` (popovers/buttons) |
| P2 | 8 | A4 컬럼 선택 fallback | ⊘ | **Intentional skip** — auto 추론 충분 |
| P2 | 9 | E4 시리즈 정리 panel | ✓ | `ChartBlockEditor.tsx:462-475` (moveSeries/removeSeries), `:975-1062` (panel) |
| P3 | 10 | 비선형 fit | ✓ | `_fits.ts:272` (polyFit), `:311` (exponentialFit), `:333` (powerFit), `:363` (evaluateFit) |
| P3 | 11 | annotation (C4 + D1) | ⚠ partial | marker/arrow/box 3종 ✓, D1 (점 클릭) 만 미구현 |
| P3 | 12 | dual y-axis | ✓ | EChartsView `:270,594-613` + Editor `:478-507,753-766` |
| P3 | 13 | timestamp x | ✓ | `_chartPaste.ts:228-270` + EChartsView `:273,616-620` |
| P3 | 14 | error bar | ✓ | EChartsView `:314-392` (custom series + cap) + 스키마 `:472-474` |
| P3 | 15 | derived (B3-B5) | ✓ | `_derived.ts` + Editor `:588-635,789-826` |
| P4 | 16 | pptx export xy-line | ✓ | `pptx_export.py:765-838` (XY_SCATTER_LINES_NO_MARKERS) + 2 tests |
| P4 | 17 | docx export xy-line | ⊘ | **Intentional skip** — textual fallback 충분 |
| P4 | 18 | PDF SVG | ⊘ | **Intentional skip** |
| P4 | 19 | LTTB + outlier toast | ✓ | EChartsView `:288-309` + `_chartPaste.ts:181-204` + Editor `:392-396` |

## 사용자 9 요구 모두 충족

| # | 요구 | 검증 |
|:-:|------|------|
| 1 | xy-line + free (x, y) | `_chartPaste` + EChartsView |
| 2 | 엑셀 N×K paste | `parseChartPaste` 2/≥3 컬럼 분기 |
| 3 | 헤더 자동 추출 + 단위 | `extractUnit` (`[..]`/`(..)`/`{..}`) |
| 4 | 추가 paste = 누적 | `applyChartPasteToBlock` append |
| 5 | 인터랙티브 캡션 | echarts tooltip formatter (caption 회색 줄) |
| 6 | grid on/off | `display.gridOn` → splitLine.show |
| 7 | zoom | dataZoom inside+slider 기본 |
| 8 | log scale | xLog/yLog → axis.type='log' |
| 9 | linear fit + R² | `linearFit` + markLine |

## Partial Gap

### D1: 점 클릭 → marker 자동 추가
- **Plan**: "데이터 포인트 클릭 → 그 점에 한 줄 메모 `block.annotations` 에 marker kind 로"
- **현재**: 데이터 모델 ✓, Editor toolbar dropdown 으로 marker 추가 ✓, **canvas point click → marker 자동 추가 핸들러 없음**
- **위치**: `EChartsView.tsx` 의 useEffect 안에 `inst.on('click', ...)` 등록 누락
- **영향**: Low — toolbar 우회 경로 작동 (좌표 input)
- **수정 비용**: ~30 LOC (click 핸들러 + onChange prop 추가)

## Intentional Skip (Plan 에 명시 또는 사용자 확정)

| 항목 | 사유 |
|------|------|
| A4 (컬럼 fallback dialog) | auto 추론 충분 |
| A2 (CSV 파일 드롭) | paste 만으로 충분 |
| A3 (JSON 직접 입력) | grid UI 우회 |
| A5 (URL fetch) | CORS 한계 |
| C2 (시리즈 marker/lineStyle) | color 만 추가, 나머지는 후속 |
| C6 (log base 선택) | 10 고정 |
| C7 (격자 색/투명도) | 기본 스타일 |
| D4 (deeplink) | 별도 사이클 |
| E2/E3 (카테고리+xy 혼합 / unit-aware 변환) | options raw 통과로 처리 |
| F2 (docx xy-line native) | textual placeholder 충분 |
| F3 (PDF SVG) | PNG fallback 충분 |
| G3 (차트 검색) | Out of scope |

## 테스트 커버리지

| 파일 | 케이스 수 |
|------|-----:|
| `_fits.test.ts` | 35 |
| `_chartPaste.test.ts` | 26 |
| `_derived.test.ts` | 21 |
| `ChartBlockEditor.paste.test.tsx` | 13 |
| `ChartBlockEditor.p2.test.tsx` | 26 |
| `ChartBlockEditor.p3.test.tsx` | 20 |
| `EChartsView.option.test.ts` | 4 |
| `test_pptx_export.py` xy-line | 2 |
| **합계** | **147** |

## Commits

| Phase | Commit | 내용 |
|------|--------|------|
| P1 | `30d059b` | xy-line 기초 + paste + EChartsView + toolbar (4 에이전트 병렬) |
| P2 | `a65dd9d` | fit-range / 축범위 / stats / PNG / CSV / 시리즈 정리 (2 에이전트) |
| P3 | `2cb25c0` | annotation / dual-y / 비선형 fit / error-bar / timestamp / derived (5 에이전트) |
| P4 | `751bc10` | pptx export + LTTB + outlier toast (2 에이전트) |
| lat | `bc1ecb1` | docs/lat/charts.md 신규 + README/export.md 갱신 |

## 결론

Match Rate **97.5%** — `/pdca report chart-xy-line` 진행 가능. D1 점 클릭 핸들러
한 가지만 후속으로 추가하면 100% 완주. 모든 사용자 요구 충족, 진짜 누락 0.
