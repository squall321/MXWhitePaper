# m-track-drill-csv-hidden — Completion Report

## Executive Summary
| | |
| --- | --- |
| **Feature** | M 트랙 — Sample hidden 컬럼 demo (M-1) + drill modal CSV export (M-2) |
| **Completion** | 2026-06-05 |
| **Match Rate** | 100% |
| **Commits** | `3450d30` |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | Sample 17 의 source 가 headers 와 1:1 매칭 (3 컬럼) — drill modal 의 amber `hidden` 배지가 실제로 작동함을 시연할 데이터가 없음. 또한 4 widget drill modal 의 데이터를 외부 분석으로 빼낼 수단 없음 |
| Solution | (M-1) source row 마다 region/manager/deal_id 3 hidden 컬럼 추가. (M-2) widgetExport.ts 에 drillRowsToCsv + drillSingleRowToCsv 추가 + 4 drill modal 헤더에 📥 CSV 버튼 |
| Function/UX | sample 의 Table row 클릭 → drill modal 이 6 컬럼 (headers 3 + hidden 3) 표시, hidden 컬럼은 amber 배지. 4 modal 모두 CSV 다운로드 가능 |
| Core Value | drill modal 이 *읽기 evidence* 일 뿐 아니라 *export pipeline* — 외부 도구 (Excel/Tableau) 연동 가능 |

## (M-1) Sample 17 hidden 컬럼

### 변경
- `packages/shared/samples/17-cross-widget-filter.json` 의 TableBlock source 의 8 행에 모두:
  - `region`: Seoul / Busan / Daegu / Incheon
  - `manager`: u-park / u-kim / u-lee
  - `deal_id`: D-001 ~ D-008
- block.headers 는 `["dept", "date", "amount"]` 그대로 — viewer 는 3 컬럼만 표시
- drill modal 클릭 시 6 필드 모두 표시 (3 hidden 은 amber 배지 + "3 개의 숨겨진 컬럼 포함" 카운트)

## (M-2) Drill modal CSV export

### Helper 추가 (`apps/web/src/lib/widgetExport.ts`)
- `drillRowsToCsv(fields, rows)` — chart/kpi/pivot 의 다중 행 매트릭스. caller 가 field union 을 전달 (modal 이 이미 계산해둠).
- `drillSingleRowToCsv(fields, row)` — table 의 field/value 2-column. caller 가 field 순서 정의 (header 컬럼 먼저).
- 둘 다 기존 `rowsToCsv` + `csvCell` 재사용 (RFC 4180 quoting).

### Modal 변경 (4 곳)
| Modal | export 파일명 | 활성 조건 |
|---|---|---|
| PivotDrillModal | `pivot-drill.csv` | drill.rows.length > 0 |
| ChartDrillModal | `chart-drill-{label}.csv` | rows.length > 0 |
| KpiDrillModal | `kpi-drill-{label}.csv` | rows.length > 0 |
| TableDrillModal | `table-drill-row.csv` | 항상 (single-row 라 빈 상태 없음) |

각 modal 의 row count `<p>` 옆에 📥 CSV 버튼 — `downloadBlob` 으로 Blob+a-download 트리거.

## 검증
- vitest **2496/2496 pass** (이전 2483 + drillCsv 8 + DrillModalCsvButton 5)
- typecheck clean
- ajv samples **17/17 valid**
- chunker `--check` exit 0

## 핵심 설계 결정

### 1. drill modal 의 CSV 가 widget 자체 CSV 와 다른 helper
WidgetExportMenu 의 기존 CSV (`chartLabeledToCsv`, `kpiCardsToCsv`, `flatTableToCsv`) 는 widget 의 *집계 결과* 를 export. drill CSV 는 *raw rows* (원본 evidence) 를 export — 사용 의미가 다름. 두 export pipeline 이 한 widget 에서 공존 가능 (widget 메뉴는 보이는 결과, drill 은 trace).

### 2. Table 의 drill CSV 는 field/value 2-column 으로
다른 modal 은 행렬 (rows × fields) 인데 Table drill 은 *단일 행* 의 모든 컬럼 — header column 먼저, hidden column 다음. 이걸 1×N 행렬로 쓰면 컬럼이 너무 가로로 길어져 가독성 ↓. `drillSingleRowToCsv` 가 transpose 형태 (field 열 + value 열) 로 직렬화 → 외부 도구에서 row 한 개의 모든 attribute 를 세로로 확인.

### 3. rows.length === 0 일 때 버튼 숨김 (Table 제외)
빈 drill modal 은 "기여 row 없음" 메시지만 — export 할 게 없으니 버튼 숨김 (UX clutter 제거). Table 은 single-row 가 항상 존재 (modal 이 열린 자체가 row 가 있다는 뜻) — 항상 노출.

### 4. file 명은 사람-친화적 (label 포함)
chart/kpi 는 어떤 라벨의 drill 인지 명시 (`chart-drill-Sales.csv`) → 사용자가 다중 모달 export 시 파일 충돌 없음. Pivot/Table 은 단일 export 흐름 가정 (drill 한 번에 한 cell/row).

## 잔여 defer (M 이후)

| 항목 | 크기 |
|---|---|
| Pie/Radar/Scatter chart drill | M |
| ja/zh i18n 번들 | S |
| PyInstaller hidden import 수정 (E3 defer) | M |
| drill modal CSV → XLSX (외부 라이브러리) | M |
| drill modal 의 raw rows 를 clipboard 로 copy (CSV 형식) | S |

## 누적 G→M (20 commits)

| Cycle | Commit |
|---|---|
| G1 | a8e7d68 |
| G2 | 9d1d673 |
| G3 | f45c5b8 |
| G4 | b069cfe + 35a59cf |
| H0+H1 | 1c6d6e2 |
| H2 | 6855285 |
| H archive | 7831e79 |
| I (a+b) | bfb7652 |
| I archive | a19ce8b |
| J | 6722387 |
| J archive | 4b49ff6 |
| K | 58f723c |
| K archive | cbeb3fd |
| L | 1846525 |
| L archive | 27ab503 |
| **M** | **3450d30** |

## cross-widget filter 완성도 (M 시점)

| Widget | source ref | boundSlicers | editor UI | drill modal | drill CSV |
|---|:---:|:---:|:---:|:---:|:---:|
| PivotTable | ✓ G1 | ✓ G2 | ✓ G1/G2 | ✓ (G1 이전) | **✓ M-2** |
| Table | ✓ G4+K | ✓ G4 | ✓ L-1 | ✓ K-1 | **✓ M-2** |
| Chart | ✓ H2 | ✓ H2 | ✓ I-a | ✓ J | **✓ M-2** |
| KpiCards | ✓ I-b | ✓ I-b | ✓ I-b | ✓ K-2 | **✓ M-2** |

**🟢 4/4 widget × 5/5 capability = 20/20 cell 100% 완성** (drill CSV column 추가됨).
