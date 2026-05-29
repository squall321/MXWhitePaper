# Widget Export lat — PNG / SVG / CSV / TSV

> 위젯 단위 read-mode export 헬퍼와 hover toolbar (WIDGET-08 Cycle 3).
> 연관: [[charts]] (ChartBlockEditor 의 풀-기능 export), [[documents]] (block 타입)

## 핵심 진입점

| 파일 | 책임 |
| --- | --- |
| [[src/lib/widgetExport.ts]] | 순수 헬퍼 — SVG → PNG (Canvas), SVG → string (outerHTML + xmlns), Blob download, CSV/TSV cell escape, 위젯별 CSV 빌더 (`kpiCardsToCsv` / `ganttTasksToCsv` / `flatTableToCsv` / `chartLabeledToCsv`) |
| [[src/components/blocks/WidgetExportMenu.tsx]] | 재사용 hover dropdown — `formats`/`getCsv`/`getTsv`/`filename`/`getSvg` props. `data-export-root` 조상 안의 첫 `<svg>` 를 클릭 시점에 잡아 PNG/SVG 로 변환 |

외부 라이브러리 0 — Canvas API 와 Blob/URL.createObjectURL 만 사용.
PNG 경로: `svgString` → base64 data URL → `<img>` onload → `canvas.drawImage` → `toDataURL`.

## 위젯별 export 매트릭스

