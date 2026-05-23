# Plan — chart-xy-line (full)

> 시리즈마다 자유 (x, y) 쌍을 갖는 새 `xy-line` chart type 을 출발점으로,
> 차트 영역 전반의 데이터 입력 / 분석 도구 / 시각 옵션 / 인터랙션 / 출력
> 통합까지 한 사이클로 정리. 범위가 크므로 4-phase 점진 구현.

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | 차트의 `labels` 단일 배열을 모든 시리즈가 공유 → 시리즈마다 x 가 다른 데이터 (stress-strain, 시계열 등) 를 못 그린다. 데이터 입력은 JSON 수동 — 엑셀 워크플로우와 단절. 분석 도구 (zoom/log/fit) 가 raw ECharts options 직접 작성해야만 가능. annotation·dual axis·error bar·다양한 export 등 연구/엔지니어링 표준 기능 부재. |
| **Solution** | (1) `chartType: 'xy-line'` + `series.points` 스키마. (2) 차트 블록 내부 paste — 엑셀 N×K → 시리즈 자동/누적, 헤더 (단위 포함) 자동 추출. (3) ECharts toolbar — grid/zoom/log/fit/range/export. (4) annotation·dual-axis·error bar·비선형 fit·timestamp x 등 도메인 기능. (5) pptx/docx/PDF 출력 갱신. (6) 운영 — downsample/outlier. |
| **Function · UX · Effect** | 엑셀 두 컬럼 복사 → paste → 시리즈 추가 → 다른 시료 또 paste → 비교. fit 켜고 elastic 영역만 드래그 선택 → Young's modulus 자동. 두 단위가 다른 시리즈는 dual y-axis. 차트 PNG 받아서 회의에 첨부. pptx 슬라이드에도 같은 데이터 그대로. |
| **Core Value** | 연구/엔지니어링 데이터 작업이 워드프로세서 수준 마찰로 가능. 전용 그래프 도구 (Origin/Grapher/Matlab) 없이 문서 안에서 측정 → 비교 → 결론. |

## 1. Overview

### 1.1 Purpose

차트 블록을 **publication-grade data tool** 로 끌어올림. 사용자 요구 9 + 추가
제안 (A~G) = 31 개 항목을 4 phase 로:

| Phase | 묶음 | 가치 / 의존 |
| --- | --- | --- |
| **P1** | 기초 — xy-line 데이터 모델, paste, EChartsView 기본 분기 | 다른 모든 phase 의 토대 |
| **P2** | 필수 분석 (B2/A1/C1/D2 등) | "이거 없으면 fit 가치 반토막" 류 |
| **P3** | 도메인 기능 (annotation/dual-y/비선형 fit/timestamp) | 분리 가능하지만 사용자 가치 큼 |
| **P4** | 출력 통합 + 운영 (pptx/docx/downsample/outlier) | 사용자 직접 가치는 작지만 일관성 |

각 phase 가 자체 commit + 단위 테스트 + typecheck/vitest 게이트. P1 만 끝나도
사용자 가치가 일어남.

### 1.2 Out of Scope (이번 사이클 전체)

- 데이터 편집 grid UI (셀별 수동 수정) — paste 통째 교체만.
- Google Sheets API live link — A5 는 URL fetch 만, 양방향 동기 X.
- 차트 collaboration (실시간 다중 편집 cursor) — 기존 문서 단위 협업으로 충분.
- 3D 차트 / Sankey / 지도 등 ECharts 의 비표준 타입.
- 차트 검색 (G3) — 전체 문서 인덱싱 별도 사이클.

### 1.3 Decisions (사용자 확정)

