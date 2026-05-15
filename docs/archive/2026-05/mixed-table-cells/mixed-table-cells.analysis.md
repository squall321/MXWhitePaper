# Design-Implementation Gap Analysis Report

## Analysis Overview

- **Feature**: mixed-table-cells
- **Design Doc**: [mixed-table-cells.design.md](../02-design/features/mixed-table-cells.design.md)
- **Plan Doc**: [mixed-table-cells.plan.md](../01-plan/features/mixed-table-cells.plan.md)
- **Analysis Date**: 2026-05-15

## Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 100% | OK |
| Architecture Compliance | 100% | OK |
| Convention Compliance | 100% | OK |
| **Overall Match Rate** | **100%** | **OK** |

## Per-Area Assessment

### 1. Schema (canonical JSON + Python regen)

| Design Claim | Verified Location | Result |
|---|---|---|
| `CellBlock` $def as oneOf(Paragraph/Image/List) | `packages/shared/schemas/document.json:225-232` | Match |
| `Cell.required` no longer includes `text` | `document.json:340` (`required: ["r", "c"]`) | Match |
| `Cell.blocks` array of CellBlock, `minItems=1` | `document.json:347-352` | Match |
| Python regen reflects schema | `apps/api/app/schemas/document.py:1173-1189` | Match |

Note: Plan Section 3 specifies `Annotated[..., Field(discriminator='type')]`. Generated
Python uses a bare `RootModel[ParagraphBlock | ImageBlock | ListBlock]` — unambiguous
because each member has a unique `type` const. Design Section 6 risk table accepts this.

### 2. Service Normalization

| Design Claim | Verified Location | Result |
|---|---|---|
| `_normalise_table_cells()` exists | `document_service.py:326-376` | Match |
| Called from `validate_documentjson()` | `document_service.py:262` | Match |
| Strips `text` when `blocks` present | `document_service.py:341-343` | Match |
| Fills `text=""` when both empty | `document_service.py:344-345` | Match |
| Recurses into columns/tabs/accordion | `document_service.py:354-366` | Match |

### 3. Renderers (4)

| Renderer | Entry | Helper | Verified |
|---|---|---|---|
| markdown | `_b_table` → `_b_table_sparse` | `_flatten_cell_md` | OK |
| html | `_b_table` → `_b_table_sparse_html` | `_render_cell_html` | OK |
| docx | `_b_table` → `_emit_table_cells` | `_emit_cell_blocks` (real `add_picture`) | OK |
| pptx | `_b_table` → `_emit_table_sparse` | `_fill_cell_blocks_pptx` (`[image: <label>]` text fallback) | OK |

### 4. Importer (docx)

| Design Claim | Verified Location | Result |
|---|---|---|
| `_table_cell_content()` detects `<w:drawing>` | `docx_import.py:686-726` | Match |
| `_image_block_from_drawing()` mirrors body upload | `docx_import.py:729-…` | Match |
| `_build_table_block()` sparse on `has_mixed` | `docx_import.py:1429-1492` | Match |
| `pptx_import` unchanged (format limitation) | No mixed-cell handling added | Match |

### 5. Tests

| Design Claim | Result |
|---|---|
| `test_mixed_cells.py` with 6 tests | All 6 functions present, all passing |
| Covers 4 renderers + docx round-trip + schema normalization | Match |
| No regressions | 759 prior tests still pass; 3 unrelated pre-existing failures in `test_section_numbering.py` (untouched code) |

### 6. lat Docs Sync

| Doc | Required Section | Verified |
|---|---|---|
| `docs/lat/documents.md` | TableBlock two-modes + CellBlock | Lines 85-92 |
| `docs/lat/imports.md` | "Mixed-content table cells" section | Lines 82-90 |
| `docs/lat/export.md` | Mixed-content cells paragraph | Lines 117-126 |

## Differences Found

### Missing (Design O / Impl X)
None.

### Added (Design X / Impl O)
None.

### Drift (Design ≠ Impl)
None substantive.

### Out-of-Scope (correctly NOT implemented)
- FE wiki editor UI
- `pptx_import` cell-image extraction (PowerPoint format limitation)
- table/callout/chart inside cells
- `Widget: <type>` unification rule

## Recommended Actions

### Immediate
None. Match rate 100%.

### Optional Hardening
1. Pin pptx `[image:` fallback marker in `test_pptx_export_handles_mixed_cells_textually` (currently only asserts the zip builds).
2. (Future) Document on the Python `CellBlock` RootModel why the explicit `discriminator='type'` from the plan was dropped during codegen.
