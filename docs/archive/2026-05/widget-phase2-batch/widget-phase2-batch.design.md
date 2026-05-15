# Design — widget-phase2-batch

> Plan: [widget-phase2-batch.plan.md](../../01-plan/features/widget-phase2-batch.plan.md)

## 1. Architecture

### 1.1 Converter signature 확장 (multi-block 지원)

현재:
```python
ConverterFn = Callable[[str | None, dict, summary], dict | None]
# returns: widget block or None (fallback)
# consumed: marker + 1 target block (always)
```

신규 (multi-block 지원):
```python
ConverterResult = tuple[dict[str, Any], int] | None
# (widget_block, n_targets_consumed) — n>=1
ConverterFn = Callable[[str | None, list[dict], summary], ConverterResult]
# input changed: list of *following* blocks (lookahead window)
```

`_rewrite_blocks` 가 marker 이후의 모든 잔여 블록을 슬라이스로 넘기고, converter 가 자기가 소비한 개수를 반환. 단일 pair converter 는 `(widget, 1)` 반환하면 기존 행동과 동일.

**Phase 1 converter (callout / kpi-cards) 도 이 시그니처로 마이그레이션** — 호환성 위해 wrapper 도입.

### 1.2 메인 thread vs 에이전트 분할

```
┌─────────────────────────────────────────────────────────────┐
│  메인 thread (인프라 변경 — 순차)                            │
│   1. ConverterFn 시그니처 확장 + _rewrite_blocks 변경        │
│   2. Phase 1 converter 시그니처 마이그레이션 (callout/kpi)   │
│   3. 회귀 테스트 (test_widget_markers.py) 통과 확인          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Generator agents G1-G14 (병렬, Opus)                       │
│   각 agent → 자기 converter 함수 + dispatcher 등록 + 테스트  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  메인 thread (통합)                                          │
│   - 각 generator 의 patch 통합                              │
│   - typecheck + pytest 통과 확인                            │
│   - openapi-dump drift 0 확인                               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Verifier agents V1-V6 (병렬, Sonnet)                       │
│   각 agent → 자기 담당 generator 의 결과 read-only 감사     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  메인 thread — Gap analysis + report + archive + push       │
└─────────────────────────────────────────────────────────────┘
```

## 2. Generator agent 시방서 (공통)

**모든 generator 가 따를 룰**:

1. 코드 변경 전 `apps/api/app/services/widget_markers.py` 의 *최신 본문* 을 read (시그니처 확장 후).
2. 자기 담당 converter 함수 1개 (또는 묶음) 만 추가. **dispatcher 의 None → 실제 함수** 로만 교체.
3. converter 시그니처 새 형태: `(variant: str | None, targets: list[dict], summary) -> tuple[dict, int] | None`.
4. **정보 손실 0 룰**: 변환할 수 없는 target 이면 `None` 반환 — 그러면 메인 dispatcher 가 marker + target 모두 보존.
5. 새 ID 는 `_new_id()` (= `ulid.new()`) 사용.
6. 테스트는 `apps/api/tests/test_widget_markers.py` 의 기존 패턴 따라 단위 1-2개 추가 (직접 호출 + docx 라운드트립 1개 정도). 새 테스트 파일 만들지 말 것.
7. lat 변경 NO — 메인 thread 가 마지막에 일괄 갱신.
8. 다른 파일 만지지 말 것. 다른 converter 만지지 말 것. dispatcher 의 *내 한 줄* 만 None → 함수명 으로 교체.
9. `ruff format` / `ruff check` 통과 코드.

### 2.1 G1 — `_convert_chart`

**입력 (after marker `Widget: chart (line|bar|pie|area|radar|scatter)`)**: `targets[0]` is a `TableBlock`.

**변환 로직**:
- variant → `chartType` (default: `bar`).
- table.headers 의 0번째 = label column, 1+번째 = series names.
- table.rows 의 각 행 → labels 배열에 행 0번째, series 들의 values 에 행 1+번째 (숫자로 파싱).
- 숫자 파싱 실패 (예: "10%" → 10, "1,234" → 1234) 는 `_parse_number(str) -> float | None` 헬퍼 추가. 한 행이라도 모두 None 이면 그 행 스킵.
- title 은 table.meta.caption (있다면) 또는 None.

