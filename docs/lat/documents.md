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
| GET | `/{slug}/html` | reader+ | 서버 사이드 HTML 렌더 (PDF 용) |
| POST | `/` | editor+ | 신규 생성 |
| PUT | `/{slug}` | editor+ | 전체 교체 — 버전 INSERT |
| DELETE | `/{slug}` | admin | soft-delete |
| GET | `/{slug}/backlinks` | reader+ | 다른 문서가 인용한 링크 |
| GET | `/{slug}/versions` | reader+ | 버전 목록 |
| GET | `/{slug}/versions/{n}` | reader+ | 특정 버전 |
| POST | `/{slug}/versions/{n}/restore` | editor+ | 버전 복원 (= 새 버전 INSERT) |
| PATCH | `/{slug}/title` | editor+ | 제목/요약 인라인 수정 |
| PATCH | `/{slug}/infobox` | editor+ | 우측 사이드 정보 박스 |
| PATCH | `/{slug}/variables` | editor+ | 본문 템플릿 변수 |
| PATCH | `/{slug}/custom-css` | editor+ | 문서별 CSS |
| PATCH | `/{slug}/sections/{section_id}` | editor+ | 섹션 부분 수정 |
| PATCH | `/{slug}/blocks/{block_id}` | editor+ | 블록 부분 수정 |
| POST | `/{slug}/blocks` | editor+ | 블록 추가 |
| DELETE | `/{slug}/blocks/{block_id}` | editor+ | 블록 삭제 |
| POST | `/{slug}/blocks/{block_id}/move` | editor+ | 블록 이동 (섹션 간/내) |
| POST | `/{slug}/sections/reorder` | editor+ | 섹션 트리 재배열 |
| POST | `/{slug}/ping` | reader+ | 조회수 카운트 |

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
- `ListBlock` — `style: "bullet"|"ordered"`, `items[]`
- `QuoteBlock` — `text`, `cite?`. ★ FE editor
  ([[src/features/editor/blocks/QuoteBlockEditor.tsx]]) 가 widget-integrity-pass-2 M9
  사이클에서 추가됨 — text textarea + cite input, 600 ms debounced patchBlock.
  빈 cite 는 `undefined` 로 정규화 (read 측의 `block.cite` truthy 체크와 일관).
- `CalloutBlock` — `variant: "info"|"warn"|"danger"|"success"`, `title?`, `text`
- `CodeBlock` — `language`, `code`
- `MathBlock` — LaTeX `expression`, `display: "block"|"inline"`
- `TableBlock` — `headers[]`, `rows[][]`, `caption?`, `options{}` (sortable,
  searchable, density, stickyFirstCol, rowNumbers, **stripe** (default `true`,
  zebra-striped data rows; header row 미영향), borderStyle). 두 가지 셀 모드:
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
  TableBlock 과 달리 docx import 가 만들지 않고 사이트 에디터에서 직접 추가/편집.
  docx export 는 `_b_spreadsheet()` 가 `stripe=True` → `Light Grid Accent 1`,
  `False` → `Table Grid` 로 분기.
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
  `bgColor?: string` 추가 — 이미지가 균일하게 밝아 흰 배경이 묻힐 때 사용자가
  override 가능. editor UI는 후속 사이클 (현재는 raw JSON 편집만).
- `SpacerBlock` — `size: "sm"|"md"|"lg"|"xl"` (16/32/64/128 px, default `md`).
  본문 흐름의 명시적 여백. FE editor (SpacerBlockEditor.tsx) 가 dropdown 으로
  4 옵션 노출 (pass-3 N1 확장).
- `FigureIndexBlock` — 본문의 캡션 있는 image/table/chart 자동 목차. `kinds?`
  필터, `title?`, `options.stripe?` (default `true`, 그룹 내 항목 zebra — 그룹별
  카운터 리셋). FE 의 FigureIndexBlock 에 🔄 갱신 버튼 — MutationObserver
  로 본문 변화 캐치 후 collect() 재실행. 편집 모드에서는
  [[src/features/editor/blocks/FigureIndexBlockEditor.tsx]] 가 title + zebra 토글만
  노출 (entries 는 런타임 DOM 스캔, kinds 편집은 yagni 로 out-of-scope).
- `CalloutBlock` — `variant: "info"|"warn"|"danger"|"success"|"tip"`, `title?`, `text`.
  docx export 시 `Widget: callout (variant)` hidden marker emit (검증:
  `test_renderer_callout_emits_hidden_marker_run`).
- `KpiCardsBlock` — `items[]` (label, value, trend), `options.stripe?` (default `true`,
  카드 단위 `:nth-of-type(2n)` blue-050 zebra — grid 컬럼 수와 무관).
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
  `<rect>`는 SVG 첫 자식이라 axis line / 막대 뒤에 paint). 다크 모드 자동 대응:
  모든 SVG fill/stroke 가 `var(--smsg-...)` 토큰 — `tokens.css` `.dark` 변형이
  자동 치환. figure 배경도 `dark:bg-gray-900 dark:border-gray-700`.
- `OrgChartBlock` — tidy-tree 레이아웃의 순수 SVG 조직도 (mermaid 아님).
  hover 시 descendant 하이라이트. 다크 모드 자동 (SVG fill/stroke `var(--smsg-...)`
  + figure/empty `dark:` 변형 — chart-darkmode 사이클과 별개로 gantt-darkmode
  패턴 그대로 적용).
- `FlowBlock` — mermaid DSL → SVG (lazy load). 다크 모드: `useResolvedTheme()` →
  mermaid `initialize({theme: 'dark'\|'default'})` 재실행 + `idRef.current` 재생성
  (mermaid singleton 캐시 회피) + `render()` 재실행. theme 변경 useEffect deps에
  포함 (chart-libs-darkmode 사이클).
- `ChartBlock`, `ColumnsBlock`, `TabsBlock`, `AccordionBlock`,
  `GalleryBlock`, …

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
| `update_links_for_document()` | [[src/app/services/document_service.py#update_links_for_document]] | 본문 위키링크 → `links` 테이블 |
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

## Versioning

- `documents` 테이블에 `version` 컬럼 (정수).
- 매 `PUT` / `restore` 마다 `version += 1` + `document_versions` 에 INSERT.
- `document_versions.content_json` 은 그 시점의 본문 스냅샷 (full snapshot
  — diff 가 아님).
- ETag 는 `(doc_id, version)` 기반이라 새 버전 = 새 ETag.

## Webhooks + Meilisearch + Glossary

매 저장/패치 flush 시:
1. `update_links_for_document()` — 본문에서 `[[…]]` 추출 → `links` 테이블 갱신
2. `reindex_meili()` — Meilisearch `documents` index 갱신
3. `upsert_glossary_terms()` — 본문에 새 용어가 있으면 glossary 자동 등록
4. `fire_webhook()` — 등록된 외부 URL 에 이벤트 발송 (3 회 재시도)
5. `refresh_search_view()` — PostgreSQL materialized view refresh

테스트 환경에선 5번이 **비활성화** (`MXWP_SKIP_VIEW_REFRESH=1` 가
[[src/tests/conftest.py]] 에서 자동 세팅) — async engine reset 과 충돌 방지.

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
10. **zebra `options.stripe` 기본은 `true`** — table/spreadsheet/list/kpi-cards/
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
| [[src/tests/test_versions.py]] | 버전 INSERT / restore |
