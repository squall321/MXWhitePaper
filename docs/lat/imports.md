# Imports lat — Word / PowerPoint / CSV → DocumentJSON

> 외부 문서를 DocumentJSON v1.0 으로 들여오는 모든 흐름. 데이터를 데이터베이스에
> 영구화하는 import 와, 영구화 없이 양식만 정규화하는 **round-trip** 두 모드가
> 공존한다.
>
> 연관 lat: [[documents]] (저장 대상 스키마) · [[storage]] (이미지 처리) ·
> [[export]] (round-trip 의 두 번째 leg) · [[core]] (인증/에러)

## Endpoints

| Method | Path | 인증 | 비고 |
|---|---|---|---|
| POST | `/api/v1/imports/docx` | editor+ | DocumentJSON 반환 → FE 가 별도 `POST /documents` 호출해 저장 |
| POST | `/api/v1/imports/docx/roundtrip` | editor+ | .docx 바이트 반환 (Content-Disposition: `<name>.normalized.docx`). 문서 본문/이미지 영속 없음 — MinIO/Meilisearch 미접근, DB 는 `audit_log` 한 줄만 best-effort insert |
| POST | `/api/v1/imports/pptx` | editor+ | DocumentJSON 반환 |
| POST | `/api/v1/imports/xlsx` | editor+ | DocumentJSON 반환 — 시트=섹션, 표를 widget autodetect 로 분배. 저장 안 함 |
| POST | `/api/v1/imports/pdf` | editor+ | DocumentJSON 반환 — 폰트/표 휴리스틱 + widget autodetect. 저장 안 함 |
| POST | `/api/v1/imports/csv` | admin | 즉시 일괄 영속화 — 행 1 개당 문서 1 개 |

전부 [[src/app/routers/imports.py]] 에 정의. 라우터 모듈 자체에 rate-limit
(5/min/user), 사이즈 캡, zip-magic 검증이 다 들어있다 — 서비스 레이어로 빠뜨리지 말 것.

## 파일 포맷별 import 요약