**schema**: ChartBlock — required `type`, `id`, `chartType`, `data`.

**테스트 케이스**:
- `test_chart_marker_converts_2col_table` — 2-column numeric table → bar chart with single series.
- `test_chart_marker_with_3col_table_makes_multi_series` — labels + 2 series.

**소비**: 1 (table only). 반환: `(chart_block, 1)`.

### 2.2 G2 — `_convert_gantt`

**입력**: `targets[0]` = TableBlock with headers like `["Task","Start","End","Progress"]` (Progress optional).

**변환 로직**:
- Header lookup: `name|task|task name` (kor: `작업|이름`), `start|start date|시작`, `end|end date|종료`, `progress|progress%|진행률` (optional).
- Each row → `{name, start, end, progress?}`. progress 는 "50%" → 50 으로 파싱; >100 또는 <0 이면 skip progress field.
- 필수 컬럼 (`name`, `start`, `end`) 못 찾으면 `None` 반환.
- start/end 는 문자열 그대로 통과 (schema 가 string).

**schema**: GanttBlock — required `type`, `id`, `tasks` (items have `name`/`start`/`end`).

**테스트**:
- `test_gantt_marker_converts_4col_table` — name/start/end/progress 표.
- `test_gantt_marker_missing_required_column_returns_none` — name 컬럼 없는 표는 변환 실패 (None).

**소비**: 1.

### 2.3 G3 — `_convert_flow`

**입력**: `targets[0]` = `CodeBlock` (type `code`, language `mermaid` or no language).

**변환 로직**:
- code block 의 source/text/code 필드 (스키마 확인) → `source`. engine = "mermaid" (variant 무시 — schema 가 mermaid|excalidraw 만 허용; default mermaid).
- target 이 code 가 아니면 `None`.

**schema**: FlowBlock — required `type`, `id`, `engine`, `source`.

**테스트**:
- `test_flow_marker_converts_mermaid_code_block`.
- `test_flow_marker_with_paragraph_target_returns_none` — 잘못된 타겟.

**소비**: 1.

### 2.4 G4 — `_convert_org_chart`

**입력**: `targets[0]` = ListBlock (들여쓰기 트리) **또는** TableBlock (headers `["name","parent"]` 또는 `["이름","상위"]`).

**변환 로직 (ListBlock)**:
- 각 item 의 leading spaces 또는 list nesting (schema 확인 필요) 로 depth 추정.
- depth=0 이 root; depth=1 은 root.children; depth=2 는 children.children …
- 각 노드: `{id: <ULID>, label: item text}`.
- root 가 2 개 이상이면 첫 번째 root 만 사용 + warning.

**변환 로직 (TableBlock)**:
- name 컬럼 + parent 컬럼 lookup.
- parent="" 인 행이 root; 다른 행은 parent 의 children 에 push.
- 다중 root → 첫 번째만 + warning.

**schema**: OrgChartBlock — required `type`, `id`, `root` (OrgChartNode tree).

**테스트**:
- `test_org_chart_from_indented_list` — 3-level 리스트 → 트리.
- `test_org_chart_from_parent_table` — name/parent 표 → 트리.
- `test_org_chart_unsupported_target_returns_none` — paragraph 타겟.

**소비**: 1.

### 2.5 G5 — `_convert_columns`

**입력**: `targets[0]`–`targets[N-1]` (N = 2..4) consecutive ParagraphBlock 또는 TableBlock cells.

**변환 로직 (multi-block)**:
- variant 가 숫자 "2"/"3"/"4" 면 그 수만큼; 아니면 "default 2".
- 연속된 `paragraph` 또는 `image` 또는 `list` 블록을 N 개 모음 → 각각이 한 칼럼의 single block.
- 모은 개수 < 2 → `None`.

