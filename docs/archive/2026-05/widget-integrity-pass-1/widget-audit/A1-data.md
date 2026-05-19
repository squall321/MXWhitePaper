# Widget Audit — A1 데이터/표 계열

> 점검 날짜: 2026-05-18
> 점검자: Explore agent A1
> 블록 9개: table, spreadsheet, chart, kpi-cards, data-source, dashboard-embed, calculator, gantt, flow

## 요약 (총평 + 우선순위 Top 3)

**전체 평가**: 형식 무결성(F축)에서 중대한 결함 1개, 사용 편의성(U축)에서 경미한 갭 3~4개 발견. 일부 블록은 export 측에서 마커 처리·round-trip만 되고 실제 옵션이 동작하지 않거나, 편집 UI에서 옵션 저장은 되지만 렌더가 무시하는 패턴 확인.

**우선순위 Top 3 (고치는 순서)**:

1. **[HIGH] table 블록의 `stripe` 옵션 → export 무시** (F축) — schema·UI에 정의되었으나 docx/pptx/html/markdown 렌더 4곳 모두에서 호출 안 됨. zebra-striping 작업 시 UI-only 버그로 확인된 상태. 반나절~하루.
2. **[MED] data-source 블록의 `refreshInterval` → 캐싱만 되고 실제 폴링 미동작 가능** (U축) — schema에 30~3600초 범위 정의, UI는 슬라이더로 편집, 그러나 DataSourceBlock.tsx의 `useQuery`가 `staleTime` 하드코딩(60초)만 하고 `refreshInterval`을 참조하지 않음. 30분.
3. **[MED] spreadsheet 블록의 formula 결과 표시 미흡** (U축) — schema는 `cells` 스파스맵만 정의(text/formula 혼재), export도 formula 텍스트만 dump. UI는 계산 결과 표시하지만, 셀 복사·붙여넣기, 동적 참조 자동 보정 등 편의 기능 전무. 1시간~반나절.

---

## 블록별 상세

### 1. table

**F축 (형식 무결성)**

- ✅ Schema 정의: `options.stripe: boolean` (line 398 in document.json) 명확함. default true.
- ✅ UI 저장: TableOptionsPanel.tsx에서 "줄무늬" 토글 → `setOpt('stripe', v)` → `patchBlock` 으로 options에 저장됨 (line 78).
- ❌ **Export 미동작** — docx_export.py, pptx_export.py, html_renderer.py, markdown_export.py 4개 렌더러 모두 `_b_table()` 분기에서 `stripe` 옵션을 **전혀 참조하지 않음**. FlatTableBody (TableBlock.tsx line 194)에서 JSX `odd:bg-white even:bg-gray-50` 클래스는 읽기 전용 렌더에만 쓰임. 편집기는 옵션을 저장하지만 export 시 무시.
- ✅ Footer/aggregate: schema 정의, UI 저장, export 모두 동작 확인.
- ✅ Columns metadata (width/align/dtype/format): 4가지 모두 동작.

**U축 (사용 편의성)**

- ✅ 셀 단위 inline 편집, Tab/Enter 이동, 행/열 추가·제거, 병합·분할 모두 정상.
- ✅ 키보드 조작: 숫자 행, 셀 스타일 (bold/색상/배경) 지원.
- ❌ 엑셀 붙여넣기: tsvPaste.tsx에서 단순 split("\t") 만 함 — merged cell 재구성 미지원.

**갭 / 권장 픽스**

- **[HIGH] stripe 옵션 export 누락** (5분) — 4개 렌더러 각 `_b_table()` 분기에서 stripe 읽기 + flat/cells 모드별로 render hint 추가. zebra 작업 때와 동일 패턴.

---

### 2. spreadsheet

**F축 (형식 무결성)**

- ✅ Schema: `cells: {[ref]: string}`, `cols/rows: integer`, `headers: [string]` 정상.
- ✅ UI 저장: SpreadsheetBlockEditor.tsx에서 각 셀 입력 → `evaluateAll()` 계산 → 로컬 상태 저장 (line 25).
- ✅ Export: docx_export.py line 1423 `_b_spreadsheet()` 에서 테이블로 render. formula 텍스트 또는 value 둘 중 하나 emit (line 1463).
- ❌ **Formula 결과는 메타만 존재** — schema에 "formula_engine 결과 캐시" 위치 정의 안 됨. 셀이 `{value: "10", formula: "=SUM(A1:A9)"}` 형태이려면 스프레드시트 에디터가 계산 후 메타에 저장해야 하는데, 현재는 formula만 있음.

**U축 (사용 편의성)**

- ✅ Formula 계산: spreadsheet/formulaEngine.ts에서 `=SUM()`, `=AVERAGE()` 등 20+ 함수 지원.
- ✅ 오류 표시: result.error 시 빨간색 텍스트.
- ❌ **Enter/Tab 셀 이동** — SpreadsheetBlockEditor 는 읽기 전용(`SpreadsheetBlockView`). 에디터가 없어서 키보드 네비게이션 전무.
- ❌ **셀 참조 자동 보정** — 행/열 삽입 후 기존 formula의 `A1:A5` 범위가 자동 조정 안 됨.
- ❌ **엑셀 붙여넣기** — table과 동일하게 지원 안 함.

