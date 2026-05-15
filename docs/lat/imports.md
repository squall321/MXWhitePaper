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
| POST | `/api/v1/imports/docx/roundtrip` | editor+ | .docx 바이트 반환 (Content-Disposition: `<name>.normalized.docx`). DB/MinIO 무접근 |
| POST | `/api/v1/imports/pptx` | editor+ | DocumentJSON 반환 |
| POST | `/api/v1/imports/csv` | admin | 즉시 일괄 영속화 — 행 1 개당 문서 1 개 |

전부 [[src/app/routers/imports.py]] 에 정의. 라우터 모듈 자체에 rate-limit
(5/min/user), 사이즈 캡, zip-magic 검증이 다 들어있다 — 서비스 레이어로 빠뜨리지 말 것.

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

[[src/app/services/docx_import.py]] 는 1837 줄짜리 단일 파일이지만 흐름은
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

| 위젯 타입 | Phase 1 변환 함수 | 동작 |
|---|---|---|
| `callout` | `_convert_callout` | 다음 단락 → CalloutBlock (variant: info/warn/danger/tip) |
| `kpi-cards` | `_convert_kpi_cards` | 다음 표 → KpiCardsBlock (헤더 label/value/delta?/trend?) |
| `chart`, `gantt`, `flow`, `org-chart`, `columns`, `tabs`, `accordion`, `gallery`, `doc-link`, `glossary`, `image-annotation`, `iframe`, `video`, `file`, `pdf`, `whiteboard` | `None` (Phase 2 hook) | 마커 paragraph 만 소비 + warning + target 블록은 평소대로 emit |

미지원 위젯 타입 (dispatcher 미등록) 은 marker 텍스트가 보존됨 (false
positive 회피). 변환 실패 (잘못된 target 타입 / 누락 헤더) 시도 marker +
target 둘 다 보존 — 정보 손실 0.

마커 없는 문서는 영향 없음 — 778 회귀 테스트 통과.

테스트: [[src/tests/test_widget_markers.py]] — 15 케이스 (regex, dispatcher,
recursion, docx 라운드트립, 마커 미존재 가드).

LLM 작성 가이드: [[docs/llm-document-formats.md]] 의 "Phase 1 위젯 마커 룰" 참고.

### Mixed-content table cells

셀이 `<w:drawing>` 을 가지면 [[src/app/services/docx_import.py#_table_cell_content]]
가 flat `text` 대신 `blocks` 리스트를 반환 — paragraph + image (+ list) 가
한 셀 안에 공존. 이때 `_build_table_block()` 은 자동으로 sparse `cells` 모드로
전환되어 (`has_mixed` 플래그) one-of 계약을 유지한다. PowerPoint 는 포맷
자체가 셀 안 picture 를 불허해 pptx_import 측은 변경 없음.

테스트: [[src/tests/test_mixed_cells.py]] — 4 렌더러 + docx 라운드트립 + 스키마 정규화.

### Caption 휴리스틱

Word 의 `Caption` 스타일이 있으면 우선 사용. 없을 때는 정규식
(`표 1: …`, `그림 1: …`, `Figure 1: …`) 매칭으로 직전/직후 figure/table 에
caption 으로 묶는다 — [[src/app/services/docx_import.py#_looks_like_caption_text]].
캡션 단락이 본문 paragraph 로 중복 surface 되지 않도록 주의 — 테스트
[[src/tests/test_imports.py#test_caption_pattern_without_style_attaches_to_table]]
가 가드.

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
  ├─ 이미지 바이트를 summary.captured_images 에 보존 (DB/MinIO 무접근)
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
| `docx_import_max_bytes` | 30 MB | docx/pptx 사이즈 캡 |
| `pptx_import_max_bytes` | 30 MB | |
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
4. SVG 이미지는 Pillow 로 못 다뤄서 pre-pass 에서 **skip** — 결과 문서에서
   해당 figure 가 사라질 수 있음.
5. Round-trip 응답 헤더의 모든 카운트는 **문자열** — 테스트에서
   `int(headers["X-MXWP-Roundtrip-Sections"])` 식으로 캐스팅.
6. 라우터 모듈에 in-process rate-limit (`_history` 딕셔너리) 이 있어
   분산 환경에선 cluster-aware redis-bucket 으로 교체 필요 (현재 단일 노드).

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_imports.py]] | docx import HTTP 레벨 + 직접 호출 단위 |
| [[src/tests/test_imports_roundtrip.py]] | round-trip 엔드포인트 — 이미지 보존, TOC strip/verify, 헤더, 422 |
| [[src/tests/test_imports_csv.py]] | CSV import — 행 검증, owners, 충돌 |
| [[src/tests/test_docx_roundtrip.py]] | docx_export → docx_import 라운드트립 (CLI 와는 별개) |
| [[src/tests/test_cli_roundtrip.py]] | CLI 단위 (예정 — Copilot 위임, `docs/copilot/roundtrip-cli-tests.md`) |