**schema**: ColumnsBlock — required `type`, `id`, `columns` (array of array of Block; minItems 2, maxItems 4).

**테스트**:
- `test_columns_marker_groups_two_paragraphs`.
- `test_columns_marker_with_variant_3_groups_three`.
- `test_columns_marker_single_paragraph_returns_none`.

**소비**: 2-4 (variant 또는 lookahead).

### 2.6 G6 — `_convert_tabs`

**입력**: `targets[0..N-1]` — heading-4 + 본문 paragraph 의 alternating 쌍, 또는 단일 ListBlock (top-level items 가 tab labels).

**변환 로직 (heading + content 쌍)**:
- targets 를 순회하면서 `heading-4` 블록 만나면 새 tab 시작; 이후 다른 `heading-4` 만날 때까지 모든 블록이 그 tab 의 blocks.
- 다른 marker (`Widget: ...`) 만나면 stop (그 marker 는 다음 라운드에서 처리).

**schema**: TabsBlock — required `type`, `id`, `tabs` (each `{label, blocks}`).

**테스트**:
- `test_tabs_marker_with_heading_pairs`.
- `test_tabs_marker_stops_at_next_widget_marker`.

**소비**: N (가변).

### 2.7 G7 — `_convert_accordion`

G6 와 동일한 입력 패턴. AccordionBlock 으로 emit (스키마 동일 구조 — `items` 대신 `tabs` 키 차이만).

**테스트**: tabs 와 거의 동일. `test_accordion_marker_with_heading_pairs`.

**소비**: N.

### 2.8 G8 — `_convert_gallery` (multi-block + 인프라)

**입력**: `targets[0..N-1]` = 연속 ImageBlock N개.

**변환 로직**:
- 첫 ImageBlock 부터 시작해 연속된 image 블록을 모두 모음.
- N=0 → None.
- `items` 배열에 `{imageId, caption?, alt?}` 형태로 변환.
- layout = "grid" (variant "carousel" 이면 carousel).

**schema**: GalleryBlock — required `type`, `id`, `layout`, `items` (minItems 1).

**중요**: 이 generator 가 **multi-block pair 인프라의 첫 사용자**. 메인 thread 가 G8 결과를 먼저 통합하고 회귀 0 확인 후 G5/G6/G7 통합.

**테스트**:
- `test_gallery_marker_groups_consecutive_images`.
- `test_gallery_marker_stops_at_non_image_block`.
- `test_gallery_marker_no_image_returns_none`.

### 2.9 G9 — `_convert_doc_link` (schema type `doc-link-card`)

**입력**: `targets[0]` = ParagraphBlock, text 가 slug (`/[a-z0-9-]+/`) 또는 URL `/docs/<slug>` 형태.

**변환 로직**:
- text 에서 slug 추출 (앞뒤 공백 strip, URL이면 마지막 path segment).
- emit `{type: "doc-link-card", id, slug}`. **type 이 `doc-link` 가 아닌 `doc-link-card`** (스키마 룰).
- slug 검증 실패 → None.

**테스트**:
- `test_doc_link_marker_converts_slug_paragraph`.
- `test_doc_link_marker_emits_doc_link_card_type` — type 명 확인.

**소비**: 1.

### 2.10 G10 — `_convert_glossary` (schema type `glossary-ref`)

**입력**: `targets[0]` = ParagraphBlock, text = term.

**변환 로직**:
- text strip → term.
- emit `{type: "glossary-ref", id, term}`. **type 명 `glossary` 가 아닌 `glossary-ref`**.

**테스트**:
- `test_glossary_marker_converts_term_paragraph`.
- `test_glossary_marker_emits_glossary_ref_type`.

**소비**: 1.

### 2.11 G11 — `_convert_image_annotation`

**입력**: `targets[0]` = ImageBlock, `targets[1]` (optional) = TableBlock with annotation rows.

