# n-track-drill-finalize — Completion Report

## Executive Summary
| | |
| --- | --- |
| **Feature** | N 트랙 — drill 잔여 일괄 (pie/radar/scatter drill / clipboard+TSV / PyInstaller 재검증) |
| **Completion** | 2026-06-05 |
| **Match Rate** | 100% |
| **Commits** | `d9f3934` |

### Value Delivered

| Perspective | Outcome |
| --- | --- |
| Problem | J 의 chart drill 이 line/bar/area 만 — pie/radar/scatter 사용자가 drill 못 함. M 의 CSV 단일 export 가 한글 깨짐 위험 + clipboard 미지원. E3 의 PyInstaller defer 가 *이미 fix 됐는지 확인되지 않은 상태* |
| Solution | (N-1) 3 chart type 모두 drill 활성. (N-2) 4 modal 일괄로 BOM + TSV + clipboard 3-button strip. (N-3) PyInstaller build dry-run 으로 4 binary 정상 확인 → defer 제거 |
| Function/UX | 모든 chart type 에서 drill, 모든 drill modal 에서 CSV/TSV download + clipboard. 한글 Excel 호환 |
| Core Value | **drill modal 완성도 = 4 widget × 모든 chart type × 3 export 방법**. 글로벌 i18n 외 모든 잔여 defer 해소 |

## (N-1) Pie/Radar/Scatter chart drill

### 변경
`apps/web/src/components/blocks/ChartBlock.tsx` 의 `renderChart` switch:

| chartType | drill 방식 |
|---|---|
| `pie` | `<Pie onClick={(d) => d.name}>` — Pie datum 의 `name` (== label) |
| `radar` | `<RadarChart onClick={handleChartClick}>` — Cartesian 과 동일 `activeLabel` |
| `scatter` | `<Scatter onClick={(d) => block.data.labels[d.x]}>` — datum.x 는 index, labels[] 에서 string 으로 변환 |

`xy-line` 은 자유 (x, y) 좌표라 label 매핑 불가 — 의도적 제외 (default 분기로 빠짐, drill 미부착).

cursorStyle / handleChartClick 은 line/bar/area 와 공유.

## (N-2) Drill modal clipboard + BOM + TSV

### helper 추가 (`apps/web/src/lib/widgetExport.ts`)
- `UTF8_BOM` 상수 (U+FEFF, Excel 의 한글 인코딩 hint)
- `rowsToTsv(headers, rows)` — tab 구분, `tsvCell` 로 tab/newline collapse (TSV 는 line-sensitive)
- `drillRowsToTsv(fields, rows)` — chart/kpi/pivot 다중 행용
- `drillSingleRowToTsv(fields, row)` — table single-row 용
- `copyToClipboard(text)` — async Clipboard API 우선, fallback execCommand textarea (Safari 구버전 / insecure context 대응)

### 공용 컴포넌트 (`apps/web/src/components/blocks/DrillExportControls.tsx`)
4 modal 의 단일 📥 CSV 버튼을 모두 이 3-button strip 으로 교체:
- **📥 CSV** — UTF-8 BOM + CSV download (Excel 한글 호환)
- **📥 TSV** — UTF-8 BOM + TSV download (Excel 이 .csv 보다 더 견고하게 인식)
- **📋 Copy** — TSV 를 system clipboard 로 → 스프레드시트 paste 친화

Copy 클릭 시 1.5 초 동안 button 색상 flash (`✓ 복사됨` / `⚠ 실패`).

### testIdPrefix 보존
기존 `chart-drill-csv` / `kpi-drill-csv` 등 testid 가 그대로 유지되어 M-2 의 DrillModalCsvButton 회귀 test 그대로 통과.

## (N-3) PyInstaller hidden import — 재검증

### 결과
E3 의 defer 가 "ulid / mcp 모듈 hidden import 누락" 으로 적혀있었으나 **F2 의 preflight (`build.py:287 _preflight()`) 가 이미 해결**. N 사이클에서 실제 build dry-run:

```
$ python3 build.py --variant lite
[OK] produced binary: mxwp-validator-linux  → mxwp-validator 1.0.0
[OK] produced binary: mxwp-rules-linux      → mxwp-rules 1.0.0
[OK] produced binary: mxwp-mcp-linux        → mxwp-mcp 1.0.0
[OK] produced binary: mxwp-import-linux     → mxwp-import 1.0.0
[release] llm-docx-toolkit-lite-linux.tar.gz = 122.0 MB
```

