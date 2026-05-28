# Export lat — DocumentJSON → docx / pptx / html / pdf / md

> 동일한 DocumentJSON 본문을 4 가지 출력 포맷으로 직렬화한다. 모든 렌더러는
> "디스패치 테이블" 패턴 — block type 별로 `_b_<type>(...)` 함수가 호출됨.
>
> 연관 lat: [[documents]] (입력 스키마) · [[imports]] (round-trip 두 번째 leg) ·
> [[storage]] (이미지 resolver)

## Endpoints

전부 [[src/app/routers/exports.py]] (`/api/v1/exports`).

| Method | Path | 출력 | 용도 |
|---|---|---|---|
| POST | `/markdown` | `text/markdown` | GitHub 등 외부 공유 |
| POST | `/pdf` | `application/pdf` | 인쇄/배포. WeasyPrint 가용 시만. |
| POST | `/pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | 발표 슬라이드 |
| POST | `/docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 외부 검토/편집 |
| GET | `/artifacts` | JSON | 비동기 export 결과 다운로드용 (큰 문서) |
| GET | `/artifacts/{id}` | 원본 | 위 결과의 실제 바이트 |

대용량 문서는 `_persist_export()` 가 결과를 임시 객체 저장에 올리고 artifact ID
만 반환. 작은 문서는 즉시 응답.

## Renderers

| 모듈 | 진입점 | 라이브러리 |
|---|---|---|
| [[src/app/services/docx_export.py]] | `render_docx()` | `python-docx` |
| [[src/app/services/pptx_export.py]] | `render_pptx()` | `python-pptx` |
| [[src/app/services/html_renderer.py]] | `render_namuwiki_html()` | jinja-less 직조 HTML |
| [[src/app/services/markdown_export.py]] | `render_markdown()` | 순수 문자열 조합 |

PDF 는 별도 모듈이 아니라 `html_renderer.py` 의 HTML → **WeasyPrint** 가
변환. `_detect_weasyprint()` 가 import 가능 여부 검사 → 미설치 환경에선
`_PdfExportUnavailable` (503) 반환.

## 공통 디스패치 구조 ★

각 렌더러는 동일한 골격:

```text
render_<fmt>(doc, *, options, requester_role=None)
  │
  ├─ options 기본값 채움
  ├─ requester_role 지정 시 scrub_for_response() 거침 (redaction)
  ├─ _render_title()  / _render_title_slide()
  ├─ for sec in doc.sections:
  │     _render_section(sec, ctx)
  │       │
  │       ├─ section heading 출력
  │       └─ for block in sec.blocks:
  │             _render_block(block, ctx)
  │               │
  │               └─ block.type 으로 _b_<type>(block, ctx) 분기
  └─ 직렬화 → bytes
```

`_Ctx` 는 렌더 동안의 공유 상태 (numbering, footnotes, figure index, options 등).

## Block dispatcher 맵

[[src/app/services/docx_export.py]] / [[src/app/services/pptx_export.py]] /
[[src/app/services/html_renderer.py]] / [[src/app/services/markdown_export.py]]
**네 파일 모두** 같은 block type 집합을 처리한다. 새 block 추가 시 4 파일
모두 수정 — 한 곳을 놓치면 해당 포맷만 빈 결과가 됨.

공통 block (네 렌더러 모두):
- paragraph, heading-4, list, quote, callout, code, math
- table, kpi-cards, chart
- gantt, flow, org-chart, columns, tabs, accordion
- iframe, video, image, gallery, file
- doc-link-card, glossary-ref
- **bibliography** — 4 export 모두 핸들러 존재 (widget-integrity-pass-1
  사이클에서 html/pptx/md 에 핸들러 추가; 이전엔 docx 만).
- **spreadsheet** — docx 에서만 핸들러 존재 (`_b_spreadsheet()`). html_renderer
  에는 spreadsheet 분기 없음 (out-of-scope; 사이트 자체 React 컴포넌트가 렌더).

renderer 별 추가 책임:
- **docx_export**: `_emit_table_flat()`, `_emit_table_cells()` 가 표 → Word 표
  변환 + 셀 병합/스타일. 가장 무거운 분기.
- **pptx_export**: 슬라이드 분할 (`_new_content_slide()`), 본문 텍스트 프레임
  (`_body_text_frame()`), heading-4 가 별도 슬라이드로 떨어지는 케이스
  (`_render_subsection_slide()`).