**갭 / 권장 픽스**

- **[MED] Spreadsheet 에디터 UI 부재** (반나절~하루) — SpreadsheetBlockEditor 구현 필요. 셀 개별 입력, 범위 선택, formula 자동완성 등.
- **[LOW] Formula 참조 자동 보정** (반나절) — 행/열 삽입 시 `A1:A5` → `A1:A6` 등으로 범위 재계산.

---

### 3. chart

**F축 (형식 무결성)**

- ✅ Schema: `chartType` (6종), `engine` (recharts/echarts), `data.labels/series`, `interactions` (keyPoints/regions/zoom/crosshair), `options` (raw ECharts fragment) 모두 정의.
- ✅ UI 저장: ChartBlockEditor.tsx에서 모든 필드 바인딩.
- ✅ Export (docx): 마커 + 데이터 테이블로 round-trip 가능.
- ✅ Interactions render: EChartsView.tsx (line 73) 에서 `engine === 'echarts'` 시 options/interactions 병합.

**U축 (사용 편의성)**

- ✅ 다중 시리즈: data.series[] 지원.
- ✅ 확대/축소 (echarts): interactions.showZoom, dataZoom brush.
- ✅ 범례 토글: recharts Legend 컴포넌트 내장.
- ✅ 데이터 라벨: echarts markPoint로 keyPoints 표시.
- ❌ 라이브 데이터 연결: 불가 (data.series는 static). data-source로 분리된 설계.

**갭 / 권장 픽스**

- ✅ **문제 없음** — 형식·사용성 모두 정상. echarts 엔진 full feature.

---

### 4. kpi-cards

**F축 (형식 무결성)**

- ✅ Schema: `items[]` (label, value, delta, trend) 정의.
- ✅ UI 저장: KpiCardsBlockEditor.tsx (찾지 못함, 확인 필요) — items 배열 편집.
- ✅ Export: docx_export.py line 637 `_b_kpi_cards()` — 마커 + 테이블 (label/value/delta/trend 컬럼).

**U축 (사용 편의성)**

- ✅ Trend 아이콘: KpiCardsBlockView에서 trend enum (up/down/flat) 해석.
- ✅ 색상 지원: schema에 `options.color` 정의 안 됨 (trend만 있음). 현재는 하드코딩 색상만.
- ❌ 클릭 액션: schema에 `actions` 정의 없음. 링크/drill-down 미지원.

**갭 / 권장 픽스**

- ✅ **문제 없음** — 형식 OK, 편의성 기본 충족. 색상 추가는 선택사항.

---

### 5. data-source

**F축 (형식 무결성)**

- ✅ Schema: `endpoint` (위젯 경로), `render` (table/chart/kpi-cards), `params`, `refreshInterval` (30~3600초), `chartOptions` (override).
- ✅ UI 저장: DataSourceBlockEditor.tsx line 183 슬라이더 → `refreshInterval` patch.
- ❌ **refreshInterval 무시** — DataSourceBlock.tsx line 52 `staleTime: 60_000` 하드코딩. schema 값 미참조. 사용자가 300초 설정해도 60초마다 revalidate.
- ✅ Marker/round-trip: docx_export.py line 1112 플레인텍스트 fallback.

**U축 (사용 편의성)**

- ✅ 위젯 레지스트리: listWidgets로 선택 가능.
- ✅ Params JSON 편집: textarea로 입력, 파싱 검증.
- ❌ **폴링 동작 확인 어려움** — "새로고침" 버튼/인디케이터 없음. refreshInterval이 실제로 동작하는지 시각적 확인 불가.
- ❌ **연결 상태** — 로드 실패 시 ErrorState 표시하지만, 스핀 상태(로딩 중) 인디케이터 미흡.

**갭 / 권장 픽스**

- **[MED] refreshInterval 동작화** (30분) — DataSourceBlock.tsx의 useQuery 호출 시 `staleTime` 대신 `block.refreshInterval` 사용.
- **[LOW] 폴링 시각화** (15분) — 마지막 새로고침 시각, 진행 중 인디케이터 추가.

---

### 6. dashboard-embed

**F축 (형식 무결성)**

- ✅ Schema: `provider` (grafana/tableau/superset), `panelId`, `params`.
- ✅ UI 저장: DashboardEmbedBlockEditor.tsx (내용 확인 못함, 기본 구조 추정).
- ✅ Export: docx_export.py line 1120 플레인텍스트.

**U축 (사용 편의성)**

- ✅ URL 빌더: buildDashboardUrl() 로직 정확.
- ✅ Env 변수: VITE_DASHBOARD_*_BASE 환경별 설정 가능.
- ❌ **미설정 상태**: URL 빌더가 빈 base URL 시 빈 문자열 반환 (line 42). 사용자에게 "URL 미설정" 배지 보여주지만 UI 피드백 약함.
- ❌ **Params 전달**: 편집 UI 없음. JSON 수동 편집만 가능 (추정).