4 binary 모두 정상 build + `--version` 응답. PyInstaller 의 hidden import 누락 이슈는 *코드 변경 없이 이미 해결된 상태* — 재확인으로 충분. 잔여 defer 목록에서 제거.

## 검증
- vitest **2507/2507 pass** (이전 2496 + DrillExportControls 3 + TSV 4 + clipboard 4)
- typecheck clean
- ajv samples **17/17 valid**
- chunker `--check` exit 0
- PyInstaller build dry-run: 4/4 binary OK

## 핵심 설계 결정

### 1. xy-line 의 drill 제외
xy-line 은 시리즈마다 자유로운 `(x, y)` 좌표 — `block.data.labels` 가 무시되므로 "label" concept 부재. drill row matching 의 기준이 없어 모달을 열어도 의미가 없음. line/bar/area 의 fallback 분기로 빠지지만 drill 미부착.

### 2. Scatter 의 `datum.x = index` 트릭
scatterPoints 가 `(x: i, y: value)` 로 변환하므로 x 좌표가 곧 labels[] 의 index. block.data.labels[x] 로 string 추출 → 같은 onLabelClick pipeline. recharts Scatter 의 onClick 이 datum 을 받아 매끄럽게 연결.

### 3. TSV 가 CSV 보다 Excel 호환에 우월
Excel 의 .csv 파싱은 quoting 을 해석하지만 한글 인코딩 + 콤마 함유 데이터 + 자동 컬럼 분리 추론이 느슨함. .tsv 는 tab 이 거의 데이터에 안 나타나서 컬럼 경계가 명확. tsvCell 이 tab/newline 을 공백으로 collapse → quoting 불필요. 두 옵션을 모두 노출해 사용자가 선택.

### 4. UTF-8 BOM 의 보편적 prefix
BOM 한 글자만 추가하면 Excel 이 UTF-8 로 인식 → 한글 깨짐 해소. ECMAScript / RFC 4180 표준은 BOM 을 인정 안 하므로 *내부 파이프라인* 에서는 BOM 없이, *Excel 호환 download* 에서만 추가하는 게 깨끗.

### 5. clipboard fallback 의 단계적 강화
1. `navigator.clipboard.writeText` (modern, secure context)
2. textarea + `execCommand('copy')` (legacy, jsdom 에서는 false)
3. 둘 다 실패 시 `false` return → button 이 `⚠ 실패` 표시 (silent failure 회피)

### 6. PyInstaller defer 의 진짜 의미
defer 가 *항상* 코드 변경을 의미하지는 않음. 일부는 "확인이 필요한 상태" — N-3 처럼 *re-validation* 만 해도 defer 가 닫힘. archive report 에 그 결정 과정을 명시.

## 잔여 defer (N 이후, 글로벌 i18n 제외 모두 해소)

| 항목 | 상태 |
|---|---|
| ~~Pie/Radar/Scatter chart drill~~ | ✅ N-1 |
| ~~Drill modal clipboard copy~~ | ✅ N-2 |
| ~~Drill CSV → XLSX (or BOM/TSV 대안)~~ | ✅ N-2 (BOM + TSV) |
| ~~PyInstaller hidden import~~ | ✅ N-3 (재검증 — 이미 해결) |
| ja/zh i18n 번들 | ⏸ 사용자 명시 제외 (글로벌 확장 비활성) |

**🟢 글로벌 i18n 외 모든 잔여 defer 해소.**

## 누적 G→N (22 commits)

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
| M | 3450d30 |
| M archive | adaaec6 |
| **N** | **d9f3934** |

## cross-widget filter 완성도 (N 시점, 최종)

| Widget | source ref | boundSlicers | editor UI | drill modal | drill CSV+TSV+Copy | 모든 chart type |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| PivotTable | ✓ G1 | ✓ G2 | ✓ G1/G2 | ✓ | ✓ M+N | n/a |
| Table | ✓ G4+K | ✓ G4 | ✓ L-1 | ✓ K-1 | ✓ M+N | n/a |
| Chart | ✓ H2 | ✓ H2 | ✓ I-a | ✓ J | ✓ M+N | **✓ N-1** |
| KpiCards | ✓ I-b | ✓ I-b | ✓ I-b | ✓ K-2 | ✓ M+N | n/a |

**🟢 4/4 widget × 모든 capability = 100% 완성** (글로벌 i18n 제외).