- **html_renderer**: TOC 자동 생성 (`_render_toc()`), 섹션 anchor
  (`_section_anchor()`), Namuwiki 스타일 클래스명.
- **markdown_export**: meta block (front-matter), `_render_meta_block()`.

## DocxOptions / PptxOptions / RenderOptions

| 옵션 | 모듈 | 용도 |
|---|---|---|
| `image_resolver: (image_id) → {bytes, mime}` | docx, pptx | 이미지 ID 를 실제 바이트로 해소. None 이면 figure 자리에 placeholder. |
| `include_toc: bool` | docx | True 면 title 직후에 자동 TOC (level 1/2) emit. Default False — round-trip 호환성. `_render_toc()` 가 'List Bullet' / 'List Bullet 2' 스타일로 정적 텍스트 emit (python-docx 가 진짜 `TOC` 필드 빌드 API 미제공). html_renderer 와 동일한 level 1/2 한정 정책. pptx/markdown 은 미지원 (포맷이 TOC 의미를 자체적으로 갖지 않음). |
| `requester_role` | 전부 | redaction 적용용. None = 원본 그대로. |
| `theme` / `css_inline` 등 | html | 사용자 정의 스타일 |

`image_resolver` 의 두 가지 구현:
1. **운영** — [[src/app/routers/exports.py]] 의 `_fetch_image_bytes()` 가 MinIO 에서
   가져옴 → resolver 로 감싸 전달.
