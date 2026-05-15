# Mixed-content Table Cells — PDCA 완료 보고

## Executive Summary

| 항목 | 값 |
| --- | --- |
| Feature | mixed-table-cells |
| Started | 2026-05-15 |
| Completed | 2026-05-15 |
| Duration | 1 session |
| Match Rate | 100% |
| Tests | 6 신규 + 759 회귀 통과 |
| Files changed | 9 (schema 2 + service 1 + renderers 4 + importer 1 + tests 1) |
| Docs synced | 3 lat 파일 + 1 plan + 1 design + 1 analysis |

### 1.3 Value Delivered (4 perspectives)

| 관점 | 결과 |
| --- | --- |
| **Problem** | 사내 PPT 의 50%+ 가 "사진 + 설명 + 숫자" 혼합 셀 표를 쓰는데, 기존 `Cell.text: str` 만 지원 → 이미지 통째 손실 + 의미 평탄화. |
| **Solution** | `Cell` 에 `blocks: list[CellBlock]` 옵션 필드 추가. CellBlock 은 paragraph/image/list 셋으로 좁힘. one-of contract 은 service 정규화 (`_normalise_table_cells`) 로 강제. |
| **Function / UX** | docx 의 혼합 셀이 import → DocumentJSON → export 라운드트립을 거쳐도 셀 안 이미지/단락/리스트 보존. 4 렌더러 (md/html/docx/pptx) 모두 새 모드 지원. |
| **Core Value** | PPT 베이스 사내 자료 → 구조화 DocumentJSON 변환 파이프라인의 마지막 누락 조각 해결. |

---

## 1. Pipeline 요약

| Phase | 산출물 | 결과 |
|---|---|---|
| Plan | `docs/01-plan/features/mixed-table-cells.plan.md` | 9 단계 상세 plan, 위험 4 건 명시 |
| Design | `docs/02-design/features/mixed-table-cells.design.md` | SSOT codegen 다이어그램, 모듈별 책임표 |
| Do | 9 파일 수정 (아래 변경 내역) | 모든 단계 implement |
| Check | `docs/03-analysis/mixed-table-cells.analysis.md` | gap-detector 결과 100% |
| Act | (불필요 — Match Rate >= 90%) | skip |

---

## 2. 변경 내역

### 2.1 Schema (SSOT)

- `packages/shared/schemas/document.json` — `CellBlock` $def 신규 (oneOf: Paragraph/Image/List), `Cell.required` 에서 `text` 제거, `Cell.blocks` 옵션 필드 추가.
- `apps/api/app/schemas/document.py` — `pnpm -w schema:gen` 으로 자동 재생성. `CellBlock(RootModel[ParagraphBlock | ImageBlock | ListBlock])`, `Cell.text: str | None`, `Cell.blocks: list[CellBlock] | None`.

### 2.2 Service

- `apps/api/app/services/document_service.py` — `_normalise_table_cells()` 추가, `validate_documentjson()` 흐름 안 `_normalise_columns_widths()` 뒤에서 호출. 모든 cells 를 walk 하면서 `text` & `blocks` 동시 존재 시 `text` 제거, 둘 다 비면 `text=""` 채움. columns/tabs/accordion 안의 table 도 재귀.

### 2.3 Renderers (4)

| 모듈 | 변경 |
|---|---|
| `markdown_export.py` | `_b_table()` 가 `cells` 분기 → `_b_table_sparse()`. `_flatten_cell_md()` 가 셀 안 paragraph/image/list 를 inline markdown 으로 평탄화. |
| `html_renderer.py` | `_b_table()` 가 `cells` 분기 → `_b_table_sparse_html()`. `_render_cell_html()` 가 paragraph `<p>` / image `<img data-image-id>` / list `<ul>` 직조. rowSpan/colSpan attr 보존. |
| `docx_export.py` | `_emit_table_cells()` 안에서 셀이 `blocks` 가지면 `_emit_cell_blocks()` 위임. 이미지는 셀 paragraph 안에서 실제 `add_picture()` (resolver miss 시 텍스트 폴백). list 는 prefix 가 붙은 paragraph 들로. |
| `pptx_export.py` | `_b_table()` 가 cells 분기 → `_emit_table_sparse()`. `_fill_cell_blocks_pptx()` 가 paragraph/list 는 텍스트로, image 는 `[image: <label>]` 마커로 폴백 (python-pptx 셀이 picture 미지원). `cell.merge()` 로 rowSpan/colSpan 도 보존. |

