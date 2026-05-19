# Widget Integrity Pass 1 — Summary

> Cycle: widget-integrity-pass-1
> Date: 2026-05-18
> Status: All 4 work packages (B1–B4) complete — Check phase 진입 준비 완료

## 1. 변경 종합

### B1 — BE Export (4 files, +182/−25)

- `apps/api/app/services/docx_export.py`, `html_renderer.py`, `markdown_export.py`, `pptx_export.py`
- G1 bibliography 3-export (html/pptx/markdown 신규 `_b_bibliography` + BLOCK_HANDLERS 등록)
- G2 table stripe 4-export (docx Table Grid vs Light Grid Accent 1, html striped/no-stripe, markdown comment, pptx horz_banding)
- G4 image width docx (`_IMAGE_WIDTH_PX = {sm:200, md:400, lg:600, full:None}` → Inches 변환)
- G5 callout marker (사실 이미 존재, 회귀 테스트만 추가 — A2 audit이 오보)
- G6 list dict 죽은 코드 제거 (string[]만)
- G2-zebra spreadsheet stripe (B2 schema 머지 후 처리)
- **테스트**: 92 passed (기존 80 + 신규 7 + roundtrip 5)

### B2 — Schema + imageId (`document.json` + image_annotation 관련)

- Z1: `SpreadsheetBlock.options.stripe` 추가 (default true) → `B2-z1-done.flag`로 B1·B3 unblock
- G3 imageId 통일:
  - schema `image_id` → `imageId` (ImageAnnotationBlock 포함)
  - TS 타입 + pydantic v2 alias 자동 regen
  - FE 3파일 + 3개 테스트 fixture
  - BE `_normalise_image_annotation_ids()` in-place rename — **마이그레이션 없이 legacy 호환**
- **테스트**: 신규 4 (`test_schema_widget_pass1.py`), BE 도메인 88 안정, FE vitest 1535/1535

### B3 — FE Editor + zebra UI (6 files + 2 신규)

- 신규: `zebra.ts`, `zebra.test.ts`, `SpacerBlockEditor.tsx`, `SpacerBlockEditor.test.tsx`, `FigureIndexBlock.test.tsx`, `GalleryBlock.test.tsx`
- 수정: `TableBlockEditor.tsx`, `SpreadsheetBlockEditor.tsx`, `FigureIndexBlock.tsx`, `BlockRenderer.tsx`
- Z2 zebra util + 두 editor 통합 (table 하드코딩 제거, spreadsheet 토글)
- G7 gallery lightbox (이미 존재, 회귀 방지 테스트만)
- G8 spacer editor 신규 (sm/md/lg dropdown — schema enum에 xl 없어 제외)
- G9 figure-index 🔄 갱신 버튼 + collect() useCallback 외부화
- **테스트**: 신규 15, vitest 1535/1535

### B4 — Sync + Integration (lat / LLM rules / RAG)

- **lat**: `documents.md` (Block types + Gotchas 8~10), `export.md` (dispatcher + stripe 4-export + image width + Gotchas 8·9)
- **LLM rules**: `docs/llm-input-rules.md` §2.7·§2.8·§2.9·§2.10·§2.11·§2.12·§3.1·§3.11 갱신 → `dist/llm-docx-toolkit/llm-input-rules.md`로 md5-동일 복제 (`314f1b51...`)
- **RAG**: chunker 재실행 → 131 → 131 chunks (내용 갱신, sha256 `ea9fae3a...` → `edb7a452...`)
- **통합 회귀**: BE renderer/schema/widget 168 passed, FE 1535 passed
- **BM25 sanity**: 4 쿼리 모두 top-3에 새 청크 hit

## 2. Acceptance Criteria — 14/14 통과

| # | 기준 | 결과 |
|---|---|---|
| C1 | 9 갭 + zebra 모두 코드 변경 | ✅ |
| C2 | zebra-striping 완성 (table + spreadsheet) | ✅ |
| C3 | bibliography 4-export | ✅ |
| C4 | image width docx 반영 | ✅ |
| C5 | imageId 통일 | ✅ |
| C6 | list dict 시도 죽은 코드 제거 | ✅ |
| C7 | callout hidden marker 보장 (선존재 검증) | ✅ |
| C8 | spacer editor 추가 (xl 제외 — schema enum 한계) | ✅ |
| C9 | figure-index 갱신 버튼 | ✅ |
| C10 | gallery lightbox 동작 (선존재) | ✅ |
| C11 | 신규 BE 테스트 green | ✅ 11 신규 |
| C12 | 신규 FE 테스트 green | ✅ 15 신규 / 1535 total |
| C13 | lat·LLM rules·RAG 동기화 | ✅ |
| C14 | 4 에이전트 결과 보고서 (B1/B2/B3-result + 본 summary) | ✅ |

## 3. 발견된 추가 이슈

1. **A2 audit이 callout marker 누락 오보** — `docs/03-analysis/widget-audit/A2-text.md` L95. 실제 코드는 docx_export L353에 marker emit 있음. B1이 검증 후 회귀 테스트만 추가. A2 보고서 정정 권고.
2. **spacer `xl=128px`** — schema enum이 `["sm","md","lg"]`로 제한. 본 사이클 미포함, 차후 schema 확장 사이클 권고.
3. **markdown stripe round-trip 미지원** — export 측 `<!-- stripe:false -->` emit만 처리. markdown import 사이클에서 보강 권고.
4. **apptainer `mxwp_postgres` `/dev/shm` 불안정** — 전체 BE pytest 시 일부가 `asyncpg.UndefinedFileError: shared memory segment` 실패. **widget 변경과 무관** (단위 테스트 단독 실행은 통과). 배포 playbook의 `--bind /dev/shm` 또는 socket 옵션 검토 권고.
5. **FE 외부 컨텍스트 `image_id` 미변경** — uploadImage API 응답, series cover, template thumb 등은 block field 통일과 분리된 도메인. 의도적 제외.

## 4. 다음 단계

1. `/pdca analyze widget-integrity-pass-1` 로 gap analyze → matchRate 측정
2. matchRate ≥ 90% 이면 `/pdca report`, < 90% 이면 `/pdca iterate`
3. 환경 이슈 (issue #4) 별도 인프라 사이클로 분리
4. markdown stripe round-trip (issue #3) 다음 import 사이클에서 처리

---

**사이클 종합**: 9 갭 + zebra 통합을 4 분할 병렬로 충돌 없이 완료. 신규 테스트 26 건, 회귀 없음. lat·LLM rules·RAG 모두 동기. Check phase 진입 준비 완료.