`docx`/`pptx`/`xlsx`/`pdf` 4종 모두 `{document, summary}` (DocumentJSON v1.0)
를 반환하고 **본문은 저장하지 않는다** (FE 가 별도 `POST /documents` 호출).
넷 다 본문 walk 직후 [[#widget-marker-post-pass]] + [[#widget-auto-detect-post-pass-phase-3]]
(`apply_widget_markers` + `apply_widget_autodetect`) 를 동일하게 태운다. autodetect 의
블록-레벨 인식기는 **callout / kpi-cards / gantt / gallery 4종뿐** (chart 인식기는
없음) — 일반 숫자 표는 TableBlock 으로 보존되고, label/value 헤더는 KpiCards,
name/start/end 헤더는 Gantt 로만 승격된다. 차트는 `Widget: chart` 마커나 (xlsx 의)
embedded 차트로 생성.

| 포맷 | 진입 함수 | 위젯 분배 방식 | 한계 |
|---|---|---|---|
| docx | [[src/app/services/docx_import.py#docx_to_document]] | 스타일/dotted-prefix 로 섹션 트리, 표/이미지/목록/코드/수식/각주 인식 + 위젯 마커 + autodetect | SVG skip, header/footer 는 callout 1개로 통합 |
| pptx | [[src/app/services/pptx_import.py#pptx_to_document]] | 슬라이드=섹션, placeholder/textbox 텍스트 + 표, speaker note 분리 + 위젯 마커 + autodetect | 셀 안 picture 불허, 절대위치 레이아웃은 stack 으로 평탄화 |
| xlsx | [[src/app/services/xlsx_import.py#xlsx_to_document]] | 시트=섹션, 표→TableBlock (200행 초과는 SpreadsheetBlock), embedded 차트→ChartBlock, label/value·name/start/end 표는 kpi/gantt 로 autodetect | `data_only=True` (수식 대신 캐시값) — 캐시 없으면 빈 셀. 일반 숫자 표는 차트 자동변환 안 함 (표 유지) |
| pdf | [[src/app/services/pdf_import.py#pdf_to_document]] | 폰트크기>본문×1.15 면 heading, `find_tables()` 로 표, dotted-prefix 섹션 승격 + autodetect | 구조 휴리스틱 (정확도=원본 PDF 구조 품질), 이미지는 placeholder + warning |

## Pipeline overview

```text
            ┌────────────────────────────────────────────────────────────┐
            │ POST /imports/docx (또는 /pptx)                             │
            ├────────────────────────────────────────────────────────────┤
            │ 1. 인증 + rate-limit + 사이즈/매직바이트 검증              │
            │ 2. _preprocess_zip_images()  ── 이미지 sha256 → ULID 맵 생성│
            │ 3. docx_to_document()  ── XML 파싱 → DocumentJSON          │
            │ 4. 감사 로그 best-effort INSERT                            │
            │ 5. {document, summary} JSON 응답                           │
            └────────────────────────────────────────────────────────────┘
```

`/imports/docx/roundtrip` 만 2 번 단계를 **건너뛰고**, 대신 import 가 이미지
바이트를 메모리에 잡아두었다가 export 에 넘긴다 (아래 [[#round-trip]] 참고).

## 핵심 진입점

| 함수/엔드포인트 | 위치 | 책임 |
|---|---|---|
| `import_docx()` | [[src/app/routers/imports.py#import_docx]] | docx 라우터 |
| `roundtrip_docx_endpoint()` | [[src/app/routers/imports.py#roundtrip_docx_endpoint]] | round-trip 라우터 |
| `import_pptx()` | [[src/app/routers/imports.py#import_pptx]] | pptx 라우터 |
| `import_csv()` | [[src/app/routers/imports.py#import_csv]] | csv 일괄 라우터 |
| `docx_to_document()` | [[src/app/services/docx_import.py#docx_to_document]] | docx → DocumentJSON 의 마스터 진입점 |
| `roundtrip_docx()` | [[src/app/services/docx_roundtrip.py#roundtrip_docx]] | round-trip 글루 |
| `detect_toc()` / `verify_toc()` | [[src/app/services/toc_extract.py]] | 수동 TOC 검출/대조 |
| `_preprocess_zip_images()` | [[src/app/routers/imports.py#_preprocess_zip_images]] | zip 안 이미지 → MinIO 미리 업로드 |
| `build_minimal_docx()` | [[src/app/services/docx_import.py#build_minimal_docx]] | 테스트용 in-memory docx 생성기 |

## docx_import 의 내부 단계

[[src/app/services/docx_import.py]] 는 2k+ 줄짜리 단일 파일이지만 흐름은
선형이다:

```text
docx_to_document(buf, slug, title, owner_user_id, image_uploader, ...)
  │
  ├─ _ImportContext 생성 (numbering, styles, summary 누적)
  ├─ TOC 검출 (옵션) → ctx.toc_skip_ids 채움
  ├─ _build_sections(body)
  │    │
  │    ├─ 모든 <w:p>, <w:tbl> 를 순회
  │    ├─ heading 스타일 / dotted-prefix 로 섹션 트리 구축
  │    ├─ table / image / list / code / math / footnote 인식
  │    └─ caption 휴리스틱 (Caption 스타일 + 텍스트 패턴)
  └─ {document: ..., summary: ImportSummary} 반환
```

### 섹션 계층화 규칙 ★

- Word 의 `Heading 1` ~ `Heading 9` 스타일이 1차 신호.
- "**3.1.2.3 Foo**" 같은 dotted numbering 이 더 강한 신호 — 스타일이
  `Heading 1` 이어도 dotted depth 가 4 면 **depth 4 로 승격**.
- 그래서 import 후 섹션 트리에서 `level` 은 `max(style_level, dotted_depth)`.
- 일반 단락이라도 "**2.1 Background**" 처럼 dotted-prefix 면 **섹션으로 승격**.

근거 함수: `_dotted_depth()`, `_promote_unstyled_dotted_heading()` 인근.

### Widget marker post-pass

`docx_to_document()` / `pptx_to_document()` 가 본문 walk 를 마친 직후
[[src/app/services/widget_markers.py#apply_widget_markers]] 를 호출.
규칙: 단락 텍스트가 `^(Widget|위젯):\s*<type>\s*(\(<variant>\))?$` 매치하면
*다음* 블록과 묶여 위젯 블록으로 rewrite.

| 위젯 타입 | Phase | 변환 함수 | 동작 |
|---|---|---|---|
| `callout` | 1 | `_convert_callout` | 다음 단락 → CalloutBlock (variant: info/warn/danger/tip) |
| `kpi-cards` | 1 | `_convert_kpi_cards` | 다음 표 → KpiCardsBlock (헤더 label/value/delta?/trend?) |
| `chart` | 2 | `_convert_chart` | 다음 표 (categories, series N개) → ChartBlock |
| `gantt` | 2 | `_convert_gantt` | 다음 표 (Task, Start, End, Owner?, Progress?) → GanttBlock |
| `flow` | 2 | `_convert_flow` | 다음 code block (mermaid DSL) → FlowBlock |
| `org-chart` | 2 | `_convert_org_chart` | 다음 들여쓰기 목록 → OrgChartBlock |
| `columns` | 2 | `_convert_columns` | 다음 표 (N 컬럼 = N 단) → ColumnsBlock |
| `tabs` | 2 | `_convert_tabs` | 다음 heading-4 시리즈 + 본문 → TabsBlock |
| `accordion` | 2 | `_convert_accordion` | 다음 heading-4 시리즈 + 본문 → AccordionBlock |
| `gallery` | 2 | `_convert_gallery` | 다음 연속 이미지 → GalleryBlock. 이미지가 round-trip 중 소실되면 placeholder item 1개로 GalleryBlock 만들고 warning. consume 0 → 후속 paragraph 보존. |
| `doc-link` † | 2 | `_convert_doc_link` | 다음 단락 (slug 또는 `/docs/<slug>` URL) → DocLinkCardBlock |
| `glossary` † | 2 | `_convert_glossary` | 다음 단락 → GlossaryRefBlock |
| `image-annotation` | 2 | `_convert_image_annotation` | 다음 이미지 + 표 (kind/x/y/from_*/to_*/w/h/text/color) → ImageAnnotationBlock. 이미지 소실 + 표만 → placeholder image_id 발급 (warning). 둘 다 없으면 → placeholder block emit (empty annotations + new image_id) consume 0 |
| `iframe` | 2 | `_convert_iframe` | 다음 URL 단락 (text가 http(s):// 로 시작) → IframeBlock |
| `video` | 2 | `_convert_video` | 다음 URL 단락 (host 로 provider 추론) → VideoBlock |
| `file` | 2 | `_convert_file` | 다음 하이퍼링크 단락 → FileBlock (fileId placeholder) |
| `pdf` | 2 | `_convert_pdf` | 다음 하이퍼링크 단락 → PdfBlock (file_id placeholder) |
| `whiteboard` | 2 | `_convert_whiteboard` | placeholder WhiteboardBlock (빈 elements + viewbox 1000×600). docx 가 strokes 표현 불가 → strokes 데이터 손실, 그러나 widget identity 는 보존. consume 0 → marker 만 소비, 후속 target 보존. |

### Widget auto-detect post-pass (Phase 3)

`apply_widget_markers` 직후 [[src/app/services/widget_markers.py#apply_widget_autodetect]]
가 한 번 더 본문을 훑어, **마커 없는** 블록이라도 컨텐츠 모양만으로 위젯을
추론한다. 마커-처리된 블록은 이미 위젯 타입이라 type 검사로 자연스럽게
skip — 이중 변환 없음.

| 인식기 | 트리거 | 출력 |
|---|---|---|
| `_autodetect_callout` | (a) 1×1 표 + (배경색 OR 알림 이모지 ⚠️🚨ℹ️💡✅ OR 라벨 `[정보]`/`[주의]`/`[경고]`/`[위험]`/`[팁]`) — `_autodetect_callout_from_table`; **또는** (b) 단락 + `<w:shd w:fill="…"/>` 음영 **AND** (알림 이모지 OR 라벨) — `_autodetect_callout_from_paragraph` (둘 다 strict: 음영 + 이모지/라벨 양쪽 필요) | CalloutBlock (variant 추론) |
| `_autodetect_kpi_cards` | 헤더 `label`+`value` (옵션 `delta`/`trend`), 행 1~4개 | KpiCardsBlock |
| `_autodetect_gantt` | 헤더 `name`/`task`/`작업`/`이름` + `start`/`시작` + `end`/`종료` (옵션 `progress`) | GanttBlock |
| `_autodetect_gallery` | 연속 3개 이상 ImageBlock | GalleryBlock (layout=grid) |

블록-레벨 dispatcher 직후 별도 sibling 함수 [[src/app/services/widget_markers.py#apply_section_column_autodetect]] 가 한 번 더 돈다. 이건 블록 모양이 아니라 **섹션 메타**에서 신호를 읽는다:

| 인식기 | 트리거 | 출력 |
|---|---|---|
| `apply_section_column_autodetect` | docx body 의 `<w:sectPr><w:cols w:num="N"/></w:sectPr>` (N ∈ 2..4) — [[src/app/services/docx_import.py#_parse_sect_cols]] 가 `section["multi_column"]=N` 으로 surface | 섹션의 blocks 전체를 N 등분해서 단일 ColumnsBlock 으로 wrap (마커-처리 / 블록-autodetect 결과 위젯도 보존) |

False positive 회피: 신호 없는 1×1 표 / 5+행 KPI 표 / chart-style 헤더 (`Month/Revenue`) / 2-image 시퀀스 등은 변환 안 함. 2-column 인지 일반 2-column 표인지 구별이 어려운 `columns` 는 **블록-레벨 autodetect 에서 의도적으로 제외** — 사용자가 Word "단" 으로 명시한 `<w:cols>` 만 신호로 사용.

자동 인식된 블록의 audit trail 은 `summary.warnings` 에 `"auto-detected <type> from ..."` 형태로 기록.
`BlockMeta` schema 가 `additionalProperties: false` 라 `meta.auto_detected` 필드 사용 불가 — warnings 만이 audit 채널.

테스트: [[src/tests/test_widget_autodetect.py]] — 4 블록-레벨 인식기 + section-column + 가드 + DOCX 통합 (carry-on 사이클들로 카운트는 변동).

† 마커 이름과 스키마 타입이 다름: `doc-link` → DocLinkCardBlock (`doc-link-card`),
`glossary` → GlossaryRefBlock (`glossary-ref`). 마커 텍스트는 사용자 친화적
짧은 이름을 그대로 받는다.

`file` / `pdf` 의 fileId 는 실제 파일 업로드가 아닌 **placeholder** — import 후
에디터에서 첨부 파일을 다시 연결해야 한다. `whiteboard` 는 마커 뒤 이미지를
보존하는 fallback 만 수행 (변환 함수가 None 반환).

미지원 위젯 타입 (dispatcher 미등록) 은 marker 텍스트가 보존됨 (false
positive 회피). 변환 실패 (잘못된 target 타입 / 누락 헤더) 시도 marker +
target 둘 다 보존 — 정보 손실 0.

마커 없는 문서는 영향 없음 — 835 회귀 테스트 통과 (Phase 2 완료 후).

테스트: [[src/tests/test_widget_markers.py]] — 72 케이스 (regex, dispatcher,
recursion, 16 위젯 converter 별 단위 + 음성 케이스, docx 라운드트립, 마커 미존재 가드).

LLM 작성 가이드: [[docs/llm-document-formats.md]] 의 "Phase 1 위젯 마커 룰" 참고.

### Mixed-content table cells

셀이 `<w:drawing>` 또는 nested `<w:tbl>` 을 가지면 [[src/app/services/docx_import.py#_table_cell_content]]
가 flat `text` 대신 `blocks` 리스트를 반환 — paragraph + image (+ list) 가
한 셀 안에 공존. 이때 `_build_table_block()` 은 자동으로 sparse `cells` 모드로
전환되어 (`has_mixed` 플래그) one-of 계약을 유지한다. PowerPoint 는 포맷
자체가 셀 안 picture 를 불허해 pptx_import 측은 변경 없음.

**Nested table 처리**: CellBlock 스키마가 `paragraph | image | list` 3 종만
허용하므로 nested TableBlock 은 거부된다. [[src/app/services/docx_import.py#_flatten_nested_table]]
가 각 nested row 를 `" | "` 로 join 한 ParagraphBlock 1개로 평탄화 — 구조는
잃지만 데이터 손실 0. summary.warnings 에 `"nested table flattened to N
paragraph(s)"` 가 들어가 사용자가 인지 가능.

테스트: [[src/tests/test_mixed_cells.py]] — 4 렌더러 + docx 라운드트립 + 스키마 정규화.
nested table: [[src/tests/test_imports.py#test_nested_table_in_cell_flattened_to_paragraphs]].

### Caption 휴리스틱

Word 의 `Caption` 스타일이 있으면 우선 사용. 없을 때는 정규식
(`표 1: …`, `그림 1: …`, `Figure 1: …`) 매칭으로 직전/직후 figure/table 에
caption 으로 묶는다 — [[src/app/services/docx_import.py#_looks_like_caption_text]].
캡션 단락이 본문 paragraph 로 중복 surface 되지 않도록 주의 — 테스트
[[src/tests/test_imports.py#test_caption_pattern_without_style_attaches_to_table]]
가 가드.

**L9 가드** — `_CAPTION_LIKE_RE` 는 separator (`:` / `.` / `-` / `)`) 가
text 와 함께 있을 때만 매치한다. ``Figure 1 shows our results`` 같이
separator 없는 본문 prose 는 caption 으로 슬립되지 않음 (의도된 회귀
가드: [[src/tests/test_imports.py#test_caption_pattern_requires_separator_not_prose]]).
title-only caption (``Figure 1`` 단독 한 줄) 은 separator 없이도 허용 —
``\d+(?:\s*$)`` 분기.

### TOC detection (요약)

| Method | 방법 | 신뢰도 |
|---|---|---|
| A | `<w:sdt>` + `docPartGallery val="Table of Contents"` | 강 |
| B | 단락 스타일이 `TOC1` / `TOC2` / `목차1` / `목차2` 등 | 강 |
| C | `<w:fldChar>` + `<w:instrText>` 가 `TOC ` 포함 | 강 |
| D | "목차/차례/Contents" 헤더 다음에 leader-dot 라인 ≥2 — opt-in (`aggressive_toc=true`) | 약 |

`verify_toc(toc_entries, sections)` 가 본문 헤딩과 비교해 `missing` / `extra`
배열 생성. 약한 휴리스틱 (D 만) + missing/extra 가 있으면 round-trip CLI 는
별도 `<name>.toc-report.json` 사이드카를 추가로 떨군다.

## Round-trip 모드 ★

`roundtrip_docx(buf, *, slug, title, owner_user_id, strip_toc, verify_toc,
aggressive_toc)` ([[src/app/services/docx_roundtrip.py]]) 가 핵심:

```text
buf (bytes)
  │
  ▼
docx_to_document(roundtrip_mode=True, image_uploader=None)
  │
  ├─ TOC 검출/스트립 (옵션)
  ├─ 이미지 바이트를 summary.captured_images 에 보존 (MinIO 미접근, 메모리만)
  ▼
DocumentJSON + summary.captured_images
  │
  ├─ _make_image_resolver(captured) 로 resolver 생성
  ▼
render_docx(document, options=DocxOptions(image_resolver=resolver))
  │
  ▼
out_bytes (normalized .docx)
```

**왜 import + export 를 그냥 두 번 호출하지 않는가?**
- 단순 조합은 (a) 이미지를 MinIO 에 한 번 올렸다가 다시 받기 → 영속화
  부작용 + 자격증명 필요, (b) image_uploader 미설정시 이미지 분실.
- roundtrip mode 는 원본 이미지 바이트를 **메모리에서만** 통과시켜
  부작용 0 + 무자격증명 동작을 보장.

### Round-trip API 응답 헤더

`X-MXWP-Roundtrip-Sections`, `Images`, `Tables`, `Warnings`,
`Toc-Found` (`true`/`false`), `Toc-Entries`, `Toc-Missing`, `Toc-Extra`,
`Toc-Method` (예: `"A B"`), `Toc-Heuristic` (`weak`/`strong`),
그리고 JSON 전체 요약은 `X-MXWP-Roundtrip-Summary` 에 압축 (7000자 컷).

테스트: [[src/tests/test_imports_roundtrip.py]].

### CLI: `mxwp-roundtrip`

서버사이드 venv 진입점 [[src/app/cli/roundtrip.py#main]]. 폴더 안의 모든 .docx
를 round-trip API 로 일괄 호출:

```bash
mxwp-roundtrip --input ./raw --output ./normalized \
  --base-url http://localhost:8000 --token "$MXWP_API_TOKEN" \
  --concurrency 4
```

플래그: `--strip-toc`/`--no-strip-toc`, `--verify-toc`/`--no-verify-toc`,
`--aggressive-toc`, `--skip-existing`, `--dry-run`,
`--continue-on-error`, `--report PATH`.

사이드카: `<name>.normalized.report.json` (성공) / `<name>.report.json` (실패) /
`<name>.toc-report.json` (TOC 의심) + 폴더 집계 `_report.json`.

## 이미지 업로드 사전 처리 ★

`/imports/docx` 와 `/imports/pptx` 는 **converter 가 동작하기 전에** zip
안의 이미지들을 모두 추출해 MinIO + `images` 테이블에 미리 올린다 —
[[src/app/routers/imports.py#_preprocess_zip_images]].

흐름:
1. zip 내 `word/media/` 또는 `ppt/media/` 의 각 이미지 sha256 추출
2. 기존 sha256 매치하면 그 ULID 재사용 (cross-doc dedup)
3. 신규면 Pillow 로 EXIF 제거 + 3 variant (thumb/view/orig) WebP 생성
4. MinIO put + `images` 테이블 INSERT, 커밋
5. `{sha256 → ulid}` 맵 반환

그 다음 `_build_image_uploader(sha_to_ulid)` 가 sync callable 을 만들어
converter 가 이미지를 만날 때마다 sha 로 ULID 를 조회한다. 매치 안 되면
`None` → converter 는 그 이미지를 dropping (조용히).

**과거 버그**: pre-pass 가 없을 때 converter 가 placeholder ULID 를 발급했고,
이게 `images` 테이블에 없어 FE 가 404. 그래서 모든 import 흐름은 반드시
이 pre-pass 를 거친다 — 단 roundtrip 모드는 예외 (DB 안 씀).

자세한 이미지 파이프라인은 [[storage]] 참고.

## CSV 일괄 import

[[src/app/routers/imports.py#import_csv]] (admin only). 한 줄이 한 문서.

| 컬럼 | 필수 | 비고 |
|---|---|---|
| `title` | ✅ | 200자 컷 |
| `slug` | | 비면 title 슬러그화 |
| `summary` | | 500자 컷 |
| `division` | | 기본값은 settings.import_default_division |
| `team`/`group`/`part` | | metadata 에 보존 |
| `tags` | | `,` 또는 `|` 분리 |
| `owners` | | `|` 분리. 없으면 호출자 이메일 1 개 사용 |
| `confidentiality` | | `public`/`internal`/`restricted` 만 허용 |
| `body` | | `\n\n` 단위로 paragraph block |

원자성: 모든 행을 **선검증** → 한 행이라도 파싱 실패면 0 행 import.
slug 중복은 `skipped` 로 카운트 (에러 아님).

오너 이메일 결정 순서: `X-MXWP-User` 헤더 → 로그인 사용자 이메일 →
**없으면 422 거부**. 예전엔 `"admin"` 문자열 fallback 이 있었으나
실제 이메일이 아닌 값이 owners 에 박혀 다운스트림이 깨졌음 — 제거됨.

## Settings (`app.core.config`)

| 키 | 기본 | 의미 |
|---|---|---|
| `docx_import_max_bytes` | 30 MB | docx 업로드 사이즈 캡 |
| `pptx_import_max_bytes` | 50 MB | pptx 업로드 사이즈 캡 (pptx 가 docx 대비 2-3× 크기 → 별도 캡) |
| `xlsx_import_max_bytes` | 20 MB | xlsx 업로드 사이즈 캡 |
| `pdf_import_max_bytes` | 30 MB | pdf 업로드 사이즈 캡 |
| `csv_import_max_bytes` | 5 MB | |
| `csv_import_max_rows` | 500 | |
| `import_rate_limit_per_minute` | 5 | rate-limit 한도 |
| `import_default_division` | `MX` | CSV `division` 누락 시 |
| `import_default_confidentiality` | `internal` | CSV 동일 |
| `minio_bucket_images` | — | 이미지 bucket 이름 |

`_docx_max_bytes()`, `_csv_max_bytes()` 같은 헬퍼는 router 안에 있고
**테스트에서 캡 값을 참조할 때는 헬퍼를 호출** — 상수를 직접 import 하지 말 것.

## Gotchas (자주 발 걸리는 곳)

1. `roundtrip` 모드에선 `image_uploader=None` 이지만 결과 docx 의
   이미지는 **보존된다** — `captured_images` 로 메모리 전달이기 때문.
   테스트에서 `sha256` 비교로 검증.
2. Multipart 폼의 boolean 필드는 string 으로 들어옴 — `_bool_form()` 헬퍼
   ([[src/app/routers/imports.py#_bool_form]]) 거쳐서 파싱. FastAPI 의
   pydantic-driven coercion 에 의존하지 말 것.
3. `is_docx_content()` 는 zip 안에 `word/document.xml` 가 있는지까지 확인.
   `is_docx_zip_magic()` 만으로는 잘못된 zip 도 통과한다.
4. SVG 이미지는 Pillow 로 못 다뤄서 pre-pass 에서 **skip**. 결과 문서에서
   해당 figure 가 사라지지만 [[src/app/routers/imports.py#_preprocess_zip_images]]
   가 skip 한 SVG 파일명을 반환하고, docx/pptx import 라우터가 이를
   `summary.warnings` 에 `"SVG 이미지 N장 처리 안 됨 (Pillow 미지원): …"` 으로
   기록 — 사용자가 즉시 인지 가능 (silent drop 방지).
5. Round-trip 응답 헤더의 모든 카운트는 **문자열** — 테스트에서
   `int(headers["X-MXWP-Roundtrip-Sections"])` 식으로 캐스팅.
6. 라우터 모듈에 in-process rate-limit (`_history` 딕셔너리) 이 있어
   분산 환경에선 cluster-aware redis-bucket 으로 교체 필요 (현재 단일 노드).
7. **Check-list round-trip** — docx_export 는 모든 check item 앞에 `☐ ` 만 박는다
   (현재 export 는 unchecked 변종뿐). import 측 [[src/app/services/docx_import.py#_flush_list]]
   은 list 내 *모든* item 이 check prefix (`☐`/`□`/`☑`/`■`/`✅`) 로 시작할 때만
   `style:"check"` 로 승격 — 혼합 list 는 안전하게 일반 bullet 유지 (텍스트 보존).
   per-item checked 상태는 schema 의 `items: string[]` 컨벤션을 따라 web prefix
   `[x] ` / `[ ] ` 로 인코딩하지만, 본문에 이미 있으면 중복 마킹 안 함 (idempotent).
8. **Header/Footer** — `word/header*.xml` / `word/footer*.xml` 의 텍스트만
   [[src/app/services/docx_import.py#_extract_header_footer_text]] 가 추출해서
   첫 섹션 최상단에 `CalloutBlock(variant="info", title="문서 상단/하단 정보")`
   1개로 통합 — 사용자가 문서 시작부에서 즉시 인지 가능. 페이지 번호 같은
   동적 필드는 텍스트 그대로 (재구성 안 함). round-trip export 측엔 별도
   header/footer 재구성 로직 없음 — 회수된 callout 은 일반 본문 callout 처럼
   다시 export 된다.
9. **PDF 는 휴리스틱** — 폰트 크기 (>본문×1.15) 로 heading, `find_tables()` 로
   표를 추정한다. fitz 의 builtin 폰트가 한글 글리프를 갖지 않아 **테스트
   fixture 는 ASCII** 로 작성한다 — 실제 PDF 는 임베드 폰트로 한글 텍스트
   추출이 정상 동작한다. 정확도는 원본 PDF 의 구조 품질에 비례.

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_imports.py]] | docx import HTTP 레벨 + 직접 호출 단위 |
| [[src/tests/test_imports_roundtrip.py]] | round-trip 엔드포인트 — 이미지 보존, TOC strip/verify, 헤더, 422 |
| [[src/tests/test_imports_csv.py]] | CSV import — 행 검증, owners, 충돌 |
| [[src/tests/test_docx_roundtrip.py]] | docx_export → docx_import 라운드트립 (CLI 와는 별개) |
| `src/tests/test_cli_roundtrip.py` | CLI 단위 (**미작성 — 예정**, Copilot 위임, `docs/copilot/roundtrip-cli-tests.md`. 파일 생성 시 위키링크로 승격) |