- 전 항목 (A1~G3) **모두 포함**, phase 로 분할.
- **ECharts 강제** for xy-line (zoom/log/markLine 핵심).
- 사용자 요구 9 가지 누적 사항은 P1+P2 안에 다 들어감 (#1~#9).

## 2. Functional Requirements

### 2.1 데이터 모델 — Phase 1

`packages/shared/schemas/document.json`:

```json
"chartType": {
  "enum": [..., "xy-line"],
  "description": "시리즈마다 자유 (x, y) 쌍."
},
"series.items.properties": {
  "values": {...},                                  // 기존 optional
  "points": [{x:number, y:number, err?:number}],    // 신규 — err 는 P3
  "caption": "string",                              // 신규 hover tooltip
  "color": "string",                                // 신규 P3 — 시리즈 색상
  "marker": "circle|square|triangle|none",          // 신규 P3
  "lineStyle": "solid|dashed|dotted",               // 신규 P3
  "yAxisIndex": 0|1                                 // 신규 P3 — dual axis
},
"xAxisLabel": "string",                             // 신규
"yAxisLabel": "string",                             // 신규
"yAxisLabel2": "string",                            // 신규 P3
"display": {                                        // 신규 — 토글 상태
  "gridOn": "boolean",
  "xLog": "boolean", "yLog": "boolean",
  "xMin": "number", "xMax": "number",               // P2 수동 범위
  "yMin": "number", "yMax": "number",
  "showFit": "boolean",
  "fitType": "linear|poly2|poly3|exp|power",        // P3 비선형
  "fitRange": {"xMin":..., "xMax":...},             // P2 fit 범위
  "showStats": "boolean",                           // P2 통계 박스
  "sampling": "none|lttb"                           // P4 큰 데이터
},
"annotations": [                                    // P3 — 차트 위 도형
  {"kind":"arrow|box|marker", "x":..., "y":..., "label":..., "color":...}
]
```

TS + Pydantic regen. add-only optional 이라 옛 차트 무영향.

### 2.2 paste UX — Phase 1

`ChartBlockEditor` (기존 또는 신규) 의 `onPaste`:

- TSV/CSV 파싱 (csv-paste.ts 의 `parseCsv` 재사용).
- **헤더 인식**:
  - 1 행 모두 숫자 아님 → 헤더
  - 헤더 위에 단일 셀이면 → 차트 제목
  - 컬럼 2: `[x, y]` — 단일 시리즈
  - 컬럼 ≥3: `[x, y1, y2, ...]` — 첫 컬럼 공통 x, 나머지 시리즈
- **A1: 단위 자동 추출** — `Stress [MPa]`, `Strain (mm/mm)` 같은 헤더에서
  `[...]` 또는 `(...)` 안의 단위 떼어 `xAxisLabel`/`yAxisLabel` 에 부착
  ("Stress [MPa]"). tooltip 도 단위 포함.
- **누적**: xy-line 차트가 이미 series 가지면 append. 빈 차트면 새 시리즈.
- **A4: 컬럼 선택 fallback** — 자동 추론 실패 시 작은 dialog "x 컬럼:
  1번, y 컬럼: 3번" 선택 (P2).

### 2.3 toolbar — Phase 1/2

차트 위 작은 칩 행:

```
P1: [#Grid] [Xlog] [Ylog] [🔍Zoom] [⟲Reset]
P2: [Fit ▾ Linear|Range] [축범위...] [⬇PNG] [⬇CSV]
P3: [+ Annotation ▾] [Dual Y]
```

상태는 `display` 객체 보존.

### 2.4 인터랙티브 캡션 — Phase 1

ECharts `tooltip.formatter`:

```
시리즈명  (caption 있으면 회색 한 줄)
(x, y) = (값1, 값2) [단위]
```

hover 시 따라다님. legend 클릭 시리즈 toggle.

### 2.5 선형 / 비선형 피팅 — Phase 1 (linear) / Phase 3 (others)

순수 함수 `_fits.ts`:

- `linearFit(points)` → `{slope, intercept, r2}` (P1)
- `polyFit(points, degree)` → `{coeffs[], r2}` (P3)
- `exponentialFit(points)` → `{a, b, r2}` (log 변환 후 linear) (P3)
- `powerFit(points)` → `{a, b, r2}` (log-log 후 linear) (P3)
- markLine series 로 회귀선, label 에 식 + R² 표시.
- **B2 피팅 범위** (P2): `display.fitRange.xMin/xMax` 안의 점만 사용.
  드래그로 영역 지정 가능 (ECharts brush + reducer).

### 2.6 추가 분석 도구 — Phase 2/3

- **B3 미분/적분** (P3): toolbar 의 "+ Derived ▾" → `d(시리즈명)/dx` 또는
  `∫(시리즈명) dx` 시리즈 추가. 순수 함수.
- **B4 peak/valley** (P3): "+ Peaks" 버튼 → 시리즈 극값 markPoint.
- **B5 차이 곡선** (P3): 두 시리즈 선택 → "+ Diff" → `(y2 − y1)` 시리즈.
- **B6 통계 박스** (P2): toolbar `[#] Stats` 토글. 차트 옆 작은 panel —
  시리즈별 mean/std/min/max/slope/R².

### 2.7 시각 옵션 — Phase 2/3

- **C1 축 범위** (P2): toolbar 의 "축범위" 클릭 → 4 입력 (xMin/Max/yMin/Max).
- **C2 시리즈 색/마커/선** (P3): legend 항목 우클릭 → popover.
- **C3 error bar** (P3): series.points.err 있으면 ECharts customSeries 로.
- **C4 annotation** (P3): toolbar "+ Annotation" → 화살표/박스 드래그. data
  좌표계 사용 — `block.annotations` 에 저장.
- **C5 dual y-axis** (P3): 시리즈에 `yAxisIndex: 1` 부여 → 오른쪽 y축.
  `yAxisLabel2` 별도.
- **C6 log base** (P3): `display.xLogBase: 10|e` (기본 10).
- **C7 격자 스타일** (P3): `display.gridColor`/`gridOpacity`.

### 2.8 인터랙션 / 공유 — Phase 2/3

- **D1 점 클릭 → 노트** (P3): 데이터 포인트 클릭 → 그 점에 한 줄 메모
  `block.annotations` 에 `marker` kind 로.
- **D2 PNG export** (P2): toolbar `⬇PNG`. ECharts `getDataURL()`.
- **D3 CSV export** (P2): `⬇CSV` — 시리즈를 N×K 표로.
- **D4 deeplink** (P3): URL hash 에 zoom/log/range 인코딩 → 공유.
- **D5 legend 격리** (P1): echarts 기본 — option 만 켜기.

### 2.9 데이터 모델/호환성 — Phase 3

- **E1 timestamp x** (P3): paste 시 첫 컬럼이 ISO date 또는 unix ms 추론 →
  `xAxisType: 'time'`.
- **E2 카테고리 + xy 혼합** (P3): bar chart 에 markLine 얹기 — options
  raw 통과로 처리 (no schema 변경).
- **E3 paste unit-aware 변환** (P3, 옵션): "[mm]" / "[m]" 자동 통일 — toast
  로 확인 후 변환. 기본 OFF.
- **E4 시리즈 정리 panel** (P2): toolbar `Series ▾` → 목록 + 삭제/reorder.

### 2.10 출력 — Phase 4

- **F1 pptx export 의 xy-line** (P4): python-pptx 의 LineChart 에 매핑.
  `_b_chart` 의 chartType 분기 추가.
- **F2 docx export** (P4): 동일.
- **F3 PDF SVG** (P4): html_renderer 에서 ECharts → SVG → WeasyPrint
  (현재는 PNG fallback).

### 2.11 운영 — Phase 4

- **G1 downsample** (P4): >100k 점 시 `series.sampling: 'lttb'` 자동.
- **G2 outlier 경고** (P4): paste 시 5σ 이상 1% 발견 → toast.
- **G3 차트 검색** — out of scope.

### 2.12 사용자 요구 9가지 ↔ phase 매핑

| # | 요구 | Phase |
| --- | --- | --- |
| 1 | xy-line + free (x,y) | P1 |
| 2 | 엑셀 N×K paste | P1 |
| 3 | 헤더 자동 추출 + 단위 (A1) | P1 |
| 4 | 추가 paste = 누적 | P1 |
| 5 | 인터랙티브 캡션 | P1 |
| 6 | grid on/off | P1 |
| 7 | zoom | P1 |
| 8 | log scale | P1 |
| 9 | linear fit + R² | P1 |

→ **P1 완수로 사용자 9 요구는 전부 충족**. P2~P4 는 그 위 가치 증분.

## 3. Non-Functional Requirements

| 항목 | 수준 |
| --- | --- |
| 호환성 | 기존 chart (line/bar/pie/area/radar/scatter) 동작 무변경. xy-line 만 새 경로. |
| paste 성능 | 10k 점 즉시. 100k+ 는 P4 의 LTTB downsample. |
| zoom 반응성 | ECharts dataZoom 기본 60fps. |
| 데이터 round-trip | series.points + display + annotations 모두 DocumentJSON 보존. docx/pptx round-trip 은 P4. |
| BE 변경 | 스키마 확장만 (add-only optional). 라우터/서비스 무변경. |
| 회귀 | 각 phase 마다 vitest/pytest 전체 pass, 기존 chart 테스트 무변경. |

## 4. 데이터 모델 영향

§2.1 의 스키마. 모든 신규 필드 optional. TS + Pydantic regen.

## 5. UX 흐름 (P1 완수 시점)

### 5.1 신규 차트

1. `/chart` slash → 빈 chart (chartType=xy-line)
2. 엑셀 두 컬럼 복사 → paste → 시리즈 1 + 자동 축 라벨 (단위 포함)
3. 다른 시료 복사 → paste → 시리즈 2 추가
4. toolbar — grid/log/fit 토글, zoom 드래그

### 5.2 P2 분석

5. Fit 켜고 "Range" 드래그 → 그 구간만 fit → Young's modulus 라벨
6. `[#] Stats` → 우측 통계 박스
7. `⬇PNG` → 발표용 이미지

### 5.3 P3 도메인

8. dual-y 체크 → 두 단위 시리즈 별도 축
9. annotation 추가 → "yield point" 화살표
10. 비선형 fit dropdown → exp/power

## 6. 작업 분해

| Phase | # | 작업 | 파일 | 의존 |
| --- | --- | --- | --- | --- |
| **P1** | 1 | 스키마 확장 + regen | document.json + codegen | — |
| P1 | 2 | `_linearFit` 순수 함수 | `_fits.ts` (신규) | — |
| P1 | 3 | `_chartPaste` 파서 — TSV/CSV → series, 헤더+단위 추출 | `_chartPaste.ts` (신규) | 1 |
| P1 | 4 | EChartsView 의 xy-line 분기 + grid/log/zoom + tooltip formatter | `EChartsView.tsx` | 1, 2 |
| P1 | 5 | ChartBlockEditor — paste 핸들러 (누적), toolbar P1 | 신규 또는 기존 ChartBlockEditor | 1, 3, 4 |
| P1 | 6 | 단위 테스트 — fits/paste/EChartsView option builder | 신규 tests | 2, 3, 4 |
| **P2** | 7 | toolbar — fit range, 축범위, stats, PNG, CSV export | 같은 ChartBlockEditor | P1 |
| P2 | 8 | A4 컬럼 선택 fallback dialog | ChartBlockEditor | 3 |
| P2 | 9 | E4 시리즈 정리 panel | ChartBlockEditor | P1 |
| **P3** | 10 | 비선형 fit (poly/exp/power) | `_fits.ts` 확장 | 2 |
| P3 | 11 | annotation (C4 + D1) — 화살표/박스/마커 | EChartsView + Editor toolbar | P1 |
| P3 | 12 | dual y-axis | EChartsView | P1 |
| P3 | 13 | timestamp x 추론 | _chartPaste | 3 |
| P3 | 14 | error bar | EChartsView | P1 |
| P3 | 15 | 미분/적분/peak/diff (B3-B5) | `_derived.ts` (신규) + toolbar | P1 |
| **P4** | 16 | pptx export xy-line | `app/services/pptx_export.py` | P1 |
| P4 | 17 | docx export xy-line | `app/services/docx_export.py` | P1 |
| P4 | 18 | PDF SVG 경로 | `html_renderer.py` | P1 |
| P4 | 19 | LTTB downsample + outlier toast | EChartsView | P1 |

병렬화: 각 phase 안에서 의존 그래프 작은 묶음들은 에이전트로 동시 실행.

## 7. 테스트 전략

| Phase | 테스트 |
| --- | --- |
| P1 | `_fits.linearFit` (정확/2점/수직선), `_chartPaste` (헤더·단위·N×K·누적), EChartsView option builder snapshot (xy-line grid/log/zoom), 기존 chart 회귀 |
| P2 | fit-range 안의 점만 계산, PNG/CSV export return type, 축범위 input → option 반영 |
| P3 | 비선형 fit 정확도, annotation 좌표 클릭, dual y-axis option, timestamp 추론, error bar 렌더 |
| P4 | pptx/docx round-trip 의 xy-line, LTTB downsample 1k→100 결과, outlier 검출 |

## 8. 배포 / Rollback

각 phase 가 자체 commit. 스키마 변경은 add-only optional — 옛 클라이언트가
새 필드 무시. 롤백 시 신규 chartType 차트는 빈 시각화 (안전 fallback).

## 9. 진행 게이트

P1 끝나면 사용자 9 요구 충족 → 사용자 검증 → P2 진입. 각 phase 사이 사용자
방향 확인 권장 (전체를 한 번에 push 하면 검증 불가).