| 위젯 | PNG | SVG | CSV | TSV | 마운트 위치 | data-export-root |
| --- | :---: | :---: | :---: | :---: | --- | --- |
| chart (recharts) | ✓ | — | ✓ | — | [[src/components/blocks/ChartBlock.tsx#ChartBlockView]] | `chart` |
| chart (echarts/xy-line) | (편집기 ⬇PNG) | — | (편집기 ⬇CSV) | — | [[src/features/editor/blocks/ChartBlockEditor.tsx#exportPng]] (별도 — `getDataURL` canvas 직출) | — |
| table (flat) | — | — | ✓ | — | [[src/components/blocks/TableBlock.tsx#TableBlockView]] | `table` |
| kpi-cards | — | — | ✓ | — | [[src/components/blocks/KpiCardsBlock.tsx#KpiCardsBlockView]] | `kpi-cards` |
| gantt | ✓ | ✓ | ✓ | — | [[src/components/blocks/GanttBlock.tsx#GanttBlockView]] | `gantt` |
| org-chart | ✓ | ✓ | — | — | [[src/components/blocks/OrgChartBlock.tsx#OrgChartBlockView]] | `org-chart` |
| flow (mermaid) | ✓ | ✓ | — | — | [[src/components/blocks/FlowBlock.tsx#MermaidFlow]] | `flow` |
| spreadsheet | — | — | ✓ | ✓ | [[src/features/editor/blocks/SpreadsheetBlockEditor.tsx]] (기존 toolbar 사용) | — (별도 경로) |

`(편집기 ...)` 표기는 read-mode WidgetExportMenu 가 아니라 ChartBlockEditor /
SpreadsheetBlockEditor 의 풀-기능 toolbar 가 담당한다는 뜻 — 사용자 경험상
중복 메뉴가 보이지 않도록 그렇게 분리.

## CSV 포맷 컨벤션

- 줄 구분자 `\r\n` (Excel for Windows 호환).
- RFC 4180 — `,` / `"` / CR / LF 가 있으면 큰따옴표 감싸기 + 내부 `"` 는 `""`.
- 빈 셀은 연속 콤마로 표현 (`a,,c`).
- 헤더는 항상 첫 줄.

| 위젯 | CSV 컬럼 |
| --- | --- |
| chart (labels) | `<xAxisLabel \|\| "x">`, `<series.name>`... |
| chart (xy-line) | `x`, `<series.name>`... (union x axis — [[src/features/editor/blocks/ChartBlockEditor.tsx#buildCsvExport]]) |
| table | `headers[0]`, `headers[1]`, ... |
| kpi-cards | `label`, `value`, `delta`, `trend?` (trend 컬럼은 어느 카드라도 trend 가 set 일 때만) |
| gantt | `name`, `start`, `end`, `progress` |
| spreadsheet | A1 grid (raw text or computed value — `raw` 옵션) |

## Hover toolbar 동작

`WidgetExportMenu` 는 host 가 `group relative` 래퍼를 제공한다고 가정.
absolute positioning + `group-hover:block` / `group-focus-within:block` 로
hover/focus 시에만 토글 버튼 노출. 토글 클릭 → 드롭다운 (`role="menu"`) 안에
formats 순서대로 메뉴 항목. 항목 클릭 시 lazy 호출:

- CSV/TSV → `getCsv()` / `getTsv()` 실행 → Blob → `downloadBlob`.
- SVG → `data-export-root` 안의 첫 `<svg>` 를 찾아 `svgElementToString`.
- PNG → 같은 SVG 를 `svgElementToPng(scale=2)` 로 비동기 변환 → blob → 다운로드.

`getSvg` prop 으로 SVG 탐색 로직을 override 가능 (mermaid 같이
`dangerouslySetInnerHTML` 안에 svg 가 있을 때 별도 selector 가 필요하면).
기본은 `closest('[data-export-root]') → querySelector('svg')`.

## i18n keys (WIDGET-08)

`apps/web/src/lib/i18n/ko.ts` / `en.ts` — `editor.export.{menu,png,svg,csv,tsv}`.
드롭다운 항목 라벨은 `t(\`editor.export.${fmt}\`)` 로 lookup.

## Gotchas

- **EChartsView 는 canvas 출력** — SVG renderer 가 아니라 `CanvasRenderer` 를
  쓰므로 WidgetExportMenu 의 SVG-기반 PNG 경로가 작동 안 함. 대신
  ChartBlockEditor.tsx 가 `chartRef.current?.getPng()` (echarts `getDataURL`) 로
  직접 export. read-mode echarts 차트는 현재 export 메뉴 없음 (편집기로 가서
  사용 — 디자인 결정).
- **mermaid SVG** — `dangerouslySetInnerHTML` 로 주입돼서 React tree 밖에 있지만,
  `data-export-root="flow"` 래퍼 안의 `querySelector('svg')` 가 정상적으로 잡음.
- **`svgElementToString` 는 clone 후 xmlns 부착** — 라이브 DOM 을 더럽히지 않음
  (테스트가 검증).
- **`downloadBlob` 의 revoke 는 microtask 지연** — Safari 가 다운로드 시작
  전에 URL 이 사라지는 케이스 회피. queueMicrotask 가 `a.click()` 이후
  task queue 에 들어가도록.
- **CSV 의 UTF-8 BOM 미부착** — Excel for Windows 가 한글을 깰 수 있음.
  사용자 보고 들어오면 BOM (`﻿`) prefix 추가 옵션 검토.
- **PNG scale 은 1–4 클램프** — 너무 큰 캔버스 (예: scale=100) 가 OOM 일으키지
  않도록.
- **table sparse 모드 (merged cells) 는 CSV export 비활성** — `block.cells` 가
  있으면 메뉴 자체를 노출 안 함. flat headers + rows 만 안전하게 직렬화 가능.

## 테스트 지도

| 파일 | 케이스 수 | 무엇 |
| --- | --- | --- |
| [[src/lib/__tests__/widgetExport.test.ts]] | 11 | csvCell/tsvCell, rowsToCsv, kpiCardsToCsv (trend 자동 컬럼), ganttTasksToCsv, flatTableToCsv, chartLabeledToCsv (xAxisLabel default 'x', 빈 셀) |
| [[src/components/blocks/__tests__/WidgetExportMenu.mount.test.tsx]] | 4 | kpi/gantt/chart 위젯 SSR 출력에 `data-export-root` + `data-widget-export-toggle` 마커 존재 검증 |
| [[src/components/blocks/__tests__/AllBlocksRender.test.tsx]] | (snapshot) | 5개 widget snapshot 이 메뉴 wrapper 포함하도록 갱신됨 (kpi-cards/chart/gantt/org-chart/table) |
