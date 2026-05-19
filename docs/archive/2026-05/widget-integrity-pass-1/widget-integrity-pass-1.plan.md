# Widget Integrity Pass 1 — Planning Document

> **Summary**: zebra-striping 작업 중 발견한 "schema/UI는 있는데 렌더가 옵션을 무시" 패턴이
> 35블록 전반에 더 있을 거라는 의심을 4개 Explore 에이전트가 병렬 점검으로 확정했다.
> 이번 사이클은 CRITICAL 1건 + HIGH 8건 + zebra-striping 1건을 한 묶음(= 9건)으로
> 정리해서 "위젯이 약속한 것을 실제로 한다"는 신뢰성을 회복한다.
>
> **Project**: MX White Paper
> **Feature**: widget-integrity-pass-1
> **Version**: 0.1.0
> **Date**: 2026-05-18
> **Status**: Draft
> **Supersedes**: `zebra-striping.plan.md` + `zebra-striping.design.md` (zebra는 이 사이클의 부분집합)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 35 블록 위젯에 *schema에는 있는데 실제 렌더/export가 옵션을 무시* 하거나 *3개 export 포맷이 누락*되거나 *필드명이 BE/FE 사이에서 혼재*하는 일관성 갭이 다수. 사용자는 옵션을 토글했다고 믿지만 실제 동작 안 함. zebra-striping 갭은 빙산의 일각이었음. |
| **Solution** | 4개 에이전트가 *파일 기준*으로 충돌 없이 분할 병렬 수정: B1 (모든 export 파일), B2 (schema + image_id 통일 + list 타입), B3 (신규/누락 editor), B4 (다른 셋 완료 후 lat·LLM·RAG·통합 테스트). 9개 갭 + zebra-striping을 한 사이클로 통합. |
| **Function/UX Effect** | 표 zebra·image width·page 정보 등 옵션이 *실제로* 동작. bibliography가 docx 외 3개 포맷으로도 출력. spacer/figure-index의 편집 UI 완성. gallery 라이트박스로 본격 갤러리 사용 가능. 사용자가 토글한 게 그대로 보임. |
| **Core Value** | "위젯이 한 약속을 지킨다." 새 기능 추가가 아니라 *이미 약속된 동작을 실제로 작동하게* 만드는 신뢰성 사이클. zebra-striping(부분집합)을 별도 사이클로 빼지 않고 같은 패턴 픽스들을 한 데 묶어 lat·RAG 동기화 비용을 한 번에 처리. |

---

## 1. Overview

### 1.1 Purpose