### 2.4 Importer (docx)

- `docx_import.py` — `_table_cell_content()` 신규: 셀 paragraph 중 하나라도 `<w:drawing>` 가지면 `{"blocks": [...]}` 반환, 아니면 기존 `{"text": str}` (fast path).
- `_image_block_from_drawing()` 신규: 본문 image 빌더와 동일한 upload/dedup/roundtrip-capture 로직. 셀 안 이미지도 MinIO dedup + round-trip 보존 동참.
- `_build_table_block()` 에 `has_mixed` 플래그 추가 — 혼합 셀이 하나라도 있으면 sparse `cells` 모드 강제 전환.
- `pptx_import.py` — 변경 없음 (PowerPoint 포맷 자체가 셀 안 picture 불허).

### 2.5 Tests

`apps/api/tests/test_mixed_cells.py` 신규:

| 테스트 | 검증 |
|---|---|
| `test_markdown_export_renders_mixed_cells` | 셀 안 이미지+텍스트+리스트가 md 로 평탄화 |
| `test_html_export_renders_mixed_cells` | `<p>/<img>/<ul>` 구조 출력 |
| `test_docx_export_embeds_picture_in_cell` | docx zip `word/media/` 에 실제 picture |
| `test_pptx_export_handles_mixed_cells_textually` | pptx 렌더 무사 통과 |
| `test_docx_import_emits_cell_blocks_for_image_in_cell` | docx → import → blocks 회수 |
| `test_schema_normalises_text_when_blocks_present` | one-of contract 정규화 |

결과: 6/6 신규 통과. 회귀: 759 통과, 사전 존재 3 실패 (`test_section_numbering.py` — 본 작업 무관).

### 2.6 lat 동기화

- `docs/lat/documents.md` — TableBlock 항목에 flat/sparse 두 모드 + `CellBlock` 제한 명시.
- `docs/lat/imports.md` — "Mixed-content table cells" 섹션 신규.
- `docs/lat/export.md` — "Table rendering 깊이" 섹션에 mixed-content cells 단락 추가.

---

## 3. 성능 / 호환성

- **DB migration**: 0. 모든 기존 cell 은 `text` 만 보유 → 새 validator 통과.
- **API 호환성**: 기존 클라이언트가 보내는 flat `text` 모드 100% 유지. 새 `blocks` 모드는 opt-in.
- **검증 비용**: `_normalise_table_cells()` 는 단순 dict walk — O(n) cells. validation 흐름의 다른 정규화와 동일 차수.
- **렌더 성능**: sparse 모드는 기존 flat 모드와 동일한 dispatch path. 추가 cost 없음.

---

## 4. 위험 평가 (사후)

| Plan 의 위험 | 결과 |
|---|---|
| 기존 데이터 영향 | 0 — `text` 가 옵션이지만 빈 문자열 fallback 으로 항상 존재. |
| pptx export 한계 | `[image: <label>]` 텍스트 폴백으로 명시적 처리. |
| docx_import 무거움 | `_image_block_from_drawing()` 가 본문 image 로직 그대로 재사용. preprocess_zip_images 의 sha 맵도 그대로 동작. |
| 회귀 안정성 | 759 기존 테스트 통과 — 무영향. |

---

## 5. Out of Scope (별도 작업)

- FE 위키 에디터의 mixed-cell 편집 UI (FE PR 별도).
- `pptx_import` 셀 이미지 인식 — PowerPoint 포맷 차원에서 불허라 기술적 한계.
- 셀 안 table/callout/chart/columns — CellBlock 일부러 좁게 유지.
- `Widget: <type>` 통일 룰 (future-B, `llm-document-formats.md` 청사진).

---

## 6. Next Steps

1. **선택적 보강**: `test_pptx_export_handles_mixed_cells_textually` 에 `[image:` 문자열 어서션 추가해 폴백 행동을 회귀 고정.
2. **사전 존재 버그 픽스**: `test_section_numbering.py` 의 3 케이스 — `renumber_sections` 가 level 점프/level=2 최상위/level=3 자식 검증을 통과시키는 버그. 별도 PR.
3. **future-B 착수**: `llm-document-formats.md` 의 청사진 구현 — `Widget: <type>` 마커 인식 로직을 docx_import/pptx_import 에 추가.
