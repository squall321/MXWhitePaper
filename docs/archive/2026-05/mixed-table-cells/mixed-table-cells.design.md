# mixed-table-cells Design Document

> **Summary**: TableBlock 의 셀 단위 콘텐츠 모델을 `text: str` → `text | blocks[]` 로 확장.
> 셀 안에 image/paragraph/list 가 공존 가능. one-of contract 은 service 정규화로 강제.
>
> **Project**: MXWhitePaper
> **Author**: koopark
> **Date**: 2026-05-15
> **Status**: Implemented
> **Planning Doc**: [mixed-table-cells.plan.md](../01-plan/features/mixed-table-cells.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 셀 1 개에 `paragraph + image + list` 다수 블록을 담을 수 있게 한다 (한국 기업 PPT 50%+ 패턴).
- 기존 `text: str` 만 사용하는 모든 셀은 100% 변경 없이 계속 동작 (DB migration 0).
- 4 렌더러 (docx/pptx/html/markdown) + 1 importer (docx) 가 새 모드를 처리.
- pptx 는 포맷 한계 (셀 안 picture 불가) 를 명시적으로 인정하고 텍스트 폴백.

### 1.2 Design Principles

- **One-of contract** — 셀은 `text` 또는 `blocks` 중 하나만. Pydantic 만으로는 강제 불가 (둘 다 옵션 필드) 라 service-layer 에서 정규화.
- **Narrow CellBlock** — 셀 안 허용 블록을 paragraph/image/list 셋으로 제한. 테이블 안 테이블, 콜아웃 안 콜아웃 같은 무한 재귀 차단.
- **SSOT codegen** — 스키마는 `packages/shared/schemas/document.json` (canonical) → `pnpm -w schema:gen` 으로 Python/TypeScript 자동 생성.

---

## 2. Architecture

### 2.1 Component Diagram

```text
┌──────────────────────────────────────────────────────────────────┐
│ packages/shared/schemas/document.json   (canonical SSOT)         │
│   ├── $defs/CellBlock  =  Paragraph | Image | List               │
│   └── $defs/Cell       =  {r, c, text?, blocks?, ...}            │
└──────────────────────────────────────────────────────────────────┘
                │ pnpm -w schema:gen
                ▼
┌────────────────────────────────┐   ┌─────────────────────────────┐
│ apps/api/app/schemas/document.py│   │ apps/web/src/types/document.ts│
└────────────────────────────────┘   └─────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ apps/api/app/services/document_service.py                        │
│   _normalise_table_cells()  ── text 와 blocks 둘 다 있으면 text 제거 │
└──────────────────────────────────────────────────────────────────┘
                │
       ┌────────┴────────┐
       ▼                 ▼
┌─────────────┐   ┌──────────────────────┐
│ Importers   │   │ Renderers (4)        │
│ docx_import │   │ docx / pptx /        │
│ (drawings)  │   │ html / markdown      │
└─────────────┘   └──────────────────────┘
```

### 2.2 데이터 흐름

1. **Import** — docx `<w:tc>` 안 `<w:drawing>` 검출 → `_table_cell_content()` 가 `{"blocks": [...]}` 반환 → `_build_table_block()` 이 sparse `cells` 모드로 전환.
2. **Validation** — Pydantic 통과 후 `_normalise_table_cells()` 가 `text` AND `blocks` 인 셀에서 `text` 제거.
3. **Render** — 4 렌더러가 각 셀에 대해 `cell.get("blocks")` 분기 → 전용 헬퍼 호출.

---

## 3. Schema 변경 (정확한 형태)

### 3.1 CellBlock $def 신규

```json
"CellBlock": {
  "description": "Block subset allowed inside a TableBlock cell's `blocks` array",
  "oneOf": [
    { "$ref": "#/$defs/ParagraphBlock" },
    { "$ref": "#/$defs/ImageBlock" },
    { "$ref": "#/$defs/ListBlock" }
  ]
}
```

### 3.2 Cell 수정

```json
{
  "type": "object",
  "required": ["r", "c"],   // text 제거됨 (이전: required)
  "properties": {
    "r": {"type": "integer", "minimum": 0},
    "c": {"type": "integer", "minimum": 0},
    "text": {"type": "string"},
    "blocks": {
      "type": "array",
      "minItems": 1,
      "items": {"$ref": "#/$defs/CellBlock"}
    },
    "header": {"type": "boolean"},
    "rowSpan": {"type": "integer", "minimum": 1},
    "colSpan": {"type": "integer", "minimum": 1}
  }
}
```

`text` 와 `blocks` 둘 다 옵션. 둘 다 비어 있으면 `text=""` 자동 채움 (서비스 정규화).

---

## 4. 모듈별 책임

### 4.1 Renderers

| 모듈 | 진입점 | 헬퍼 | 비고 |
|---|---|---|---|
| `markdown_export.py` | `_b_table()` | `_b_table_sparse()` + `_flatten_cell_md()` | 이미지는 `![alt](imageId)` 마커 |
| `html_renderer.py` | `_b_table()` | `_b_table_sparse_html()` + `_render_cell_html()` | rowSpan/colSpan attr 보존 |
| `docx_export.py` | `_emit_table_cells()` | `_emit_cell_blocks()` | 실제 `add_picture()` |
| `pptx_export.py` | `_b_table()` | `_emit_table_sparse()` + `_fill_cell_blocks_pptx()` | 이미지 → `[image: <label>]` 텍스트 |

### 4.2 Importers

| 모듈 | 진입점 | 헬퍼 | 비고 |
|---|---|---|---|
| `docx_import.py` | `_build_table_block()` | `_table_cell_content()` + `_image_block_from_drawing()` | `<w:drawing>` 검출 시 mixed mode 자동 전환 |
| `pptx_import.py` | — | — | PowerPoint 셀은 텍스트만 (포맷 한계). 변경 없음. |

### 4.3 Service

`_normalise_table_cells(content)` — `validate_documentjson()` 흐름에 추가. 모든 `cells` 를 walk 하면서:

- `blocks` 가 있고 `text` 도 있으면 → `text` 제거 (one-of contract).
- 둘 다 비어 있으면 → `text=""` 으로 채움 (빈 셀 허용).
- 재귀 위치: 본 columns/tabs/accordion 안의 table 도 동일 처리.

---

## 5. 테스트 전략

| 테스트 | 검증 |
|---|---|
| `test_mixed_cells.py::test_markdown_export_renders_mixed_cells` | 셀 안 이미지+텍스트+리스트가 markdown 으로 평탄화 |
| `test_mixed_cells.py::test_html_export_renders_mixed_cells` | `<p>/<img>/<ul>` 구조 출력 |
| `test_mixed_cells.py::test_docx_export_embeds_picture_in_cell` | docx zip 안 `word/media/` 에 실제 picture |
| `test_mixed_cells.py::test_pptx_export_handles_mixed_cells_textually` | pptx 렌더 무사 통과 (텍스트 폴백) |
| `test_mixed_cells.py::test_docx_import_emits_cell_blocks_for_image_in_cell` | docx → import → blocks 배열로 회수 |
| `test_mixed_cells.py::test_schema_normalises_text_when_blocks_present` | one-of contract 정규화 동작 |
| 기존 759 테스트 | 회귀 0 |

---

## 6. 위험 & 완화

| 위험 | 완화 |
|---|---|
| 기존 cell 시그니처 의존 코드 | text 는 옵션이지만 빈 문자열 fallback 으로 항상 존재 |
| pptx export 한계 | `[image: <label>]` 텍스트 폴백. 별도 issue 로 보강 가능 |
| docx import 의 추가 이미지 업로드 | `_preprocess_zip_images()` 의 sha 맵 재사용. 새 경로 0 |
| Pydantic union 모호성 | `discriminator='type'` 으로 명시 안 했지만 RootModel oneOf 로 안전 |

---

## 7. Out of Scope (별도 PR)

- 셀 안 table/callout/chart/columns — CellBlock 을 일부러 좁게 유지.
- FE 위키 에디터의 mixed-cell UI — 본 작업은 BE 만.
- pptx_import 의 셀 안 이미지 인식 — PowerPoint 가 포맷 차원에서 불허.
- `Widget: <type>` 통일 룰 (future-B) — 청사진만 작성됨.
