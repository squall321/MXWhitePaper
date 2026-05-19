# Zebra Striping for Table & Spreadsheet Blocks Planning Document

> **Summary**: 에디터의 `table` 블록은 schema·UI에 `stripe` 옵션이 이미 있지만
> 렌더 단계에서 옵션을 무시한 채 zebra가 하드코딩되어 있고, `spreadsheet`
> 블록은 zebra 자체가 아예 없다. 본 사이클은 두 블록 모두 옵션 기반 zebra
> striping을 *제대로* 켜서 행마다 색이 교차되게 만들어 시각 가시성을 올린다.
>
> **Project**: MX White Paper
> **Feature**: zebra-striping
> **Version**: 0.1.0
> **Date**: 2026-05-18
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 표와 스프레드시트가 빽빽한 행으로 채워지면 어느 셀이 어느 행인지 시각적으로 구분이 안 된다. table은 stripe 옵션이 schema·UI에 이미 있지만 *렌더가 옵션을 무시* 한 채 하드코딩되어 있고 (옵션 끄기 불가능 = 부분적 버그), spreadsheet는 zebra 자체가 *전혀 없다*. 대량 데이터를 다루는 사용자가 행 추적에 인지 비용을 쓰고 있다. |
| **Solution** | (1) `SpreadsheetBlock` schema에 `options.stripe`(default true) 추가, (2) `TableBlockEditor`·`SpreadsheetBlockEditor`의 렌더가 옵션을 *읽어서* zebra 클래스를 조건부 적용, (3) `TableOptionsPanel`과 동등한 토글을 spreadsheet에도 추가. zebra 톤은 두 블록을 시각적으로 *구분*하기 위해 다른 색조 사용 (table=중성 회색, spreadsheet=옅은 파랑). |
| **Function/UX Effect** | 표·스프레드시트의 짝수 행이 옅은 배경으로 자동 표시되어 행 추적이 즉시 쉬워진다. 두 블록이 다른 색조를 써서 한 페이지에 같이 놓여도 "이건 표 / 이건 스프레드시트" 구분이 한눈에 됨. 사용자는 옵션 패널에서 끄고 켤 수 있고, 기본값은 켜짐. |
| **Core Value** | "표는 표답게, 스프레드시트는 스프레드시트답게 — 행 단위 가시성을 시각 기본기로 제공." 가시성 개선은 새 기능 추가가 아니라 *이미 있는데 작동 안 하는 옵션을 제대로 동작시키는 일*. 적은 변경으로 모든 기존 문서 즉시 혜택. |

---

## 1. Overview

### 1.1 Purpose

`table`·`spreadsheet` 블록에 zebra striping(행 교차 배경색)을 옵션 기반으로
완성한다. *기존 데이터·기존 사용자 흐름은 그대로* 유지하면서, 시각 가시성을
올리고 두 블록이 외관상 구분되게 한다.

### 1.2 Out of Scope

- 셀 단위 임의 배경색 자유 지정 (이미 `table.cells[].bg`로 존재)
- 컬럼 zebra(세로 줄무늬) — 가독성 연구상 가로 zebra가 표준, 컬럼 zebra는 오히려 산만
- 다른 블록(callout, list, kpi-cards 등)으로의 stripe 확장
- 색상 사용자화 (theme/palette 시스템 도입은 별도 사이클)
- 인쇄/PDF 출력시 zebra가 잉크 문제로 보기 싫을 수 있는 점 — print CSS는 이번 범위 밖

### 1.3 Decisions (확정)

| # | 결정 | 값 |
|---|---|---|
| 1 | spreadsheet에 stripe 옵션 추가 위치 | 신규 `options` 객체 → `options.stripe: boolean (default true)`. table과 동일한 형태로 |
| 2 | 기본값 | 두 블록 모두 **stripe: true** (현재 사용자가 보던 모습과 동일 — 마이그레이션 무용) |
| 3 | zebra 톤 | **table** = 중성 회색 (`bg-gray-50` 유지), **spreadsheet** = 옅은 파랑 (`bg-blue-50`/`bg-sky-50` 중 디자인 단계에서 픽셀 확인) |
| 4 | 줄무늬 방식 | 짝수 행(0-index 기준 r=1,3,5…)이 색칠. 헤더 행은 별도 배경 유지 |
| 5 | 옵션 UI 위치 | spreadsheet 상단 옵션 바(현재 title 옆)에 체크박스 추가. 기존 `TableOptionsPanel` 컴포넌트 *재사용 안 함* — spreadsheet는 옵션이 1개뿐이라 가벼운 인라인 토글이 깔끔 |
| 6 | Table 옵션-렌더 연결 | `TableBlockEditor`에서 하드코딩된 `odd:bg-white even:bg-gray-50`를 `opts.stripe`(default true) 기반 조건부 클래스로 교체. 편집 모드 + 보기 모드 두 군데 모두 |
| 7 | 마이그레이션 | 없음. spreadsheet 기존 문서는 options 필드가 없어도 기본값 stripe=true로 렌더 |
| 8 | export 영향 | docx export는 zebra 정보를 셀 `tcPr/shd`로 굽지 않고 *옵션 메타*만 보존. html export는 옵션 그대로 CSS 클래스로 렌더 — design 단계에서 정확한 export rule 확정 |
| 9 | LLM 입력 룰 영향 | `docs/llm-input-rules.md` + `dist/llm-docx-toolkit/llm-input-rules.md`에 spreadsheet의 새 `options.stripe` 노출. RAG re-chunk 필수 |
| 10 | lat 동기화 | `docs/lat/documents.md`의 spreadsheet 블록 properties 표 갱신 (Mode A 룰 — 코드 변경과 *같은 사이클에* lat도 갱신) |
| 11 | 테스트 전략 | (a) schema validator: 기존 spreadsheet 문서(options 없음) 통과 확인, (b) `TableBlockEditor` snapshot: stripe=false일 때 zebra 클래스 미적용 검증, (c) `SpreadsheetBlockEditor` snapshot: stripe 토글 동작 검증 |
| 12 | 헤더와의 시각 충돌 | 헤더 행은 zebra와 무관하게 더 진한 배경 유지. zebra는 본문 데이터 행에만 |

