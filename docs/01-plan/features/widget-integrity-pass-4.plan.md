# Widget Integrity Pass 4 — Planning Document

> **Summary**: spreadsheet/gantt audit 재검증 결과 — pass-1 A1 audit이 false-negative
> 다수. 큰 단독 사이클 불필요. 진짜 갭만 골라 한 cleanup 사이클로.
>
> **Project**: MX White Paper
> **Feature**: widget-integrity-pass-4
> **Version**: 0.1.0
> **Date**: 2026-05-19
> **Status**: Draft
> **Previous**: pass-1·2·3 (archive), spreadsheet-audit + gantt-audit (`docs/03-analysis/`)

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | pass-3 종료 후 백로그 H2(Spreadsheet UX) + H3(Gantt UI) "단독 사이클"로 분류됐으나, audit 재검증 결과 *둘 다 이미 풀 구현*. 진짜 갭은 spreadsheet G1+G3 (행/열 삽입 시 formula 보정 + 삭제 UI) + gantt G2+G4 (키보드 ←→ 일자 ± + today marker) 정도. |
| **Solution** | pass-3와 동일한 cleanup 패턴 — 작은 갭 4건 한 묶음. 직접 작업 (4분할 에이전트 안 씀). spreadsheet 변경은 formulaEngine 인접 작업이라 BE/schema 무관 — FE 단독. |
| **Function/UX Effect** | spreadsheet 사용자가 행/열 삽입 시 formula 깨지지 않음. 삭제 버튼 등장. gantt 사용자가 막대를 키보드 ←→로 일자 조정. 오늘 표시로 진행 시점 인지. |
| **Core Value** | "widget integrity 시리즈 4번째 종료" — pass-1·2·3·4로 모든 HIGH/MED 일관성 갭 해소. 이후 *기능 추가* 단독 사이클 또는 *다른 영역*으로 자유 전환. |

---

## 1. Overview

### 1.1 Purpose

pass-1 audit의 false-negative 정정 (spreadsheet 키보드/formula/에디터 모두 사실은 있음, gantt 에디터도 있음) + 진짜 작은 갭 처리.

### 1.2 본 사이클 처리 갭 (4건)

| # | 갭 | 출처 | 작업량 |
|---|---|---|---|
| S1 | spreadsheet 행/열 삽입 시 formula 참조 자동 보정 | spreadsheet-audit G1 | ~200 LOC + tests |
| S2 | spreadsheet 행/열 삭제 UI + 삭제 시 formula 보정 | spreadsheet-audit G3 | ~100 LOC + tests (S1 로직 재사용) |
| G1 | gantt 막대 키보드 ←→ 일자 ±1 조정 (`shiftDate` 헬퍼 이미 존재) | gantt-audit G2 | ~50 LOC + tests |
| G2 | gantt today marker (빨간 세로선) | gantt-audit G4 | ~20 LOC + tests |

합계 ~370 LOC + tests, **추정 3~4시간 (직접 작업)**.

### 1.3 본 사이클 *제외* (백로그)

| 갭 | 사유 |
|---|---|
| spreadsheet G4 (셀 범위 선택 드래그) | MED, 150 LOC — 별도 사이클 |
| spreadsheet G2 (엑셀 paste TSV 다중) | MED, G4 의존 |
| spreadsheet G5 (엑셀 export CSV/TSV) | LOW |
| gantt G1 (막대 drag로 시각 조정) | MED, 150 LOC — 별도 사이클 (마우스 인터랙션 복잡) |
| gantt G3 (축 week/month/quarter 토글) | LOW |
| gantt G5 (task 간 dependencies) | schema 변경 필요 — 별도 |