4개 Explore 에이전트(A1~A4)의 위젯 점검 결과 발견한 **9개 갭** + **zebra-striping**(zebra는 사실 A1의 갭 #2와 동일 패턴)을 한 사이클로 묶어 해결. 모든 갭이 "schema/UI는 OK인데 렌더/export가 약속을 안 지킴" 또는 "한쪽이 아예 없음" 패턴이라 *같은 종류의 수정*이고, 같은 파일들을 건드리므로 분리 사이클은 비효율.

### 1.2 Out of Scope

- **MED 우선순위 10건** (data-source refreshInterval, spreadsheet 키보드 이동, pdf page 보존, iframe XOR 검증, heading-4 UI, quote editor, glossary-ref 정리, org-chart layout, video controls, form/quiz 기본값) — *pass-2* 사이클로
- **LOW 우선순위** (calculator unit, whiteboard keyboard, file preview, video thumbnail, accordion 기본 펼침 등) — 백로그
- 신규 위젯 추가
- 디자인 시스템 색 토큰 확장
- 새로운 export 포맷 (현재 4개만)

### 1.3 점검 결과 → 9개 갭 + zebra (총 10건)

A1~A4 보고서 (`docs/03-analysis/widget-audit/A1-A4-*.md`)에서 CRITICAL+HIGH로 분류된 항목:

| # | 심각도 | 블록 | 갭 | 출처 |
|---|---|---|---|---|
| G1 | CRITICAL | bibliography | pptx/html/markdown export 3개 모두 누락 | A2 |
| G2 | HIGH | table | `stripe`/footer/aggregate 옵션이 4개 export에서 무시 | A1 |
| G3 | HIGH | image, image-annotation | `imageId` ↔ `image_id` 필드명 혼재 | A3 |
| G4 | HIGH | image | width enum이 docx export에서 무시 | A3 |
| G5 | HIGH | callout | docx hidden marker 누락 → round-trip 불가 | A2 |
| G6 | HIGH | list | items 타입 이중화 (string[] vs dict[]) → round-trip 위험 | A2 |
| G7 | HIGH | gallery | 라이트박스 없음 (사용 편의성 핵심) | A3 |
| G8 | HIGH | spacer | 편집 UI 자체가 없음 (schema는 size 있는데 32px 고정) | A4 |
| G9 | HIGH | figure-index | DOM 스캔 기반 → 명시적 갱신 버튼 없으면 stale | A4 |
| G10 | (zebra) | table + spreadsheet | spreadsheet에 stripe 옵션 자체가 없고, table은 옵션 무시 | 별도 |

### 1.4 Decisions (확정)

| # | 결정 | 값 |
|---|---|---|
| 1 | 작업 분할 방식 | **파일 기준** 4분할 (B1~B4). 같은 파일을 두 에이전트가 동시 편집하지 않게. |
| 2 | image_id 통일 방향 | **camelCase `imageId`로 통일**. schema, FE, BE 모두 camelCase. PY 쪽은 alias 처리 또는 정규화 함수 |
| 3 | list items 타입 | **현 `string[]` 유지 + export 코드 정리**. 마이그레이션 없이 export의 dict 시도 코드 제거 (defensive code dead path 정리). Round-trip은 `"  "` 접두사 depth 인코딩 유지 |
| 4 | callout marker 형식 | 다른 widget과 동일 패턴 (`emit_marker_text()` 호출 + hidden run) |
| 5 | bibliography 3-export 구현 | docx의 heading + 번호 매긴 리스트 패턴을 그대로 html/pptx/md로 이식 |
| 6 | spacer editor | 최소 구현 — size dropdown (sm/md/lg/xl) + 현재 px 표시. drag 조절은 pass-2로 |
| 7 | figure-index 갱신 | "갱신" 버튼 추가 + BE walk 노출(이미 있으면 호출, 없으면 FE만) — Design 단계에서 정확히 결정 |
| 8 | gallery 라이트박스 라이브러리 | 기존 의존성만으로 (Radix Dialog + image zoom). 외부 라이트박스 라이브러리 추가 안 함 |
| 9 | zebra-striping 통합 | 이 사이클의 부분집합으로 흡수. zebra의 plan/design 문서는 superseded 표시 후 유지 (참고용) |
| 10 | lat/LLM rules/RAG 동기화 | B4 에이전트가 단독 담당. 모든 코드 변경 후 한 번에 동기화 |
| 11 | 테스트 전략 | (a) export 변경은 BE pytest (`test_docx_export`, `test_html_export`, `test_pptx_export`, `test_markdown_export`), (b) FE editor 변경은 vitest + 기존 컴포넌트 테스트, (c) schema 변경은 `validate_document_json()` 통과 회귀 |
| 12 | 작업 순서 | B1·B2·B3 병렬 → 다 끝나면 B4 직렬 (lat·LLM·RAG는 코드가 최종 형태에 있어야 정확히 동기화 가능) |
| 13 | 보고서 출력 | 각 에이전트가 `docs/03-analysis/widget-fix-pass-1/B[1-4]-result.md`로 변경 결과 + 테스트 결과 보고 |
| 14 | matchRate 기준 | 90% 이상 (PDCA 표준). 미달 시 pdca-iterator |

---

## 2. 4분할 작업 정의 (충돌 없는 파일 소유)

### B1 — BE Export 통합 (모든 export 파일 단독 소유)

**파일**: `apps/api/app/services/{docx_export.py, html_renderer.py, pptx_export.py, markdown_export.py}`

**담당 갭**:
- G1 bibliography 3-export 추가 (html/pptx/markdown에 `_b_bibliography` 함수 + BLOCK_HANDLERS 등록)
- G2 table stripe 옵션 4개 export에서 읽기 (docx/html/pptx/markdown의 `_b_table` 분기에 옵션 적용)
- G4 image width enum docx에서 처리 (px 변환해서 Picture(width=...))
- G5 callout marker emit (다른 widget과 동일 패턴)
- **zebra의 BE 부분** — table은 G2와 동일하므로 자동 포함. spreadsheet는 옵션이 schema에 추가된 후 (B2 의존) html/docx 렌더에서 옵션 읽기 — *B2 완료 후 진행*

**산출물**: 4개 export 파일 수정 + 관련 pytest 통과

### B2 — Schema + image_id 통일 + list 타입 (`document.json` 단독 소유)

**파일**: `packages/shared/schemas/document.json`, image_id 관련 모든 파일 (FE Image*Editor, BE alias 처리, glossary-ref schema 정리)

**담당 갭**:
- G3 imageId 통일 — schema에서 `image_id` → `imageId`로 변경, FE 코드 grep & replace, BE에서 둘 다 읽되 정규화
- G6 list items 타입 — export의 dict 시도 코드 제거 (string-only)
- **zebra의 schema 부분** — `SpreadsheetBlock`에 `options.stripe` 추가

**산출물**: schema 변경 + image_id 일관화 + list export 정리. pytest `test_schema_*`, `test_document_*` 통과

### B3 — FE Editor 신규/누락 + zebra editor (FE editor 파일 단독 소유)

**파일**: `apps/web/src/features/editor/blocks/{SpacerBlockEditor.tsx (신규), FigureIndexBlock*, GalleryBlockView.tsx, SpreadsheetBlockEditor.tsx, TableBlockEditor.tsx, zebra.ts (신규)}`

**담당 갭**:
- G7 gallery lightbox (Radix Dialog 기반 zoom 모달)
- G8 spacer editor 신규 (size dropdown)
- G9 figure-index 명시적 갱신 버튼
- **zebra의 FE 부분** — `zebra.ts` 유틸 + `TableBlockEditor` 하드코딩 제거 + `SpreadsheetBlockEditor`에 토글 + zebra 적용

**산출물**: 신규/수정 editor + 신규 zebra.ts + vitest 단위테스트 통과

### B4 — 동기화 + 통합 테스트 (B1~B3 완료 후 직렬 진입)

**파일**: `docs/lat/documents.md`, `docs/llm-input-rules.md`, `dist/llm-docx-toolkit/llm-input-rules.md`, `dist/llm-docx-toolkit/rag/{chunks.jsonl, index.lock}`

**담당**:
- B1~B3가 만든 변경을 lat에 반영 (Block types 표, Gotchas)
- LLM rules에 spreadsheet `options.stripe`, callout marker, image `imageId` 등 노출
- RAG chunker 재실행 → chunks.jsonl + index.lock 갱신
- 통합 회귀: 전체 pytest + vitest 한 번 더, BM25 쿼리 sanity check ("spreadsheet stripe", "bibliography export", "image width" 등)
- 보고서: `docs/03-analysis/widget-fix-pass-1/summary.md` (4개 에이전트 결과 종합)

---

## 3. Acceptance Criteria

1. **C1**: 9개 갭 모두 코드 변경 들어감 (G1~G9)
2. **C2**: zebra-striping(G10)도 완성 — table·spreadsheet 둘 다 zebra 옵션 기반 동작
3. **C3**: bibliography가 docx/html/pptx/markdown 4개 포맷 *모두*에서 출력됨
4. **C4**: `imageId`로 통일 — schema, FE TS 타입, BE 정규화 일관
5. **C5**: image width enum이 docx에서도 px로 굽힘
6. **C6**: table stripe 옵션이 4개 export에서 *옵션을 읽고* 결과에 반영됨
7. **C7**: callout이 docx에서 hidden marker emit → round-trip OK
8. **C8**: list export에서 dict 시도 죽은 코드 제거 (테스트 통과)
9. **C9**: gallery 클릭 시 라이트박스 모달 작동
10. **C10**: spacer 편집 UI에서 size 변경 가능
11. **C11**: figure-index 갱신 버튼 작동
12. **C12**: 기존 모든 회귀 테스트 통과 (pytest + vitest)
13. **C13**: lat·LLM rules·RAG 셋 다 동기 (CI lock 검증 통과)
14. **C14**: 4개 에이전트 결과 보고서 `docs/03-analysis/widget-fix-pass-1/` 에 생성

---

## 4. 의존성 / 위험

| 위험 | 완화 |
|---|---|
| B1·B2·B3 병렬 실행 시 *간접 의존* — B2가 schema 바꾸기 전에 B1이 옵션을 읽으려고 시도 가능 | B2가 우선 schema 변경부터 시작. B1의 spreadsheet stripe 처리는 *별도 commit*으로 B2 schema commit 이후 진행 |
| `apps/web/src/components/blocks/`와 `apps/web/src/features/editor/blocks/` 두 폴더에 같은 블록이 있을 수 있음 (View vs Editor 분리) | A1~A3 점검에서 확인됨. B3는 features/editor/blocks/만 수정 (gallery는 view 쪽도 — 명시 필요) |
| `imageId` 통일 시 기존 DB 데이터가 `image_id`로 저장돼 있을 가능성 | BE에서 양쪽 모두 읽되 한 쪽으로 정규화. 마이그레이션 없이 read-side 호환만 |
| docx 표가 footer/aggregate를 export에 반영하면 import round-trip 깨질 수 있음 | A1 보고서가 "이미 동작 확인"이라 함 — B1은 *stripe만* 다루고 footer/aggregate는 건드리지 않음 |
| pptx export에 bibliography 추가 시 slide layout 충돌 | docx 패턴 그대로 가능한지 Design에서 확인 |
| RAG chunker가 새 단락을 인식 못 함 | B4에서 BM25 sanity check (검색 쿼리로 새 청크 등장 확인) |

---

## 5. 다음 단계

`/pdca design widget-integrity-pass-1` — 4개 에이전트가 무엇을 정확히 수정할지 파일·라인·diff 단위로 확정. B1·B2·B3 각 에이전트가 받을 *작업 명세서*를 따로 만든다 (디자인 단계에서). 그 후 4개 에이전트 동시 출발.