### 1.4 Acceptance Criteria

1. **C1 — Table stripe 옵션 존중**: `opts.stripe=false`인 table은 zebra가 *꺼짐* (현재는 옵션 무시되고 항상 켜짐 = 버그). UI 토글 동작 확인.
2. **C2 — Table 기본값 zebra 유지**: 기존 `stripe` 미지정 또는 `true`인 모든 table은 변경 전과 동일하게 zebra 보임 (회귀 방지).
3. **C3 — Spreadsheet zebra 켜짐**: 신규/기존 spreadsheet 모두 옵션 미지정 시 zebra가 켜진 상태로 보임.
4. **C4 — Spreadsheet zebra 끔**: 옵션 토글로 zebra를 끌 수 있음.
5. **C5 — Schema 검증**: 새 `options.stripe` 필드 추가 후 기존 spreadsheet 문서가 `validate_document_json()` 통과.
6. **C6 — 시각 구분**: 같은 페이지에 table과 spreadsheet가 나란히 있을 때 zebra 톤 차이로 두 블록이 외관상 구분됨.
7. **C7 — Export 회귀 없음**: docx export / html export 둘 다 새 옵션을 처리하며 기존 export 테스트 모두 통과.
8. **C8 — RAG 동기화**: `dist/llm-docx-toolkit/llm-input-rules.md` 갱신 → RAG chunker 재실행 → `chunks.jsonl` + `index.lock` 동기. CI lock 검증 통과.
9. **C9 — lat 동기화**: `docs/lat/documents.md`의 spreadsheet 섹션이 새 옵션을 반영.
10. **C10 — 헤더 영향 없음**: 헤더 행은 zebra와 별개 배경으로 유지되고 헤더 가독성 회귀 없음.

---

## 2. 영향 받는 파일 (예상)

| 영역 | 파일 | 변경 종류 |
|---|---|---|
| Schema | `packages/shared/schemas/document.json` | spreadsheet `options.stripe` 신규 |
| Editor (Table) | `apps/web/src/features/editor/blocks/TableBlockEditor.tsx` | 하드코딩 zebra → 옵션 기반 (~2군데) |
| Editor (Spreadsheet) | `apps/web/src/features/editor/blocks/SpreadsheetBlockEditor.tsx` | zebra 클래스 + 토글 UI 추가 |
| Editor (toolbar) | (필요 시) `TableOptionsPanel.tsx` 재검토 | 변경 없을 가능성 (이미 토글 존재) |
| Export — html | `apps/api/app/services/html_export*.py` (spreadsheet 렌더) | options.stripe 반영 |
| Export — docx | `apps/api/app/services/docx_export*.py` (spreadsheet 렌더) | options 메타만 보존 (셀 색 굽지 않음) |
| lat | `docs/lat/documents.md` | spreadsheet 블록 properties 표 갱신 |
| LLM rules | `docs/llm-input-rules.md` + `dist/llm-docx-toolkit/llm-input-rules.md` | spreadsheet options 노출 |
| RAG | `dist/llm-docx-toolkit/rag/chunks.jsonl` + `index.lock` | chunker 재실행 결과 커밋 |
| Tests | `apps/web/src/features/editor/blocks/__tests__/*` | snapshot/단위 테스트 추가 |

정확한 경로·시그니처는 Design 단계에서 lat의 [[src/...]] 링크 따라 확정.

---

## 3. Open Questions (Design에서 결정)

- **Q1**: spreadsheet의 zebra 톤 — `bg-blue-50` vs `bg-sky-50` vs 별도 토큰? 디자인 시스템 색 토큰 (smsg-*)이 있다면 그쪽 사용.
- **Q2**: html export에서 zebra를 인라인 CSS로 굽는가, class만 출력하고 stylesheet 의존하는가?
- **Q3**: docx export — Word에서 같은 zebra 효과를 어떻게 재현? Word table style? 아니면 셀 단위 shd? 결정에 따라 *옵션 보존만* 할지 *시각 재현*까지 할지 갈림 (이번 사이클은 옵션 보존만으로 충분할 가능성).
- **Q4**: 다른 짝수 행 색이 이미 정의돼 있는지 (예: row hover, selected row와 충돌 가능성).
- **Q5**: 테스트 환경에서 BlockNote/spreadsheet 렌더 mount 비용이 큰지 — 비싸면 snapshot 대신 props 단위 단위테스트.

---

## 4. 다음 단계

`/pdca design zebra-striping`으로 Design 작성. Design 단계에서 위 Open Questions 확정 + 정확한 파일·라인·CSS 클래스 확정.