### 1.4 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | 작업 방식 | pass-3 와 동일 — 직접 순차 작업, 에이전트 안 씀 |
| 2 | S1 formula 참조 보정 알고리즘 | `parseRef()` + cell 키 grep → row/col 인덱스 ≥ 삽입 지점이면 +1 shift. 범위 (`A1:A5`) 도 양 끝점 둘 다 보정. AST 재작성 아닌 *문자열 정규식 치환* (formulaEngine 가 string 기반이므로 일관) |
| 3 | S2 삭제 시 동작 | 삭제된 행/열을 *참조하는* formula 는 `#REF!` 로 변경 (엑셀 표준). 단순 shift 가능한 참조는 shift |
| 4 | S2 삭제 UI 위치 | 행 헤더 (왼쪽 1, 2, 3...) 호버 시 ✕ 버튼, 열 헤더 (위 A, B, C...) 호버 시 ✕ |
| 5 | G1 키보드 매핑 | 막대 영역 (또는 행 row) 에 focus 시 ← → 로 *end* ±1일, Shift+← → 로 *start+end 동시* ±1일 (전체 이동) |
| 6 | G1 focus 표시 | outline 또는 ring (기존 디자인 시스템 토큰) |
| 7 | G2 today marker | `<line>` SVG, 빨강 (`#dc2626`), `strokeDasharray` 점선 |
| 8 | 테스트 전략 | S1·S2 는 *순수 함수* (formula shift helper) 추출 → 단위 테스트. G1 은 키보드 이벤트 시뮬레이션, G2 는 snapshot |
| 9 | matchRate 기준 | 90% |

### 1.5 Acceptance Criteria

1. **C1**: spreadsheet 행 삽입 시 모든 cell 의 formula 참조가 자동 +1 shift (range 양끝 둘 다)
2. **C2**: spreadsheet 열 삽입 시 column 참조 자동 shift
3. **C3**: 행/열 삭제 UI 동작 + 삭제된 참조는 `#REF!` 로 변경
4. **C4**: gantt 막대 focus 시 ← → 로 end 일자 ±1, Shift+← → 로 start+end 동시 이동
5. **C5**: gantt today marker 가 SVG 에 표시됨 (오늘 날짜 위치)
6. **C6**: 회귀 0 (BE/FE 기존 테스트 모두 통과)
7. **C7**: 신규 테스트 추가 (S1 shift 4 케이스 + S2 삭제 2 + G1 키보드 2 + G2 marker 1 = 9)
8. **C8**: lat / LLM rules / RAG 동기화 (작은 변경이라 lat 한 줄씩만)
9. **C9**: 사이클 보고서 (analysis + report)

---

## 2. 작업 순서 (직접)

1. S1 — formulaEngine 옆에 `shiftReferences(formula, axis, insertAt, delta)` 순수 함수 + 단위테스트
2. S1 — `SpreadsheetBlockEditor` 의 `addRow`/`addCol` 을 `insertRow(idx)` / `insertCol(idx)` 패턴으로 확장. 모든 cells 의 formula 에 shift 적용
3. S2 — `deleteRow(idx)` / `deleteCol(idx)` + 삭제 행/열 참조하는 formula 는 `#REF!` 로
4. S2 — UI: 행/열 헤더 호버 ✕ 버튼
5. G1 — 막대 focus + onKeyDown 핸들러. `shiftDate` 재사용
6. G2 — GanttBlock 시각화에 today line 추가
7. lat (1-2 줄), LLM rules (spreadsheet 섹션 갱신), RAG re-chunk
8. 회귀 + commit

---

## 3. 영향 받는 파일

- `apps/web/src/features/editor/blocks/spreadsheet/formulaEngine.ts` (또는 옆에 신규 `referenceShift.ts`)
- `apps/web/src/features/editor/blocks/SpreadsheetBlockEditor.tsx`
- `apps/web/src/features/editor/blocks/spreadsheet/__tests__/` (신규 `referenceShift.test.ts`)
- `apps/web/src/features/editor/blocks/__tests__/SpreadsheetBlockEditor.test.tsx` (insert/delete 회귀 보강)
- `apps/web/src/features/editor/blocks/GanttBlockEditor.tsx` (키보드)
- `apps/web/src/features/editor/blocks/__tests__/GanttBlockEditor.test.tsx`
- `apps/web/src/components/blocks/GanttBlock.tsx` (today marker)
- `docs/lat/documents.md` (spreadsheet/gantt 항목에 한 줄씩)
- `docs/llm-input-rules.md` + `dist/llm-docx-toolkit/llm-input-rules.md`
- `dist/llm-docx-toolkit/rag/{chunks.jsonl, index.lock}`

BE/schema 무변경 — pure FE cleanup.

---

## 4. 다음 단계

`/pdca design widget-integrity-pass-4` — 세부 알고리즘 (S1 shift 규칙) 확정 + 정확한 라인.
