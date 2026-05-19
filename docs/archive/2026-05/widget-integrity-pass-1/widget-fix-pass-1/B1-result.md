# B1 Result — BE Export Integrity

> widget-integrity-pass-1 사이클의 B1 (BE export 통합) 작업 결과.
>
> 소유 파일 4개 (`apps/api/app/services/{docx_export,html_renderer,pptx_export,markdown_export}.py`)
> 만 수정. 다른 파일은 *읽기*만 했고, B2 소유의
> `packages/shared/schemas/document.json` 은 손대지 않았다.

## 변경 요약

### G1 — bibliography 3-export 추가 [DONE]

기준: 기존 `docx_export.py:_b_bibliography()` (heading + 번호 매긴 paragraph).
세 렌더러에 동등 핸들러를 추가하고 각자의 `_BLOCK_HANDLERS` 에 등록.

| 파일 | 추가 함수 | 산출 형식 |
|---|---|---|
| `html_renderer.py` | `_b_bibliography(block, ctx) -> str` | `<section class="b-bibliography"><h2>…</h2><ol class="bibliography-list"><li id="cite-{key}">…</li>…</ol></section>`. `key` 가 있으면 `id="cite-{key}"` anchor 유지 → in-document `[[cite:KEY]]` 인라인이 hyperlink로 anchor-link. |
| `markdown_export.py` | `_b_bibliography(block) -> str` | `## {title}` 헤딩 + `1. [{key}] {text} <{url}>` 형식의 번호 리스트. |
| `pptx_export.py` | `_b_bibliography(slide, frame, block, ctx, depth) -> bool` | heading paragraph (bold 16pt) + entry paragraph (bold prefix + body + italic url). |

세 파일 모두 `BLOCK_HANDLERS["bibliography"] = _b_bibliography` 등록.

### G2 — table `options.stripe` 4-export 반영 [DONE]

스키마에 이미 `options.stripe: boolean (default true)` 존재 (확인). 4 렌더러에 옵션 읽어 반영:

| 파일 | 처리 방식 |
|---|---|
| `docx_export.py` | `_table_style_for(block)` 헬퍼 — `stripe=True` (기본) → `"Light Grid Accent 1"` (zebra), `False` → `"Table Grid"` (plain). `_emit_table_flat()` / `_emit_table_cells()` 두 경로 모두 적용. |
| `html_renderer.py` | `_table_class_for(block)` 헬퍼 — `stripe=True` → `class="b-table striped"`, `False` → `class="b-table no-stripe"`. flat / sparse 두 경로 모두 적용. CSS는 사이트 stylesheet 의 `.b-table.striped tr:nth-child(even)` 같은 기존 규칙을 그대로 사용. |
| `markdown_export.py` | markdown 자체는 zebra 표현 불가 → `<!-- stripe:false -->` HTML 주석을 표 앞에 emit (default true 일 땐 주석 없음). round-trip importer 가 주석을 읽어 다시 옵션 복원 가능. |
| `pptx_export.py` | `_apply_table_stripe(table, block)` 헬퍼 — python-pptx 의 `table.horz_banding` 속성 토글. flat / sparse 모두 적용 (`_emit_table_sparse` 시그너처에 `block` 인자 추가). |

### G4 — image `width` enum docx 처리 [DONE]

`docx_export.py:_b_image()` 에서 `ImageBlock.width` (sm/md/lg/full) enum 을
픽셀로 매핑 후 기존 `Inches(width_px / 96)` 변환으로 docx Picture width 지정.
`meta.width` (pixel) 보다 enum 이 *우선*. `full` 은 width 미지정 → intrinsic resolution.

```python
_IMAGE_WIDTH_PX = {"sm": 200, "md": 400, "lg": 600, "full": None}
```

→ docx 결과 inline shape width: sm ≈ 2.08 in, md ≈ 4.17 in, lg ≈ 6.25 in, full = intrinsic.

### G5 — callout docx hidden marker emit [VERIFIED PRE-EXISTING]

A2 audit 보고 (line 95) 는 "docx export 에서 hidden marker 누락" 으로 기술되어
있으나 실제 `docx_export.py:_b_callout()` line 353~357 에 이미 `emit_marker_text()`
+ hidden run 패턴이 존재. 검증 스크립트로 확인:

```
"Widget: callout" in document.xml → True
"w:vanish" present                → True
```

A2 audit 가 사실관계와 다르며, B1 에서 추가 변경 없음. *회귀 테스트*
`test_renderer_callout_emits_hidden_marker_run` 를 신규 추가하여 이후
실수로 marker 가 빠지는 일 방지.

### G6 — list export 의 dict 시도 죽은 코드 제거 [DONE]