**변환 로직**:
- emit `{type: "image-annotation", id, image_id: target0.imageId, annotations: []}`.
- targets[1] 이 TableBlock 이고 headers 에 `kind`, `x`, `y` (있고 type 별 추가 필드: arrow 의 from/to, rect 의 w/h, callout 의 text) 가 있으면 annotation 들 채움. 부분만 채워져도 emit (annotations 가능한 만큼).
- image 가 아닌 target → None.

**schema**: ImageAnnotationBlock — required `type`, `id`, `image_id`, `annotations` (array, 빈 array 허용).

**테스트**:
- `test_image_annotation_marker_with_image_only`.
- `test_image_annotation_marker_with_image_and_table`.

**소비**: 1 또는 2.

### 2.12 G12 — 5 simple URL widgets (iframe/video/file/pdf/whiteboard)

**iframe**: target = paragraph (URL). emit `{type: "iframe", id, src: url, title?}`.
**video**: target = paragraph (URL). provider 추정: youtube/vimeo 도메인 매칭 → 해당; 아니면 "intra". emit `{type: "video", id, url, provider}`.
**file**: target = paragraph (filename) — `fileId` 가 없으므로 `_new_id()` 로 placeholder fileId 채우고 name = paragraph text. summary.warnings 에 "file marker 는 fileId 실 연결 불가 — placeholder 만 생성" 추가. **이 5개 중 file 만 정보 손실 가능**, 사용자 알도록 warning.
**pdf**: target = paragraph (URL or filename). file_id 도 placeholder. warning 동일.
**whiteboard**: target = ImageBlock. emit `{type: "whiteboard", id, viewbox: {w: 1000, h: 600}, elements: []}` — 빈 보드 + image 정보 lost. warning "whiteboard marker 는 이미지를 stroke/shape 으로 변환할 수 없어 빈 보드만 생성. 원본 이미지는 별도 image 블록으로 보존됨" — 단 image 블록은 *drop* 되므로 음, 차라리 image 보존이 낫다. **결정**: whiteboard converter 는 항상 None 반환 + summary.warnings 에 "whiteboard 마커는 docx/pptx 에서 변환 불가 — image 보존" 추가 (image 가 살아남는 보수적 선택).

**테스트**:
- `test_iframe_marker_converts_url_paragraph`.
- `test_video_marker_detects_youtube_provider`.
- `test_video_marker_intra_default`.
- `test_file_marker_creates_placeholder_with_warning`.
- `test_pdf_marker_creates_placeholder_with_warning`.
- `test_whiteboard_marker_returns_none_preserves_image`.

**소비**: 1.

### 2.13 G13 — Mixed-cells web render

**작업 범위 (apps/web/src/components/blocks/TableBlock.tsx)**:
- `cell.blocks` 가 array 이고 길이>0 이면 cell 내부에 그 블록들 렌더. paragraph/image/list 만 지원.
- paragraph → `<p>` (또는 `<Inline text={...} />`); image → `<img>` (또는 기존 ImageBlock viewer 컴포넌트 재사용 — 이미 있다면); list → `<ul>` / `<ol>`.
- 그 외 (table/widget) → fallback 텍스트 `[복합 블록]`.
- typecheck 통과 (`cell.text ?? ''` 의 fallback 제거 가능; 새 conditional render 로 대체).

**작업 범위 (apps/web/src/features/editor/blocks/tableCells.ts)**:
- `mergeWith`, `cellsToFlat` 등 helper 가 `cell.blocks` 가 있는 셀을 만나면 merge/flatten 시 *블록 보존* (combineText 대신 blocks 누적 또는 fallback).
- 편집은 deferred — 그냥 read-only 렌더.

**테스트**: 새 Vitest 또는 컴포넌트 테스트 추가는 deferred. typecheck 통과 + 기존 web 테스트 회귀 0 이면 충분.

### 2.14 G14 — TODO 정리 + json codepoint-safe + lat 동기화

**작업 범위**:

1. **`apps/api/app/routers/imports.py` 의 `[:7000]` truncation**:
   - 현재: `_json.dumps(summary, ...)[:7000]` — codepoint 중간에서 cut → UTF-8 corruption.
   - 수정: 새 함수 `_safe_truncate(s: str, max_bytes: int) -> str` — UTF-8 encode 후 max_bytes 까지 자르되 codepoint 경계 보장. 단순 구현: `s.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")`.
   - 헤더 값으로 들어가므로 `\r\n` 도 제거 (헤더 인젝션 방지).