2. **Round-trip** — [[src/app/services/docx_roundtrip.py#_make_image_resolver]] 가
   `captured_images` (메모리) 에서 가져옴.

## Headings / numbering

본문 섹션은 `level: 1..6`. docx_export 는 Word 의 `Heading 1..6` 스타일에 매핑.
`heading-4` block 은 inline heading 으로 본문 안에 박혀 있지만 export 시
별도 줄로 굵게 표시 — pptx 에선 별도 슬라이드를 만드는 트리거이기도 함.

섹션 번호 (1, 1.1, 1.1.1) 는 [[documents]] 에서 이미 부여된 상태로 들어옴 —
export 단계에서 재계산 X.

## Table rendering 깊이

`docx_export._b_table()` 은 table block 의 옵션을 두 단계로 처리:
1. **헤더/푸터/aggregate** — `options.footer` (sum/avg/min/max), `column.aggregate`
2. **셀 스타일** — align, dtype 별 포맷 (`number`/`percent`/`currency`/`date`),
   density (`compact`/`normal`/`comfortable`), border-style.

`_emit_table_flat()` 가 단순 표, `_emit_table_cells()` 가 병합/스타일 포함 표.

### Stripe 옵션 (4-export 반영)

`options.stripe` (default `true`) 가 4 렌더러 모두에서 처리됨 (widget-integrity-pass-1
사이클 G2):

| 렌더러 | 처리 |
|---|---|
| `docx_export._table_style_for()` | `stripe=True` → `Light Grid Accent 1` (zebra), `False` → `Table Grid` (plain). `_emit_table_flat()` / `_emit_table_cells()` 두 경로 모두. |
| `html_renderer._table_class_for()` | `stripe=True` → `class="b-table striped"`, `False` → `class="b-table no-stripe"`. 사이트 CSS 의 `:nth-child(even)` 규칙 활용. |
| `pptx_export._apply_table_stripe()` | python-pptx `table.horz_banding` 속성 토글. |
| `markdown_export` | markdown 자체는 zebra 표현 불가 → `<!-- stripe:false -->` HTML 주석으로 옵션만 보존 (default true 면 주석 미emit). |

SpreadsheetBlock 도 동일 패턴 — `docx_export._b_spreadsheet()` 가 `stripe=True` →
`Light Grid`, `False` → `Table Grid` 분기.

**Mixed-content cells** — 셀이 `text` 대신 `blocks` (paragraph/image/list) 를
가지면 [[src/app/services/docx_export.py#_emit_cell_blocks]] 가 호출되어
paragraph 는 텍스트로, image 는 cell paragraph 안 `add_picture()` 로 (resolver
미스 시 텍스트 폴백), list 는 prefix 가 붙은 paragraph 들로 평탄화.
html / markdown 도 동일 패턴으로 처리 (`_render_cell_html`, `_flatten_cell_md`).
pptx 는 python-pptx 셀이 picture 미지원이라 `[image: <label>]` 텍스트 폴백
([[src/app/services/pptx_export.py#_fill_cell_blocks_pptx]]).

pptx 는 슬라이드의 좁은 면적 때문에 큰 표를 자동 축소 — `_b_table()` 안의
`max_cols`, `max_rows` 캡. 또한 `_emit_table_sparse()` 가 cells-only 표를
`cell.merge()` 로 colSpan/rowSpan 까지 보존.

## Math / Chart / Gantt 변환

| Block | docx | pptx | html | md |
|---|---|---|---|---|
| `math` | OMML 직조 | 텍스트 fallback | KaTeX inline | `$$ … $$` |
| `chart` | hidden marker + 데이터 표 (round-trip) | line/bar/column/pie → native PPTX chart, **xy-line → XY_SCATTER_LINES_NO_MARKERS** (P4), area/radar/scatter → text fallback | `<canvas>` + chart.js JSON, engine=echarts 면 EChartsView (xy-line 의 grid/zoom/log/fit/dual-y/error bar/annotation 등) | mermaid fenced |
| `gantt` | hidden marker + Task/Start/End/Progress 표 | 표 | 커스텀 SVG | mermaid `gantt` |
| `flow` | hidden marker + code block (mermaid DSL) | 텍스트 | mermaid | mermaid `flowchart` |
| `org-chart` | hidden marker + name/parent 표 | 텍스트 | mermaid | mermaid `graph TD` |

## Widget hidden marker policy ★

docx export 시 18 위젯 모두 `Widget: <type> (variant)` 마커를 **hidden text**
로 emit (`<w:r><w:rPr><w:vanish/></w:rPr><w:t>…</w:t></w:r>`). Word 정상 보기/
인쇄 시 invisible. import 측 [[src/app/services/widget_markers.py#parse_marker]]
가 hidden 여부 무관하게 텍스트만 매칭 → round-trip 정확.

설정: [[src/app/services/widget_markers.py#_EXPORT_MARKER_TYPES]] 18 entries.
variant 분기: chart (chartType) / gallery (carousel 만) / columns (count N) /
callout (info/warn/danger/tip).

### Hidden marker — non-default attribute encoding (pass-2)

기본 `Widget: <type> (variant)` marker 외에 *추가 속성* 을 보존해야 할 때
별도 grammar `⟦<type>:<key>=<value>⟧` 를 hidden run 으로 emit (widget-integrity-pass-2).
기존 `Widget: …` marker 와 충돌하지 않도록 `⟦…⟧` 분리 grammar 채택:

| 블록 | emit 조건 | hidden run 내용 | 위치 |
|---|---|---|---|
| `pdf` (M3) | `page != 1` (schema default) | `⟦pdf:page={page}⟧` | [[src/app/services/docx_export.py#_b_pdf]] |
| `org-chart` (M6) | `layout != "tree"` (schema default) | `⟦org-chart:layout={layout}⟧` | [[src/app/services/docx_export.py#_b_org_chart]] |
| `gallery` (M7, 기존) | `layout == "carousel"` | `Widget: gallery (carousel)` (기본 marker 내 variant) | [[src/app/services/widget_markers.py#emit_marker_text]] |

default 값일 때 marker 미emit (소음 회피 + 빈 paragraph 부풀림 방지). round-trip
importer 가 추후 `widget_markers.parse_marker` 옆에 `⟦…⟧` 별도 parser 를 추가하면
hidden marker 가 원본 layout/page 복원에 쓰임 (현재는 *forward-only*).

### Glossary-ref docx dead code 제거 (pass-2 M11)

`_b_glossary_ref` 의 `block.get("definition")` 분기 3 라인 제거. `GlossaryRefBlock`
스키마에는 `definition` 필드가 *없음* (오로지 `type / id / term / meta`) — dead
branch 였음. 시각적으론 변화 없음 (resolver 가 actor 의 glossary lookup 으로 채움).

3계층 round-trip 가드: marker → autodetect (외부 LLM docx 의 첫 입력 대비) →
placeholder-on-failure (image bytes 등이 사라져도 widget identity 보존,
n_consumed=0 marker-only path). 검증: `/tmp/smoke_all_widgets.py` 가 18/18 OK.

차트는 본문에 SVG 가 직접 박히지 않고 미리 렌더된 PNG 가 storage 에서
온다 — `chart.imageId` 가 가리키는 [[storage]] 의 이미지 사용.

## Footnotes

본문 paragraph 의 `[^N]` 마커는 `_collect_footnotes()` 가 전체 본문에서
미리 수집해 마지막에 footnote 목록 섹션으로 emit. docx 는 Word 의 진짜
footnote 가 아니라 본문 텍스트 ` (body)` 로 평탄화 — 이는 round-trip 시
손실되는 정보.

## Image pipeline (export 측)

1. block.imageId (또는 chart.imageId 등) 수집
2. options.image_resolver 호출
3. 반환된 bytes + mime → 렌더러가 docx Picture / pptx Picture / `<img>` /
   `![alt](data:…)` 로 emit
4. resolver 가 None 리턴하면 docx 는 alt 텍스트만, html 은 placeholder

### width enum 처리 (4-export)

`ImageBlock.width` (sm/md/lg/full) enum 이 docx 에서도 반영됨 (이전엔 무시):

```python
_IMAGE_WIDTH_PX = {"sm": 200, "md": 400, "lg": 600, "full": None}
```

- sm ≈ 2.08 in (docx), md ≈ 4.17 in, lg ≈ 6.25 in, full = intrinsic (width 미지정).
- `meta.width` (pixel) 가 있으면 enum 보다 우선순위 *낮음* — enum 이 ★ 우선.

자세한 storage 측은 [[storage]].

## Persistence (artifact mode)

큰 문서는 동기 응답 대신:
1. `_persist_export(s, …)` 가 결과를 임시 객체 저장 (MinIO) 에 올림
2. `export_artifacts` 테이블에 ID + 만료 시각 INSERT
3. 응답에 `{artifact_id}` 만
4. FE 는 `GET /exports/artifacts/{id}` 로 폴링 → 완료되면 다운로드

만료된 artifact 는 [[src/app/services/retention.py]] 류 cron 이 정리 (확인 필요).

## Gotchas

1. **모든 렌더러는 `requester_role` 기본 None** — 미지정시 redaction 미적용.
   admin export 와 reader export 가 같은 결과면 의도된 것. role 기반 export 가
   필요하면 호출 측이 명시.
2. **새 block type 추가** 시 4 개 렌더러 모두 수정. 누락하면 그 포맷만
   조용히 빈 결과. import 측 ([[imports]]) 도 같이 확인.
3. **WeasyPrint** 는 apptainer 환경에서 cairo/pango 시스템 라이브러리 필요.
   미설치면 PDF endpoint 가 503. docx/pptx 는 영향 없음.
4. **python-docx 의 table 셀 병합**은 `merge()` 호출 후 셀 텍스트가 첫 셀로만
   집계. 후속 cell.text 쓰기는 무시됨 — `_emit_table_cells()` 가 주의해 처리.
5. **pptx 의 텍스트 박스 overflow** — python-pptx 가 자동 줄임을 안 해줘서
   본문이 길면 슬라이드 밖으로 흘러나감. KPI/chart 같은 큰 block 은 별도
   슬라이드로 분리해야 함.
6. **markdown export 의 mermaid fenced** — 일부 렌더러는 mermaid 안의 한글을
   broken render. 본문에 한글 노드 라벨이 있으면 PDF 출력 미리보기 권장.
7. **image_resolver 가 동기**여야 함 — 비동기 콜백은 export 흐름이 sync 라
   사용 불가. MinIO 에서 가져올 땐 caller 가 미리 일괄 fetch 후 dict resolver
   만들어 넘김.
8. **list export 의 items 는 string-only** — 과거 docx_export `_b_list()` 에
   `isinstance(item, dict)` 분기가 있었으나 schema 가 `items: array of string`
   으로 명시. 죽은 코드 제거됨 (widget-integrity-pass-1 G6).
9. **markdown 의 `<!-- stripe:false -->` 주석은 옵션 보존 마커** — markdown
   import 측은 본 사이클 범위 밖이라 round-trip 으로 옵션 복원 X. export 측만
   책임. 차후 import 사이클에서 보강.

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_docx_export.py]] | docx 렌더 — 모든 block type 한 번씩 |
| [[src/tests/test_docx_roundtrip.py]] | docx_export → docx_import 라운드트립 (텍스트 보존, table/list/image 보존) |
| [[src/tests/test_pptx_export.py]] | pptx 렌더 |
| [[src/tests/test_html_render.py]] | html 렌더 + TOC |
| [[src/tests/test_markdown_export.py]] | markdown 렌더 |
