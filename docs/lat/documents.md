# Documents lat — DocumentJSON v1.0 + CRUD + versioning

> 중심 엔티티 `documents` 테이블과 사내 표준 본문 포맷 **DocumentJSON v1.0**
> 의 검증, 저장, 조회, 패치, 버저닝, 검색 인덱싱.
>
> 연관 lat: [[imports]] (입력) · [[export]] (출력) · [[storage]] (이미지) ·
> [[core]] (auth/etag/errors)

## Endpoints

전부 [[src/app/routers/documents.py]] (`/api/v1/documents`).

| Method | Path | 인증 | 역할 |
|---|---|---|---|
| GET | `/` | reader+ | 목록 (필터/페이지네이션) |
| GET | `/{slug}` | reader+ | 단일 조회 (role 별 block redaction 적용) |
| GET | `/{slug}/export.html` | reader+ | 서버 사이드 HTML 렌더 (PDF/외부 임베드 용. `?style=namuwiki&inline_images=1&katex=cdn&mermaid=cdn` 쿼리 지원) |
| POST | `/` | editor+ | 신규 생성 |
| PUT | `/{slug}` | editor+ | 전체 교체 — 버전 INSERT |
| DELETE | `/{slug}` | editor+ | soft-delete (archive) |
| GET | `/{slug}/backlinks` | reader+ | 다른 문서가 인용한 링크 |
| GET | `/{slug}/versions` | reader+ | 버전 목록 |
| GET | `/{slug}/versions/{n}` | reader+ | 특정 버전 |
| POST | `/{slug}/versions/{n}/restore` | editor+ | 버전 복원 (= 새 버전 INSERT) |
| PATCH | `/{slug}/title` | editor+ | 제목/요약 인라인 수정 |
| PATCH | `/{slug}/infobox` | editor+ | 우측 사이드 정보 박스 |
| PATCH | `/{slug}/variables` | editor+ | 본문 템플릿 변수 |
| PATCH | `/{slug}/custom-css` | admin | 문서별 CSS (관리자 전용 — UI/스타일 변조 방지) |
| PATCH | `/{slug}/sections/{section_id}` | editor+ | 섹션 부분 수정 |
| PATCH | `/{slug}/blocks/{block_id}` | editor+ | 블록 부분 수정 |
| POST | `/{slug}/blocks` | editor+ | 블록 추가 |
| DELETE | `/{slug}/blocks/{block_id}` | editor+ | 블록 삭제 |
| POST | `/{slug}/blocks/{block_id}/move` | editor+ | 블록 이동 (섹션 간/내) |
| POST | `/{slug}/sections/reorder` | editor+ | 섹션 트리 재배열 |
| POST | `/{slug}/view` | reader+ | 조회수 카운트 (analytics 용 ping. 핸들러명은 `ping_view`) |

모든 mutation 엔드포인트는 **ETag + If-Match** 로 낙관적 잠금. 형식:
`W/"<doc_id>-<version>"`. 클라이언트가 stale ETag 를 보내면 409.

## DocumentJSON v1.0 schema

[[src/app/schemas/document.py]] 에 pydantic 모델 정의. 필수 키:

```text
{
  "schema_version": "1.0",
  "id":             "<ULID>",
  "slug":           "<lower-case-slug>",
  "title":          "<문서 제목>",
  "metadata": {
    "division":        "MX" | "<코드>",
    "owners":          ["email@…"],
    "tags":            ["…"],
    "confidentiality": "public" | "internal" | "restricted",
    "team":   "...",        // optional
    "group":  "...",        // optional
    "part":   "...",        // optional
  },
  "summary": "...",         // optional, 500자 컷
  "sections": [
    {
      "id":     "<ULID>",
      "level":  1..6,
      "title":  "...",
      "blocks": [ { type: "...", ... }, ... ],
      "subsections": [ … ]
    }
  ]
}
```

### Block types

[[src/app/schemas/document.py]] 에 정의된 주요 block 클래스:

- `ParagraphBlock` — markdown-flavored inline (`**굵게**`, `*기울임*`,
  `` `code` ``, `[link](url)`)