2. **`apps/api/app/services/markdown_export.py:46` 의 cycle 5 TODO**:
   - 본문 확인 후, 현재 코드가 그 TODO 가 해결됐는지 / 여전히 미해결인지 판단.
   - 해결됐으면 TODO 주석 제거; 미해결이면 그대로 두되 cycle 번호를 현재로 갱신 또는 issue 링크.

3. **`docs/lat/imports.md`**:
   - Widget marker 표에 신규 14 항목 추가 (chart/gantt/flow/org-chart/columns/tabs/accordion/gallery/doc-link/glossary/image-annotation/iframe/video/file/pdf/whiteboard).
   - Phase 1 / Phase 2 구분 마킹.

4. **`docs/llm-document-formats.md`**:
   - 모든 "현재 미구현 청사진" 마커 → "Phase 2 구현 완료 (YYYY-MM-DD)" 로 갱신.
   - Section 2.99 / 위젯 표 / 예제들 일관성 유지.

## 3. Verifier agent 시방서 (공통)

**모든 verifier 가 따를 룰**:

1. Read-only (Read/Glob/Grep/Bash 만 사용; Edit/Write 금지).
2. 자기 담당 generator(s) 의 결과만 감사.
3. 출력: 5 영역 (구현 정확성 / schema 적합성 / 테스트 적합성 / 누락 / 위험) 으로 짧게 (각 영역 3-5 bullet, 전체 400 words 이하).
4. 발견된 이슈가 있으면 정확한 file:line + suggested fix.
5. 자기가 직접 고치지 말 것 — 메인 thread 가 결정.

## 4. Integration order (메인 thread)

```
Step 1: Infrastructure (converter signature 확장)
  → 메인 thread 가 직접
  → 기존 callout/kpi-cards 테스트 회귀 0 확인

Step 2: Launch G1..G14 (Opus, 병렬)
  → 각 generator 가 자기 영역 완성
  → 메인 thread 가 patch 검토 후 통합

Step 3: 메인 thread 통합 (각 generator 결과 차례로 apply)
  → 순서: G8 (multi-block 첫 사용자) → G5/6/7 → 나머지 단순들 → G13/G14
  → 각 단계 후 pytest 회귀 0 확인

Step 4: Launch V1..V6 (Sonnet, 병렬)
  → 통합본 read-only 감사
  → 발견된 이슈 메인 thread 가 fix-up

Step 5: 전체 검증
  → 전체 pytest 통과
  → pnpm typecheck 통과
  → make openapi-dump drift 0
  → llm-document-formats.md / lat/imports.md 일관성

Step 6: PDCA Check → Report → Archive → Commit → Push
```

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Converter signature 변경이 Phase 1 회귀 일으킴 | Step 1 후 즉시 회귀 테스트. wrapper 로 호환성 유지. |
| Generator 들 간 dispatcher 등록 충돌 | 각 generator 가 자기 한 줄만 None → 함수명 으로 변경. 메인 thread 가 merge 시 충돌 즉시 발견. |
| ListBlock / CodeBlock / table.meta 의 정확한 schema 모름 | 각 generator 가 schema 먼저 read. 모르면 None 반환 (정보 손실 0). |
| web typecheck 가 mixed-cells 변경에서 다시 깨짐 | G13 generator 가 typecheck 로컬 실행 후 결과 보고. |

## 6. Definition of Done

- WIDGET_CONVERTERS 모든 값이 callable (None 0개).
- 새 테스트 모두 통과 (test_widget_markers.py 가 14 + 기존 = 30개 이상).
- 전체 pytest 회귀 0.
- pnpm typecheck 통과.
- openapi.json drift 0.
- lat/imports.md + llm-document-formats.md 갱신.
- 모든 verifier agent 가 "no blocking issues" 보고.