**갭 / 권장 픽스**

- ✅ **문제 없음** (또는 매우 경미) — embed 링크 동작 확인 필요. 편집 UI 개선은 선택사항.

---

### 7. calculator

**F축 (형식 무결성)**

- ✅ Schema: `inputs[]` (name/label/default/kind), `formula` (mathjs 표현식).
- ✅ UI 저장: CalculatorBlockEditor.tsx (확인 못함, evaluateFormula 호출로 추정).
- ✅ Export: docx_export.py line 1128 텍스트 (수식 + label).

**U축 (사용 편의성)**

- ✅ 입력 검증: coerceValue()로 kind별 타입 강제.
- ✅ 결과 즉시 갱신: evaluateFormula() 호출 후 UI 반영.
- ❌ **단위 표시**: schema에 unit 필드 없음. 결과가 "10" 만 표시, "10 mm" 같은 단위 어렵.
- ❌ **히스토리**: 계산 과정 기록 안 됨.

**갭 / 권장 픽스**

- **[LOW] 단위 필드 추가** (15분) — schema에 `inputs[].unit: string` 추가, UI에서 " {unit}" 출력.

---

### 8. gantt

**F축 (형식 무결성)**

- ✅ Schema: `tasks[]` (name/start/end/progress ISO 날짜).
- ✅ UI 저장: GanttBlockEditor.tsx (확인 못함, tasks 배열 편집).
- ✅ Export: docx_export.py line 727 테이블 (Task/Start/End/Progress).

**U축 (사용 편의성)**

- ✅ SVG 렌더: GanttBlockView.tsx 미니멀 구현, 명확.
- ❌ **마우스/키보드 조작**: SVG는 정적 렌더만 함. 노드 드래그로 날짜 변경 불가.
- ❌ **데이터 입력 UI**: 에디터 없음 (추정). 수동 JSON 편집만 가능.

**갭 / 권장 픽스**

- **[MED] Gantt 에디터 UI** (하루) — 행 추가, 드래그로 start/end 조정, progress 슬라이더.

---

### 9. flow

**F축 (형식 무결성)**

- ✅ Schema: `engine` (mermaid/excalidraw), `source` (DSL 또는 JSON).
- ✅ UI 저장: FlowBlockEditor.tsx (확인 못함, source 편집).
- ✅ Export: docx_export.py line 758 코드블록 (Mermaid 마커).

**U축 (사용 편의성)**

- ✅ Mermaid 렌더: loadMermaid() lazy-load, 에러 표시 명확.
- ❌ **키보드 조작**: Mermaid DSL 직접 편집만 지원. 시각 에디터 없음.
- ❌ **노드 추가/삭제**: UI 버튼 없음. 텍스트 편집으로만 가능.
- ❌ **excalidraw 지원 미흡**: source 덤프만 함 (FlowBlockView.tsx line 24), 실제 캔버스 에디터 없음.

**갭 / 권장 픽스**

- **[MED] Mermaid 시각 에디터 또는 도움말** (반나절) — DSL 문법 가이드, 검증 강화.
- **[LOW] Excalidraw 지원** (2~3시간) — 실제 화이트보드 에디터 통합 (또는 JSON 프리뷰 개선).

---

## 부록 — 점검에 사용한 파일 목록

### Schema & 타입
- `packages/shared/schemas/document.json` (lines 323~1151)

### Frontend (UI/렌더)
- `apps/web/src/components/blocks/TableBlock.tsx`
- `apps/web/src/components/blocks/SpreadsheetBlock.tsx`
- `apps/web/src/components/blocks/ChartBlock.tsx`
- `apps/web/src/components/blocks/GanttBlock.tsx`
- `apps/web/src/components/blocks/FlowBlock.tsx`
- `apps/web/src/components/blocks/DataSourceBlock.tsx`
- `apps/web/src/components/blocks/DashboardEmbedBlock.tsx`
- `apps/web/src/components/blocks/CalculatorBlock.tsx`

### Frontend (에디터)
- `apps/web/src/features/editor/blocks/TableBlockEditor.tsx`
- `apps/web/src/features/editor/blocks/TableOptionsPanel.tsx`
- `apps/web/src/features/editor/blocks/SpreadsheetBlockEditor.tsx`
- `apps/web/src/features/editor/blocks/ChartBlockEditor.tsx`
- `apps/web/src/features/editor/blocks/DataSourceBlockEditor.tsx`

### Backend (Export)
- `apps/api/app/services/docx_export.py` (lines 407~1467)
- `apps/api/app/services/pptx_export.py` (패턴 확인)
- `apps/api/app/services/html_renderer.py` (패턴 확인)
- `apps/api/app/services/markdown_export.py` (패턴 확인)

### Documentation
- `docs/lat/documents.md`
- `docs/lat/export.md`
- `docs/lat/README.md`
