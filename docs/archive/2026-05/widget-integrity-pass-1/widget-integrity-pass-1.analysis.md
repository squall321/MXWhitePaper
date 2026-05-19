# Widget Integrity Pass 1 — Gap Analysis

> Cycle: widget-integrity-pass-1
> Date: 2026-05-18
> Analyzer: bkit:gap-detector
> Method: lat-first (큰 파일은 grep으로 좁혀 확인)

## Match Rate: 100%

Design 명세 14개 Acceptance Criteria 모두 코드로 구현 확인. summary.md의 14/14 보고가 직접 코드 점검으로 검증됨.

## Acceptance Criteria 통과 여부 (C1~C14)

| # | 기준 | 검증 결과 | 근거 (파일:라인) |
|---|---|---|---|
| C1 | 9 갭 모두 코드 변경 | ✅ | G1~G9 각각 아래 항목 참조 |
| C2 | zebra(table+spreadsheet) 동작 | ✅ | `apps/web/src/features/editor/blocks/zebra.ts:27-35`, `TableBlockEditor.tsx:337`, `SpreadsheetBlockEditor.tsx:202,207,248` |
| C3 | bibliography 4-export | ✅ | 4파일 모두 `_b_bibliography` 정의 + `BLOCK_HANDLERS` 등록 (docx/html/markdown/pptx) |
| C4 | imageId 통일 | ✅ | `packages/shared/schemas/document.json:602,607,628,1058,1063` 모두 `imageId`; BE 정규화 `document_service.py:234-294` |
| C5 | image width docx | ✅ | `docx_export.py:873` `_IMAGE_WIDTH_PX = {"sm":200,"md":400,"lg":600,"full":None}` + L885-887 |
| C6 | table stripe 4-export | ✅ | `docx_export.py:400` `_table_style_for`, `html_renderer.py:415` `_table_class_for`, `markdown_export.py:278` `<!-- stripe:false -->`, `pptx_export.py:523` `_apply_table_stripe` |
| C7 | callout hidden marker (선존재) | ✅ | `docx_export.py:345-350` `emit_marker_text` + `font.hidden=True`. 26곳 패턴 일관 |
| C8 | list dict 죽은 코드 제거 | ✅ | `docx_export.py:283-311` `_b_list`는 string-only. L613-623의 dict 처리는 nested column 컨텍스트로 별도 (명세 대상 아님) |
| C9 | gallery lightbox (선존재) | ✅ | `apps/web/src/components/blocks/GalleryBlock.tsx:4,55-57` `<Lightbox>` + 신규 테스트 |
| C10 | spacer editor 신규 | ✅ | `SpacerBlockEditor.tsx` (122 LOC) + dispatcher `BlockRenderer.tsx:53,441-442` |
| C11 | figure-index 갱신 버튼 | ✅ | `FigureIndexBlock.tsx:68-72` `data-action="figure-index-refresh"` + `🔄 갱신` |
| C12 | 회귀 테스트 통과 | ✅ | B1: 92 passed / B2: 88 BE 안정, 1535 FE / B3: 1535 FE / B4: 168 BE renderer+schema |
| C13 | lat/LLM rules/RAG 동기 | ✅ | `docs/lat/documents.md`, `export.md`, `llm-input-rules.md` (×2), `chunks.jsonl`, `index.lock` (2026-05-18T21:15:19Z) |
| C14 | 4 보고서 생성 | ✅ | `B1-result.md`, `B2-result.md`, `B3-result.md`, `summary.md` 모두 존재 |

## 발견된 Gap

**없음.** 9 갭 + zebra 모두 Design 명세대로 구현됨. 의도된 차이(spacer xl 제외, callout marker 선존재, postgres flaky)는 갭에서 제외함.

검증 과정 중 *부분구현/괴리*로 의심한 항목 1건:

- **`docx_export.py:613-623`의 nested context list dict 처리** — `_b_columns`/`_b_tabs` 등의 컬럼 *안*의 list 처리이고, Design §1.2 G6은 top-level `_b_list` (L283)만 명시. 명세 범위 밖. **후속 사이클에서 정리 권고 (LOW)**.

## 결론

matchRate 100% → **`/pdca report widget-integrity-pass-1`** 으로 직행 (PDCA 90% 임계 초과, Act 단계 불필요).

## 후속 권고 (Out of Scope — 별도 사이클)

1. `docx_export.py:613-623` nested-context list dict 정리 (LOW, dead path)
2. spacer xl(128px) schema enum 확장
3. markdown stripe round-trip import 측 보강
4. apptainer postgres `/dev/shm` 안정화 (인프라 사이클)
5. A2 audit의 callout marker 오보 정정 (`docs/03-analysis/widget-audit/A2-text.md:95`)