- `Heading4Block` — depth-4 이상 헤딩은 sub-section 으로 자동 승격되므로
  실제로는 임시. 자세히는 [[#heading-promotion]]. ★ FE editor
  ([[src/features/editor/blocks/Heading4BlockEditor.tsx]]) 가 호버/포커스 시
  **H2 / H3 / H4 dropdown** 노출 — 인라인 헤딩의 level 변경 가능 (widget-integrity-pass-2 M8).
  legacy `meta.level` 도 읽음.
- `ListBlock` — `style: "bullet"|"number"|"check"`, `items[]`
- `QuoteBlock` — `text`, `cite?`. ★ FE editor
  ([[src/features/editor/blocks/QuoteBlockEditor.tsx]]) 가 widget-integrity-pass-2 M9
  사이클에서 추가됨 — text textarea + cite input, 600 ms debounced patchBlock.
  빈 cite 는 `undefined` 로 정규화 (read 측의 `block.cite` truthy 체크와 일관).
- `CalloutBlock` — `variant: "info"|"warn"|"danger"|"tip"`, `title?`, `text`
- `CodeBlock` — `language`, `code`
- `MathBlock` — LaTeX `expression`, `display: "block"|"inline"`
- `TableBlock` — `headers[]`, `rows[][]`, `caption?`, `options{}` (sortable,
  searchable, density, stickyFirstCol, rowNumbers, **stripe** (default `true`,
  zebra-striped data rows; header row 미영향), borderStyle,
  **conditionalFormatting?** — gt/gte/lt/lte/eq/neq/between/top_n/bottom_n/contains/
  not_contains 규칙 배열 (FE-only Phase 1, helper:
  [[apps/web/src/components/blocks/conditionalFormatting.ts#applyConditionalFormatting]];
  sparse `cells[].bg/color/bold` override 우선)).
  ★ Phase 2 (WIDGET-02): Excel-style preset 5종 (상위 10%, 하위 10%, 평균 초과,
  0 이하, 중복) 빠른 적용 — pure helper
  [[apps/web/src/components/blocks/conditionalPresets.ts#buildPresetRules]] +
  editor panel
  [[apps/web/src/features/editor/blocks/ConditionalFormattingPresetsPanel.tsx#ConditionalFormattingPresetsPanel]]
  ([[apps/web/src/features/editor/blocks/TableBlockEditor.tsx]] 의 flat/sparse 양쪽
  분기에서 `TableOptionsPanel` 바로 아래에 렌더). "중복" 은 schema 에 `duplicates`
  operator 가 없으므로 컬럼 스캔 → 중복 값마다 `eq` rule 한 개씩 expand.
  두 가지 셀 모드:
  1. **flat**: `headers` + `rows` (단순 텍스트 그리드)
  2. **sparse**: `cells[]` — 각 항목 `{r, c, text?, blocks?, header?, rowSpan?, colSpan?}`.
     ★ 셀은 `text` **또는** `blocks` 중 하나만 — `blocks` 가 있으면
     [[src/app/services/document_service.py#_normalise_table_cells]] 가
     `text` 를 자동 제거해 one-of 계약 유지. `CellBlock` 은 `ParagraphBlock`
     / `ImageBlock` / `ListBlock` 셋으로 제한 (테이블 안 테이블 금지).
  ★ `options.stripe` 는 4 export (docx / html / pptx / markdown) 모두 반영됨
  — [[export#table-rendering-깊이]] 참고.
- `SpreadsheetBlock` — 편집 가능한 *살아있는* 표. `cols` (1-26), `rows` (1-200),
  `cells: { "A1": "42", "B2": "=SUM(A1:A10)" }` (sparse cell-ref map), `headers?`,
  `title?`, `options.stripe` (default `true` — zebra data rows, header 미영향).
  ★ 지원 함수 25종 추가 (formulaEngine.ts) — 기술통계 (MEDIAN/MODE/STDEV/STDEVP/
  VAR/VARP/QUARTILE/PERCENTILE/LARGE/SMALL/PERCENTRANK/RANK), 상관/회귀 (CORREL/
  PEARSON/RSQ/SLOPE/INTERCEPT/STEYX), lookup (VLOOKUP/HLOOKUP/INDEX/MATCH/XLOOKUP/
  XMATCH/CHOOSE). 도트 별칭 (STDEV.S, MODE.SNGL 등) 은 tokenizer 직전 rewrite.
  TableBlock 과 달리 docx import 가 만들지 않고 사이트 에디터에서 직접 추가/편집.
  docx export 는 `_b_spreadsheet()` 가 `stripe=True` → `Light Grid Accent 1`,
  `False` → `Table Grid` 로 분기. 에디터 toolbar 의 "⬇ CSV / ⬇ TSV" 버튼은
  [[src/features/editor/blocks/spreadsheet/csvExport.ts#spreadsheetToDelimited]]
  를 호출 — *평가된 값* (formula 결과) 으로 직렬화해 Excel/Google Sheets paste
  호환. CSV 는 RFC 4180, TSV 는 탭/CR/LF 를 공백으로 강제 escape. UTF-8 BOM
  포함해 Excel mojibake 회피.
- `PivotTableBlock` — ★ 36번째 블록 (pivot-table-sprint1 47번 archive +
  pivot-table-sprint2-4 48번 archive + Sprint 5: date 그룹 + calculatedItems +
  Sprint 6: data-source 참조).
  키: `type`, `source` (oneOf: `{kind:"inline"|"csv", rows[], schema?}` 또는
  Sprint 6 의 `{kind:"data-source", dataSourceId: ULID}` — 같은 문서 안
  DataSourceBlock 결과를 viewer 가 useQuery 로 hydration 후 inline 으로
  변환해 engine 에 넘김. 동일 query key (`['data-source', endpoint,
  paramsKey]`) 라 DataSourceBlockView 와 캐시 공유), `rows[]`
  (행 차원 — 단순 field 문자열 *또는* `{field, group?}` object: group ∈
  year/quarter/month/week/day 로 시간 자동 bucket), `cols[]` (열 차원, rows
  와 동일 union), `calculatedItems?[]` (행/열 가상 항목, `{axis, name,
  formula}`. formula 는 같은-축 항목 라벨을 식별자로 참조하는 산술식 — 백틱
  literal `` `Q1` `` 로 공백/한글/`-` 라벨 처리. 예: `` `Jan` + `Feb` + `Mar`
  ``. 후속 item 이 선행 item 참조 가능 — `` `H1` = `Q1` + `Q2` ``), `values[]`
  (`{field|expr, agg, label?, showAs?, numberFormat?}` — agg 8 종: sum/avg/count/
  countDistinct/min/max/median/stdev; showAs: `pct_row|pct_col|pct_grand|running`;
  numberFormat: `"#,##0.00"|"0.0%"` 등 sister grammar), `totals?` (row/col/grand
  토글), `sort?` (차원/측정값 기준), `filters?` (raw row 필터), `options?`.
  파이프라인: **filter → group → aggregate → sort → totals → calculatedItems**
  (raw row 재집계로 총합 정확성 보장. calculatedItems 는 base 결과 위에
  axis 별로 합성, totals 에는 미포함). helper:
  [[apps/web/src/components/blocks/pivotEngine.ts#buildPivot]] (순수 함수,
  expr eval 은 SpreadsheetBlock sister grammar 재사용). Sprint 5 helper:
  `dimField`/`dimLabel` (union narrowing), `bucketDate(v, group)` (ISO date
  / epoch ms / Date → year/quarter/month/week(ISO)/day 라벨), `parseExpr`
  tokenizer 가 백틱 식별자 지원 (`` `Q1` `` → ident). Sprint 6 helper:
  `sourceRows(block.source)` (inline/csv 일 때 rows 반환, data-source 일 때
  `[]` — viewer 가 useQuery 결과로 synthetic clone 만든 후 buildPivot 호출),
  `payloadToRows(payload)` (DataSource response `{rows:[{...}]}` 또는 tabular
  `{headers, rows:[[...]]}` 어느 쪽이든 flat object[] 로 변환). viewer:
  [[apps/web/src/components/blocks/PivotTableBlock.tsx]] — cross-tab + row/col/
  grand total amber 하이라이트 + showAs (pct_*/running) 변환 + numberFormat 적용.
  editor: [[apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx]] —
  source paste (CSV/JSON) + **Available Fields drag panel + Rows/Cols/Values 드롭존**
  (`@dnd-kit/core` augment, 기존 dropdown 은 keyboard fallback 으로 유지) +
  SourceKindPicker (Sprint 6 — inline/csv/data-source 라디오 + 같은 문서 안
  DataSourceBlock id select) + DimPicker (chip 옆 시간 그룹 dropdown —
  Sprint 5) + ValuesPicker (field/expr 2 모드) + TotalsPicker + SortPicker +
  FiltersPicker + CalculatedItemsPicker (Sprint 5 — axis/name/formula row) +
  BoundSlicersPicker (Sprint 6 G2 — 같은 문서 SlicerBlock 체크박스 multi). 순수 reducer
  [[apps/web/src/features/editor/blocks/PivotTableBlockEditor.tsx#applyPivotDragEnd]] —
  dnd-kit DragEndEvent id 두 개 → 다음 pivot block (no-op 시 같은 reference 반환).
  widgetExport CSV 매트릭스 직렬화
  (cycle 3, [[apps/web/src/features/widgetExport.ts]]). drill-down: viewer 의
  data cell 클릭 → [[apps/web/src/components/blocks/pivotEngine.ts#drillRows]] 가
  filter 재적용 + dim 매칭으로 raw rows 추출 → `Modal`
  ([[apps/web/src/components/ui/Modal.tsx]]) 에 field-by-row table 표시 (Esc /
  backdrop 닫기, focus trap). total cell 은 클릭 affordance 없음.
- `BibliographyBlock` — `entries[]` ( `{key?, text, doi?, url?}` ), `title?`, `style?`,
  `options.stripe?` (default `true`, FE-only zebra). 본문의 `[[cite:KEY]]` 가
  `<li id="cite-{key}">` anchor 로 연결. ★ 4 export (docx / html / pptx / markdown)
  모두 핸들러 존재 (이전엔 docx 만 존재했음).
- `ImageBlock` — `imageId` (camelCase, ULID/UUID), `alt?`, `caption?`, `width?`
  (sm=200px / md=400px / lg=600px / full). docx export 도 `width` enum 을
  Picture 너비로 반영 (sm/md/lg/full).
- `ImageAnnotationBlock` — `imageId` (★ camelCase — 이전 `image_id` 폐기.
  legacy 데이터는 `validate_documentjson()` 진입부의
  [[src/app/services/document_service.py#_normalise_image_annotation_ids]] 가
  in-place 로 키 rename), `annotations[]` ( `{kind, x, y, label?, color?, ...}` ).
  ★ callout-kind annotation 의 키는 widget-integrity-pass-2 M5 에서 `text` → `label`
  로 통일됨 (arrow/rect 는 이전부터 `label`). legacy `text` 키가 남은 문서는
  [[src/app/services/document_service.py#_normalise_image_annotation_labels]] 가
  read 시점에 in-place 로 `label` 로 rename (정규화 헬퍼 — 마이그레이션 X).
  **다크 모드 의도 예외 + 사용자 override**: callout 라벨 배경이 default `fill="white"`
  하드코딩 — 사용자 이미지 위에 그려지는 라벨의 가독성 보장 (사용자 ann.color 가
  어떤 색이든 흰 배경 + 그 색 텍스트 = 항상 식별 가능). svg-block-audit 사이클에서
  *유지 결정* 후, image-annotation-label-bg 사이클에서 callout 변형에 optional
  `bgColor?: string` 추가. image-annotation-bg-editor 사이클에서 editor UI 도입 —
  callout 도구 선택 시 toolbar 에 3 swatch (default 흰색 / 다크 `#111827` /
  강조 노랑 `#fef3c7`) 표시. `buildCallout(pos, text, color, bgColor?)` 시그니처
  확장, undefined 시 schema 에 키 자체 미저장 (default 보존).
- `SpacerBlock` — `size: "sm"|"md"|"lg"|"xl"` (16/32/64/128 px, default `md`).
  본문 흐름의 명시적 여백. FE editor (SpacerBlockEditor.tsx) 가 dropdown 으로
  4 옵션 노출 (pass-3 N1 확장).
- `FigureIndexBlock` — 본문의 캡션 있는 image/table/chart 자동 목차. `kinds?`
  필터, `title?`, `options.stripe?` (default `true`, 그룹 내 항목 zebra — 그룹별
  카운터 리셋). FE 의 FigureIndexBlock 에 🔄 갱신 버튼 — MutationObserver
  로 본문 변화 캐치 후 collect() 재실행. 편집 모드에서는
  [[src/features/editor/blocks/FigureIndexBlockEditor.tsx]] 가 title + zebra 토글만
  노출 (entries 는 런타임 DOM 스캔, kinds 편집은 yagni 로 out-of-scope).
- `CalloutBlock` — `variant: "info"|"warn"|"danger"|"tip"`, `title?`, `text`.
  docx export 시 `Widget: callout (variant)` hidden marker emit (검증:
  `test_renderer_callout_emits_hidden_marker_run`).
- `KpiCardsBlock` — `items[]` (label, value, trend, **`sparkline?` `{values:number[],
  kind: "line"|"bar"|"win-loss", color?: string, palette?: string[]}`**),
  `options.stripe?` (default `true`, 카드 단위 `:nth-of-type(2n)` blue-050 zebra —
  grid 컬럼 수와 무관). ★ sparkline 은 kpi-cards-sparkline 사이클 (cycle 2) 추가 —
  카드 우하단 inline mini-chart, line/bar/win-loss 3 종, SVG 직접 렌더. **★ color
  override 는 sparkline-color-picker 사이클 추가** — `color` 미지정시 trend 색
  (emerald/red/gray) → `currentColor` fallback. `palette` 는 bar kind 한정 per-bar
  cycle (line/win-loss 무시), `color` 보다 우선. editor 는 4-preset 스와치 (chart
  PALETTE 의 #1428A0 / #10B981 / #F59E0B / #DC2626) + custom hex input 노출.
  ★ **I (cycle b)** — `source`/`filters`/`boundSlicers` (block 레벨) +
  `items[i].compute: {field, agg?, when?}` (per-card). compute 있는 카드는
  viewer 가 source rows 에 filters+boundSlicers 적용 후 (field, agg) 로
  재계산해 정적 value 를 덮어쓴다. `when` 은 카드만의 추가 in-filter (예:
  마감/진행 분리). 정적 카드와 compute 카드는 한 block 안에 공존 가능.
  helper: [[apps/web/src/components/blocks/KpiCardsBlock.tsx#useHydratedKpiCardsBlock]].
- `ListBlock` — `style: "bullet"|"number"|"check"`, `items[]` (depth 는 indent
  prefix), `options.stripe?` (default `true`, depth=0 항목 한정 zebra — 중첩 항목
  무영향).
- `IframeBlock` — embed via `src` (URL) **XOR** `html` (sanitized snippet).
  schema 가 `oneOf` 로 두 변종을 강제하고, pydantic v2 의 codegen 한계
  (`not: required` 가 떨어짐) 는 [[packages/shared/codegen/generate-py.py]] 가
  `IframeBlock1` (src branch) / `IframeBlock2` (html branch) 양쪽에
  `@model_validator(mode='after')` 를 후처리 주입해 양쪽 모두 set 인 입력을
  거부 (widget-integrity-pass-2 M2). neither 는 codegen 의 required 가 자동 거부.
- `VideoBlock` — `src` (URL), `autoplay?` (default `false`), `controls?`
  (default `true`), `loop?` (default `false`). 옵션 3 개는 widget-integrity-pass-2 M4
  에서 추가됨. browser 정책상 `autoplay=true` 가 muted 없이는 차단될 수 있음.
  기존 video 문서 (옵션 없음) 는 default 로 통과.
- `DataSourceBlock` — 외부 endpoint 폴링 위젯. `endpoint`, `render` (`chart`/
  `table`/`kpi`), `refreshInterval?` (초, schema default 60, min 30).
  ★ widget-integrity-pass-2 M1 에서 FE 폴링 로직이
  [[src/components/blocks/DataSourceBlock.tsx#derivePollingConfig]] 순수 함수로
  추출되어 `refreshInterval` 이 실제 react-query `refetchInterval` 에 반영됨.
- `GlossaryRefBlock` — `term` (lookup key). schema 에는 `definition` 필드
  *없음* (이전 docx_export dead branch 정리, widget-integrity-pass-2 M11).
  FE 컴포넌트가 미정의 term 을 ⚠️ + 회색 (border-gray-400, bg-gray-100) +
  "(용어 사전에 없음)" 으로 시각화, `data-glossary-ref-broken` 속성 노출.
- `GanttBlock` — `tasks[]` (`{name, start, end, progress?}`), `options.stripe?`
  (default `true`, SVG `<rect fill="var(--smsg-gray-050)">` 로 task row 음영 —
  `<rect>`는 SVG 첫 자식이라 axis line / 막대 뒤에 paint), `options.axisUnit?`
  (`day|week|month|quarter`, default `month`). 다크 모드 자동 대응:
  모든 SVG fill/stroke 가 `var(--smsg-...)` 토큰 — `tokens.css` `.dark` 변형이
  자동 치환. figure 배경도 `dark:bg-gray-900 dark:border-gray-700`. 에디터
  task row 는 keyboard-focusable (`tabIndex=0`, `role="button"`) — ←/→ 로
  end ±1일, Shift+←/→ 로 start+end 동시 ±1일 (`ganttKeyToPatch` 순수 헬퍼,
  widget-integrity-pass-4 G1). x-axis ticks 는
  [[src/components/blocks/ganttAxis.ts#axisTicks]] 가 `[minMs, maxMs]` 구간의
  단위 경계만 emit; tick 이 40개 초과면 자동으로 한 단계 큰 단위로 fallback.
- `OrgChartBlock` — tidy-tree 레이아웃의 순수 SVG 조직도 (mermaid 아님).
  hover 시 descendant 하이라이트. 다크 모드 자동 (SVG fill/stroke `var(--smsg-...)`
  + figure/empty `dark:` 변형 — chart-darkmode 사이클과 별개로 gantt-darkmode
  패턴 그대로 적용).
- `FlowBlock` — 두 engine 모두 lazy chunk + viewer/editor 분기.
  `engine: 'mermaid'` → viewer: mermaid DSL → 정적 SVG. 다크 모드 변경 시
  `initialize({theme: 'dark'\|'default'})` 재실행 + `idRef.current` 재생성
  (singleton 캐시 회피) + `render()` 재실행. editor: FlowMermaidEditor —
  textarea + live preview, 800 ms debounce patchBlock.
  `engine: 'excalidraw'` → viewer: scene JSON
  (`{elements, appState?, files?}`) 을 `@excalidraw/excalidraw` 의 헤드리스
  `exportToSvg` 로 정적 SVG. 다크 모드는 `appState.theme = 'dark'` +
  `exportWithDarkMode: true`. editor: FlowExcalidrawEditor (Sprint-7) —
  `<Excalidraw>` 캔버스 컴포넌트를 `React.lazy()` 로 mount (CSS 도 동적
  import), onChange 800 ms debounce 후 `patchBlock({engine:'excalidraw',
  source: serialiseScene(scene)})`. parse 실패 시 빈 캔버스로 시작 +
  recovery banner. theme prop 으로 light/dark 자동 동기화.
- `SlicerBlock` — ★ Sprint 6 (G2) 신규. chip 그룹으로 한 field 의 distinct
  values 노출 → 사용자 클릭이 [[apps/web/src/features/slicer/store.ts]] 의
  `useSlicerStore` 에 active set 으로 기록. `PivotTableBlock.boundSlicers?[]`
  / `TableBlock.boundSlicers?[]` (G4 추가) 로 listen 하는 widget 은
  hydration 단계에서
  [[apps/web/src/components/blocks/PivotTableBlock.tsx#collectSlicerFilters]]
  가 active values 를 `{field, op:'in', value}` filter 로 변환해 기존 filters
  에 concat. multiSelect=false (default) 면 단일 / true 면 toggle. empty set
  = no filter (Excel 'All' 의미). source 는 inline rows 또는 같은
  DataSourceBlock 의 id 참조.
- `TimelineBlock` — ★ G4 신규. SlicerBlock 의 date-range 변형. 두 range
  슬라이더로 `[isoFrom, isoTo]` 부분구간 선택 → 같은 `useSlicerStore` 에
  2-원소 배열로 기록 (slicer 와 store 공유, picker 도 공유). bound widget
  은 [[apps/web/src/components/blocks/TimelineBlock.tsx#collectTimelineFilters]]
  로 `{field, op:'between', value:[lo, hi]}` filter 를 받아 PivotEngine
  의 between op (G4 신규) 가 처리. 도메인: explicit min/max 또는 rows[field]
  의 min/max 자동 추론. 빈 active set = no filter.
- `WhiteboardBlock` — 사용자가 그린 SVG 요소 모음 (`el.color`, `el.stroke` 직접
  지정). **다크 모드 의도**: 캔버스 `bg-white` 영구 유지 + 사용자 색 자동 변환 X.
  Figma/Excalidraw 관례 — painter 도구는 사용자 색 책임. svg-block-audit 사이클에서
  유지 결정, whiteboard-darkmode-decision 사이클에서 *재확인* (HSL inversion / dark
  캔버스 모두 yagni, 사용자 그린 의도 보존 우선). 향후 사용자 요청 시 escape hatch
  (`darkBehavior?: 'invert'`) 추가 가능 — 현재 미요청.
- `FormBlock` / `FormQuestion` — embedded survey. `questions[]` items support
  optional validation fields (WIDGET-03 cycle 4): `min` / `max` (number kind),
  `minLength` / `maxLength` / `pattern` (text · long-text · email). `pattern`
  is an ECMA-262 RegExp source — BE compiles with length cap 200 +
  `re.compile` try/except (compile/oversize failures are logged and silently
  skipped so author mistakes never block submission). FE/BE rules are
  symmetric (`apps/api/app/routers/forms.py` `_validate_numeric_range` /
  `_validate_text_constraints`; `apps/web/src/components/blocks/FormBlock.tsx`
  `validateAnswers`). Editor exposes inputs conditionally by kind
  (FormBlockEditor `QuestionRow`).
- `ChartBlock` — `chartType: "line"|"bar"|"area"|"pie"|"radar"|"scatter"|
  "xy-line"|"boxplot"`, `data` (series/labels), `options?` (legend, axes,
  fit-range, stats), `engine?: "recharts"|"echarts"` (default recharts; echarts
  unlocks markPoint/markArea/brush/dataZoom).
  ★ `boxplot` 은 chart-boxplot 사이클 (cycle 2) 추가 — Q1/median/Q3/min/max +
  outlier 렌더, single-series numeric array 입력 (`block.options.boxplotMode`
  로 raw / precomputed 선택). helper:
  [[apps/web/src/components/blocks/chartBoxplot.ts#computeQuartiles]].
  ★ `xy-line` 은 시리즈마다 자유로운 `(x, y)` 쌍 — `data.labels` 무시,
  `series[].points: [{x, y, err?, errLow?, errHigh?}]` 사용. stress-strain
  처럼 시료별 측정점이 다른 데이터를 한 그림에 겹쳐 비교 + error bar.
  ★ **H2 (G5)** — `source` / `labelField` / `aggregations[]` / `filters` /
  `boundSlicers[]` optional 추가. 지정 시 viewer 가
  [[apps/web/src/components/blocks/pivotEngine.ts#aggregateChartData]] 로
  raw rows 를 그룹 + 시리즈별 (field, agg) 집계해 `data.{labels, series}`
  를 *덮어쓴* synthetic clone 을 render. boundSlicers 에 SlicerBlock /
  TimelineBlock id 를 적으면 PivotTable 과 동일하게 cross-widget filter.
  source 없으면 today 와 동일 — 100% back-compat.
  ★ **J** — drill-down 모달. line/bar/area chart 클릭 시 activeLabel 을
  추출해 [[apps/web/src/components/blocks/pivotEngine.ts#drillChartRows]]
  로 해당 라벨에 기여한 raw rows 를 추출 → ChartDrillModal (Modal 공용
  컴포넌트) 가 PivotDrillModal 과 동일한 shape 으로 표시. drill 은 source
  + labelField + aggregations 가 모두 있을 때만 활성 (cursor: pointer).
  pie/radar/scatter 는 activeLabel concept 이 다르므로 의도적으로 제외.
- `ColumnsBlock`, `TabsBlock`, `AccordionBlock`, `GalleryBlock`, …

전체 enum 은 [[src/app/schemas/document.py]] 참고. 새 block type 추가 시:
1. 스키마 클래스 + Union 등록
2. [[src/app/services/document_service.py#_scrub_block_array]] 의 redaction 분기
3. [[export]] 의 docx/pptx/md/html 렌더러 4 개에 분기 추가

## 핵심 진입점

| 함수 | 위치 | 책임 |
|---|---|---|
| `create_document()` | [[src/app/services/document_service.py#create_document]] | POST `/` 의 본체 |
| `replace_document()` | [[src/app/services/document_service.py#replace_document]] | PUT `/{slug}` — 새 버전 INSERT |
| `archive_document()` | [[src/app/services/document_service.py#archive_document]] | soft-delete |
| `validate_documentjson()` | [[src/app/services/document_service.py#validate_documentjson]] | 스키마 + 정규화 (renumber, columns widths) |
| `make_etag()` / `parse_if_match()` | [[src/app/services/document_service.py#make_etag]] | ETag 발급/검증 |
| `scrub_for_response()` | [[src/app/services/document_service.py#scrub_for_response]] | 응답 직전 role-기반 redaction |
| `patch_section()`, `patch_block()`, … | [[src/app/services/document_service.py#patch_section]] 부근 | 부분 수정 패밀리 |
| `move_block()`, `reorder_sections()` | [[src/app/services/document_service.py#move_block]] | 트리 재배열 |
| `restore_version()` | [[src/app/services/document_service.py#restore_version]] | 과거 버전 → 새 버전 INSERT |
| `update_links_for_document()` | [[src/app/services/document_service.py#update_links_for_document]] | 본문 위키링크 → `links` 테이블 (alias → canonical redirect 포함) |
| `resolve_term_aliases()` | [[src/app/services/wiki_link_alias.py#resolve_term_aliases]] | approved glossary term 의 aliases 슬러그를 canonical term 으로 rewrite |
| `refresh_search_view()` | [[src/app/services/document_service.py#refresh_search_view]] | materialized view refresh (테스트는 `MXWP_SKIP_VIEW_REFRESH=1`) |
| `reindex_meili()` | [[src/app/services/document_service.py#reindex_meili]] | Meilisearch 색인 |

Repository (DB I/O) 는 [[src/app/repos/document_repo.py]]:
- `find_by_slug()`, `find_by_id()`, `list_documents()` — 조회
- `insert_document()`, `update_document()`, `soft_delete_document()` — 변경
- `insert_version()`, `list_versions()`, `find_version()` — 버전
- `replace_links_for_document()`, `list_backlinks()` — 링크 그래프
- `upsert_tag()`, `replace_document_tags()` — 태그
- `insert_audit()` — 감사 로그

## Section numbering ★

`validate_documentjson()` → `renumber_sections()` ([[src/app/services/section_numbering.py#renumber_sections]])
가 매 저장 시 섹션 번호를 1, 1.1, 1.1.1 형태로 재발급한다. `level` 만 신뢰하고
입력의 `number` 는 무시.

### Heading promotion

본문에 `heading-4`, `heading-5`, `heading-6` 블록이 섹션 트리 *안*에 박혀
있으면, [[src/app/services/heading_promote.py#promote_inline_headings]] 가
이를 **새로운 sub-section 으로 승격**한다 — renumber 보다 *먼저* 호출되어
새 섹션도 정상 번호를 받음.

이래야 [[imports]] 의 dotted-prefix 승격 (`3.1.2.3 Foo`) 과 일관성이 유지됨.

## Role-based block redaction ★

각 block 은 `meta.audience: ["reader", "editor", "admin", "owner"]` 또는
`meta.permission: "public" | "internal" | "restricted"` 를 가질 수 있다.

응답 직전 [[src/app/services/document_service.py#scrub_for_response]] 가
요청 사용자 role 의 level 과 비교해:
- 통과면 그대로
- 미통과면 block 을 **redacted placeholder** 로 치환 (type 은 보존, 내용 비움)

이 동작은 **응답 레이어**에서만 일어남 — DB 에는 원본이 남고 admin 도구는
원본을 본다. 잘못된 위치 (예: `update_document` 직전 BEGIN) 에 호출하면
편집자가 본인이 못 보는 블록을 무의식적으로 지워버리는 사고가 남.

## Presentation hints (block meta + section.layout)

발표 모드 ([[apps/web/src/pages/Presentation.tsx]]) 가 참고하는 meta 키:

- **`block.meta.audience`**: `'both' | 'wiki-only' | 'slide-only'` — 발표 모드
  렌더링에서 `wiki-only` 블록 제외. [[apps/web/src/components/blocks/audienceFilter.ts]]
- **`block.meta.slideBreak`**: `'before' | 'after'` — `chunkBlocksForSlides`
  ([[apps/web/src/features/presentation/slideMachine.ts]]) 의 자동 BUDGET
  분할보다 우선. 같은 섹션 안에서 발표자가 슬라이드 분할 지점을 명시.

`PATCH /{slug}/sections/{id}` 는 `layout` 필드를 받음 (`'stack' | 'two-col'
| 'image-left' | 'image-right' | 'full-bleed' | 'title-only'`). 발표 모드
toolbar 에서 즉시 override 후 "💾 저장" 으로 영구 반영. FE 진입점:
[[apps/web/src/features/editor/api.ts#patchSection]].

## Versioning

- `documents` 테이블에 `version` 컬럼 (정수).
- 매 `PUT` / `restore` 마다 `version += 1` + `document_versions` 에 INSERT.
- `document_versions.content_json` 은 그 시점의 본문 스냅샷 (full snapshot
  — diff 가 아님).
- ETag 는 `(doc_id, version)` 기반이라 새 버전 = 새 ETag.

## Webhooks + Meilisearch + Glossary

매 저장/패치 flush 시:
1. `update_links_for_document()` — 본문에서 `[[…]]` 추출 → `resolve_term_aliases()`
   로 approved glossary alias → canonical term 슬러그 redirect → `links` 테이블 갱신
   (★ 응답 경로 = 트랜잭션 일관성). alias 가 hit 되면 link 의 `metadata.alias_of`
   에 원본이 보존된다.
2. `upsert_glossary_terms()` — 본문에 새 용어가 있으면 glossary 자동 등록
   (응답 경로 = 같은 commit). ★ glossary-knowledge-graph (0048) 이후 INSERT 가
   `domain='general', status='approved'` 로 명시되고 `ON CONFLICT (term, domain)
   WHERE domain IS NOT NULL` partial-UNIQUE 와 매칭됨 — 기존 `(term)` UNIQUE 는
   migration 0048 에서 drop.
3. `reindex_meili()` — Meilisearch `documents` index 갱신
4. `fire_webhook()` — 등록된 외부 URL 에 이벤트 발송 (3 회 재시도)
5. `refresh_search_view()` — PostgreSQL materialized view refresh

★ H9: PUT `/{slug}` (replace_document) 의 응답 latency 단축을 위해 3·4·5 는
**`BackgroundTasks` 로 응답 후 백그라운드 실행** (라우터 시그니처에
`background_tasks: BackgroundTasks` 추가, service 에 옵션으로 전달).
같은 트랜잭션 일관성이 필요한 1·2 만 응답 경로에 남는다.

배경 실행은 [[src/app/services/document_service.py#run_post_save_hooks]] 가
`session_scope()` 로 **새 session 을 열어** 수행한다 (요청 session 은 응답
직후 dependency 가 close). 각 hook 은 1회 retry + 1s backoff
([[src/app/services/document_service.py#_run_with_retry]]) — silent 실패 위험
감소. `create_document` / `archive_document` 는 아직 동기 (follow-up).

### materialized view refresh debounce (Large-M #1)

배경: 동시 PUT 두 건의 background task 가 같은 시점에 `refresh_search_view()`
를 호출하면 두 번째 `REFRESH ... CONCURRENTLY` 가 "another refresh in
progress" 로 실패 → plain `REFRESH` 폴백 → `AccessExclusiveLock` 획득 →
SELECT 모두 stall (대형 view 10-30초). H9 가 응답 경로에서 분리만 했고
background 동시성은 미해결이었음.

해결: [[src/app/services/document_service.py#refresh_search_view_debounced]]
가 5초 윈도우로 coalesce 한다.
- 진행 중이 아니면 즉시 1회 실행 + 윈도우 끝까지 대기
- 진행 중이면 `_view_refresh_pending` 만 set 하고 즉시 리턴
- 첫 실행이 끝날 때 `_pending` 이면 *1회만 추가* 실행 (cap=2)
- view 는 idempotent → 안전

`run_post_save_hooks` 의 `_refresh` closure 만 debounced 호출 사용.
동기 경로 (`insert_document`, `archive_document`, `_persist_content_change`,
`replace_document` 의 background_tasks=None fallback) 는 그대로 — 한
트랜잭션 안에서만 호출되어 충돌 가능성이 0.

테스트: [[apps/api/tests/test_refresh_view_debounce.py]] — single/burst
coalesce/pending flag/no-extra/sequential/inner-failure 6 케이스.

### 검색 인덱싱 retry 정책 (M2)

`reindex_meili()` → `meili_indexer.upsert_document()` / `delete_document()` 의
Meilisearch HTTP 호출은 `_call_meili_with_retry()`
([[src/app/search/meili_indexer.py#_call_meili_with_retry]]) 로 감싸 transient
오류를 fine-grained 재시도한다:

- 재시도 대상: `MeilisearchTimeoutError`, `MeilisearchCommunicationError`,
  `MeilisearchApiError` (HTTP 5xx)
- 재시도 안 함: HTTP 4xx (auth/payload — 재시도 무의미), 그 외 일반 예외
- backoff: 0.5s, 1.0s (총 시도 3회 = 초기 + 2 retry)

외부의 `_run_with_retry` (1회 retry + 1s) 와 책임이 다르다 — 외부는 hook
전체 (DB fetch + HTTP) 를 한 단위로 재시도, 내부는 HTTP 단의 transient
network blip 만 잡는다. 결과적으로 최악의 경우 단일 PUT 의 인덱싱 시도
횟수는 6회 (3×2). DB fetch 가 비싸면 외부 retry 가 부담이므로 fine-grained
가 우선 흡수.

테스트 환경에선 5번이 **비활성화** (`MXWP_SKIP_VIEW_REFRESH=1` 가
[[src/tests/conftest.py]] 에서 자동 세팅) — async engine reset 과 충돌 방지.

### 한국어 부분 매칭 (M1 — Meilisearch native)

Meilisearch 1.10 의 charabia 토크나이저가 CJK 를 음절 단위로 토큰화하므로
한국어 부분 매칭이 **별도 사전 토큰화 없이도 동작**한다:

- `"사업부"` 검색 → `"MX사업부 운영 가이드"` 매칭 ✓
- `"MX사"` 검색 → `"MX사업부"` 매칭 ✓
- `"확인 항목"` 검색 → `"확인항목"` 도 매칭 ✓

`_tokenize_words()` ([[src/app/search/meili_indexer.py#_tokenize_words]]) 는
CamelCase / snake_case / kebab-case 만 공백 분리 (영문 식별자용) — 한국어는
pass-through 가 정답. 회귀 가드: [[src/tests/test_search_hardening.py]] 의
`test_korean_partial_match_works_natively` (live Meili 필요, 부재 시 skip).

### `links` 테이블 인덱스 (backlinks query)

[[src/app/repos/document_repo.py#list_backlinks]] 의 `WHERE L.target_doc_id = ?
OR L.target_slug = ?` 쿼리는 0001_init 의 `idx_links_target_doc` +
`idx_links_target_slug` 로 BitmapOr 스캔. `idx_links_source` (source_doc_id)
도 함께 만들어져 있어 `replace_links_for_document` 의 DELETE …
WHERE source_doc_id 도 인덱스 스캔.

## CSS / Variable / Infobox patch

DocumentJSON 본체와 분리된 작은 영역:
- **infobox** — 우측 사이드의 메타 카드. `metadata.infobox` 키.
- **variables** — `{{varname}}` 본문 치환용 dict. `metadata.variables`.
- **custom_css** — 문서 1개에만 적용되는 sanitized CSS.
  [[src/app/services/css_sanitizer.py]] 가 정화. 위험한 속성/셀렉터 거름.

각 PATCH 엔드포인트는 본문 변경 없이 metadata 만 갱신하므로 빠르고
materialized view refresh 도 스킵 가능.

## Gotchas

1. **ETag 형식**: weak `W/"<id>-<version>"`. 따옴표 누락하면 클라이언트에서
   파싱 깨짐. CDN/프록시가 ETag 를 strong 으로 변환하지 않게 조심.
2. **renumber 는 매 저장마다 일어남** — 클라이언트가 보낸 `section.number`
   는 표시용이지 권위 없음. FE 도 응답값을 다시 받아 표시.
3. **`replace_document` 는 비싸다** — 본문 전체 교체 + 버전 INSERT + 인덱싱
   3 단계. UI 의 빠른 편집은 patch_section/patch_block 으로 가야 한다.
4. **soft-delete 후 같은 slug 재생성 금지** — `archived_at IS NULL` 조건의
   unique index 가 있어서 archive 된 문서를 살리려면 `restore_version` 이나
   admin SQL 이 필요.
5. **block redaction 은 응답 전용** — DB 변경 함수에 절대 끼우지 말 것.
6. **`_walk_sections` / `_walk_blocks_in_section` 는 generator** — 다중 소비하면
   재호출 필요. 종종 `list(_walk_…)` 로 박제하고 시작하는 게 안전.
7. **columns widths 정규화**: `widths` 가 100 의 합이 아니면 비례 재조정.
   `[[src/app/services/document_service.py#_normalise_columns_widths]]`.
8. **ImageAnnotationBlock 의 legacy `image_id` 키**: 과거 snake_case 로 저장된
   document 가 DB 에 남아있을 수 있음. `validate_documentjson()` 진입부의
   `_normalise_image_annotation_ids()` 가 read 시점에 in-place 로 `imageId` 로
   rename — DB 마이그레이션은 없음. pydantic v2 의 `extra='forbid'` 때문에
   정규화 안 거치면 legacy doc 이 validation reject 됨.
   동일 패턴으로 `_normalise_image_annotation_labels()` 가 callout-kind
   annotation 의 legacy `text` → `label` 을 read 시점에 rename
   (widget-integrity-pass-2 M5).
9. **SpreadsheetBlock 은 docx import 가 만들지 않는다** — 사이트 에디터에서
   직접 추가. LLM 이 docx 로 작성할 땐 일반 TableBlock 으로 두고 사람이
   사이트에서 변환. (참고: [[../llm-input-rules.md#2-9-spreadsheet-편집-가능한-표]])
10. **`PdfBlock.file_id` 는 snake_case + `fileId` alias 양방향** — JSON schema
    는 `file_id` (snake), FE / docx round-trip 은 `fileId` (camel) 를 보낸다.
    [[src/app/schemas/document.py#PdfBlock]] 가 `Field(..., alias='fileId')` +
    `populate_by_name=True` + `model_validator(mode='before')` 로 둘 다 받음 —
    동시 입력이면 `file_id` 우선. `FileBlock.fileId` (camel-only) 와 명시적으로
    다른 컨벤션. 외부 LLM 이 input docx 를 만들 땐 어느 쪽이든 OK.

11. **zebra `options.stripe` 기본은 `true`** — table/spreadsheet/list/kpi-cards/
    bibliography/figure-index/gantt **7 종** 모두 동일 contract: `options` 객체
    없으면 zebra 적용. 명시적으로 끄려면 `{stripe:false}` 저장 필요. 단일 진실은
    [[src/features/editor/blocks/zebra.ts#getZebraClass]] + 공통 UI 는
    [[src/features/editor/blocks/ZebraToggle.tsx]]. table/spreadsheet 만 docx 등
    export 에 반영, 나머지 5 종은 FE-only 시각 효과 (gantt 는 SVG `<rect>` paint,
    `STRIPE_CLASSES` map의 `gantt` 엔트리는 type 완전성 위한 dummy — 본문 fill은
    GanttBlockView 인라인 `#F9FAFB`).

11. **블록 다크 모드 = Tailwind `dark:` 변형 의무** — `bg-white`/`border-gray-200`/
    `border-gray-300` 가 있는 *모든* 블록 className에 같은 line에 `dark:bg-gray-900`/
    `dark:border-gray-700`/`dark:border-gray-600` 동반 (block-darkmode-batch
    사이클에서 26 파일 일괄 적용). 의도 예외 2건은 `AllBlocksDarkmode.test.ts` 의
    `ALLOW_LIGHT_ONLY` map에 등록 + 사유 명시 — CodeBlock (코드 블록은 *항상* 어두운
    surface), WhiteboardBlock (사용자 그림용 흰 캔버스). 신규 블록 추가 시 회귀
    가드 `[[src/components/blocks/__tests__/AllBlocksDarkmode.test.ts]]` 가 자동
    검출. SVG 블록의 fill/stroke는 `var(--smsg-...)` 토큰 사용 (별개 — chart/gantt/
    orgchart darkmode 사이클 참조).

12. **블록 반응형 = `grid-cols-N` (N>=2) 는 `sm:`/`md:` 변형 의무** — 데스크탑 위주
    grid가 mobile (375px) 에서 깨지지 않게 `grid-cols-1` 로 시작 + `sm:grid-cols-N`
    (640px+) 또는 `md:grid-cols-N` (768px+) 변형 동반. responsive-audit 사이클에서
    blocks/ + features/editor/ 전수 적용 (ConflictMergeModal 3-col, ChartBlockEditor
    stats/fit-range 2-col, ImageBlockEditor size picker 5-col, MathBlockEditor 2-col,
    PdfBlockEditor 2-col, BlockInsertPalette 4-col). 회귀 가드
    [[src/components/blocks/__tests__/AllBlocksResponsive.test.ts]] 가 blocks/ 신규
    파일 자동 검출 (features/editor 는 별도 audit 필요 시 동일 패턴 확장).
11. **pydantic v2 codegen 은 JSON Schema 의 `oneOf` 의 `not: required` 부분을
    무시한다** — `datamodel-codegen` 이 두 helper class + `RootModel` union 으로
    풀지만 cross-branch 거부 (양쪽 모두 set 입력) 는 모델 validator 가 필요.
    [[packages/shared/codegen/generate-py.py#_inject_after_meta]] 가 매 regen 마다
    `@model_validator(mode='after')` 를 후처리 주입한다. IframeBlock 의 src/html
    XOR 가 첫 적용 사례 (widget-integrity-pass-2 M2); 향후 다른 oneOf 도 같은
    패턴 확장 가능.

## Settings (`app.core.config`)

| 키 | 기본 | 의미 |
|---|---|---|
| `max_blocks_per_document` | 5000 | 본문 블록 수 캡 |
| `max_sections_per_document` | 500 | 섹션 수 캡 |
| `archive_default_days` | 90 | soft-delete TTL 안내값 |

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_documents.py]] | CRUD + ETag |
| [[src/tests/test_block_patch.py]] | patch_block / patch_section |
| [[src/tests/test_block_permissions.py]] | role-based redaction |
| [[src/tests/test_bulk_docs.py]] | 대량 생성 |
| [[src/tests/test_version_restore.py]] | 버전 복원 (= 새 버전 INSERT) |
| [[src/tests/test_version_tags.py]] | 버전 태깅 |