`docx_export.py:_b_list()` L300~305 가 `if isinstance(item, dict): …` 분기를
가지고 있었으나 schema 가 `items: { "type": "array", "items": { "type": "string" } }`
로 string-only 임을 명시. dict 분기는 절대 도달 불가. 제거하고 `text = _str(item)`
한 줄로 단순화. `depth` 처리도 같이 제거 (string item 에 depth 없음).

### G2-zebra — spreadsheet `options.stripe` (B2 schema 완료 후) [DONE]

B2 의 `B2-z1-done.flag` 가 존재하고 `document.json` 의 `SpreadsheetBlock` 에
`options.stripe: boolean` 정의 확인 후 진행. `docx_export.py:_b_spreadsheet()`
에서 옵션 읽어 `stripe=True` → `"Light Grid"`, `False` → `"Table Grid"` 스타일 분기.
html_renderer 에 spreadsheet 핸들러는 design §1.2 명시대로 out-of-scope (현재 없음).

## 테스트 결과

```bash
apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && python -m pytest tests/test_docx_export.py tests/test_html_export.py tests/test_markdown_export.py tests/test_pptx_export.py tests/test_docx_roundtrip.py -v'
```

```
collected 92 items
tests/test_docx_export.py .........................   [ 27%]   25 passed
tests/test_html_export.py ...................         [ 47%]   19 passed
tests/test_markdown_export.py ..........................  [ 76%]   26 passed
tests/test_pptx_export.py .................            [ 94%]   17 passed
tests/test_docx_roundtrip.py .....                     [100%]    5 passed
============================== 92 passed in 1.92s =====================
```

이전 baseline 80 + 신규 7 = 87 (+ roundtrip 5 = 92). 모두 통과. 기존 80개 회귀 없음.

### 신규 테스트 7개

| 파일 | 함수 | 검증 |
|---|---|---|
| `test_docx_export.py` | `test_renderer_table_stripe_false_uses_plain_style` | stripe=False → `Table Grid`, default → `Light Grid Accent 1` |
| `test_docx_export.py` | `test_renderer_callout_emits_hidden_marker_run` | `Widget: callout` + `w:vanish` 둘 다 present |
| `test_docx_export.py` | `test_renderer_image_width_enum_drives_picture_size` | width=lg → EMU 5_400_000~6_000_000, width=full → < 914_400 (intrinsic) |
| `test_html_export.py` | `test_renderer_bibliography_emits_heading_and_ordered_list` | `<section class="b-bibliography">` + `id="cite-smith2020"` + URL anchor |
| `test_html_export.py` | `test_renderer_table_stripe_class_reflects_options` | `b-table striped` vs `b-table no-stripe` |
| `test_markdown_export.py` | `test_renderer_bibliography_block_emits_numbered_list` | `## 참고` + `1. [smith2020] …` + `<url>` |
| `test_pptx_export.py` | `test_renderer_bibliography_block_emits_title_and_entries` | heading + entry 텍스트 + `[smith2020]` + URL 모두 슬라이드 텍스트에 |

design §1.3 의 요구 6 개 (bibliography x3 + table stripe + callout marker + image width)
+ html table stripe 회귀 보호 1개 = 7 개.

## 부록

### 변경 라인 수

| 파일 | 변경 |
|---|---|
| `apps/api/app/services/docx_export.py` | +33 / −16 |
| `apps/api/app/services/html_renderer.py` | +49 / −4 |
| `apps/api/app/services/markdown_export.py` | +40 / −3 |
| `apps/api/app/services/pptx_export.py` | +60 / −2 |
| `apps/api/tests/test_*_export.py` (4 파일) | +179 / 0 |

### 발견된 추가 이슈

- **A2 audit 의 callout marker 보고 (line 95) 가 사실관계와 다름** — docx_export
  의 `_b_callout` (L353) 에 이미 `emit_marker_text()` + hidden run 패턴이
  존재. design 명세 작성 단계에서 audit 보고를 그대로 반영한 결과인 듯.
  G5 항목은 *no-op* 처리하되 회귀 테스트만 추가 (`test_renderer_callout_emits_hidden_marker_run`).
- **markdown 의 stripe 옵션 round-trip 은 본 사이클 범위 밖** — `<!-- stripe:false -->`
  주석을 emit 하지만, 이를 다시 import 단에서 읽어 `options.stripe=False`
  로 복원하는 로직은 B4 / 별도 사이클에 위임 (B1 의 export 측만 책임).
- **lat 갱신은 B4 의 책임** — `docs/lat/export.md` 의 Table dispatcher /
  Block dispatcher 표에 `bibliography` 4-export 가능 / table stripe 옵션
  반영 / image width enum 처리됨을 추가해야 함 (현재 lat 은 이 사실을 모름).
  B4 의 S1 항목으로 이미 명시됨.
