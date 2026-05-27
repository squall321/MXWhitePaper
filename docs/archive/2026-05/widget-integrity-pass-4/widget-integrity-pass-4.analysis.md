# widget-integrity-pass-4 — Gap Analysis

> Date: 2026-05-27
> Plan: [widget-integrity-pass-4.plan.md](widget-integrity-pass-4.plan.md)
> Acceptance criteria 9건 (C1~C9) 매핑

## Implementation vs Plan Acceptance Criteria

| ID | Criteria | 상태 | 근거 |
|---|---|:---:|---|
| C1 | spreadsheet 행 삽입 시 모든 cell formula 가 자동 +1 shift (range 양끝) | ✅ | `referenceShift.ts` + `SpreadsheetBlockEditor.insertRow()`. 단위 테스트 — `row insert: =A1+B2 + insertAt=1 → =A2+B3`, range `=SUM(A1:A5) + insertAt=2 → =SUM(A1:A6)` 포함 |
| C2 | spreadsheet 열 삽입 시 column 참조 자동 shift | ✅ | 동일 helper, axis='col'. `=A1+B1 + col insertAt=1 → =A1+C1` |
| C3 | 행/열 삭제 UI + 삭제된 참조 → #REF!, 뒤쪽은 -1 shift | ✅ | `deleteRow/deleteCol()` + hover ✕ 버튼. `=A3 + delete row 3 → =#REF!`, `=A5 + delete row 3 → =A4` |
| C4 | gantt 막대 focus 시 ← → end ±1일, Shift+ ← → start+end 동시 | ✅ | `ganttKeyToPatch()` pure helper + onKeyDown. 4 키 매핑 단위 테스트 |
| C5 | gantt today marker SVG 표시 | ✅ | `<line stroke="#dc2626" strokeDasharray="4 3">` 범위 안일 때만 |
| C6 | 회귀 0 (BE/FE 기존 테스트 모두 통과) | ✅ | web vitest **2007/2007** (이전 1969 → +38 신규) / api pytest 1058/1058 변경 없음 / typecheck clean |
| C7 | 신규 테스트 9건 이상 | ✅ **초과** | **38건** 신규 (S1 referenceShift 26 + S2 SpreadsheetEditor 2 + G1 GanttEditor 7 + G2 GanttBlock 4 — plan 명시 9건 대비 +29) |
| C8 | lat / LLM rules / RAG 동기화 | ⚠️ 부분 | lat `documents.md` GanttBlock 키보드 한 줄 ✅ / LLM rules + RAG re-chunk 미적용 (block schema 무변경이라 drift 없음, 다음 사이클 cleanup 으로 묶어도 안전) |
| C9 | 사이클 보고서 (analysis + report) | ✅ | 본 문서 + [report.md] |

**Match Rate: 95%** (8.5/9, C8 부분 적용으로 0.5 차감)

## 코드 변경 요약

### 신규 파일 (3)
- `apps/web/src/features/editor/blocks/spreadsheet/referenceShift.ts` — `shiftReferences()` + `remapCells()` pure helper
- `apps/web/src/features/editor/blocks/spreadsheet/__tests__/referenceShift.test.ts` — 26 단위 테스트
- `apps/web/src/components/blocks/__tests__/GanttBlock.today.test.tsx` — 4 단위 테스트

### 수정 파일 (6)
- `SpreadsheetBlockEditor.tsx` — addRow/addCol → insertRow/insertCol(idx), deleteRow/deleteCol, ✕ 버튼 UI
- `GanttBlockEditor.tsx` — ganttKeyToPatch helper, onKeyDown + focus ring
- `GanttBlock.tsx` — today marker SVG line
- i18n `ko.ts` + `en.ts` — editor.gantt.barAriaLabel
- 회귀 테스트 보강 (SpreadsheetBlockEditor.test.tsx, GanttBlockEditor.test.tsx)

## Plan 제외 항목 (백로그 유지)

| 갭 | 사유 | 다음 사이클 |
|---|---|---|
| spreadsheet G4 (셀 범위 드래그 선택) | MED, 150 LOC | 별도 사이클 |
| spreadsheet G2 (엑셀 paste TSV 다중) | G4 의존 | G4 이후 |
| spreadsheet G5 (CSV/TSV export) | LOW | 미정 |
| gantt G1 (막대 drag 시각 조정) | MED, 마우스 인터랙션 복잡 | 별도 사이클 |
| gantt G3 (축 week/month/quarter 토글) | LOW | 미정 |
| gantt G5 (task dependencies) | schema 변경 필요 | 별도 사이클 |

## 작업 방식 변경

Plan 결정 #1 은 "직접 순차 작업" 이었으나, 실제로는 **3 갭 병렬 에이전트** 로 진행 (S1+S2 / G1 / G2). 갭이 영역별로 독립적이고 conflict 없어 병렬이 더 빠름. 3 에이전트 모두 1회 통과, conflict 0건.

## 발견된 부수 개선

- **i18n 변수 shadowing**: GanttBlockEditor 에서 map 변수 `t` 가 i18n `t` 함수와 shadow → 변수명 `task` 로 변경. 향후 신규 GanttBlockEditor 작업의 가드.
- **absolute 참조 `$A$1` 처리**: shiftReferences 가 `$` 보존하며 인덱스 shift — Excel 의 row/col insert 동작과 일치 (`$` 는 evaluation 시 lock 이지만 grid 구조 변경 시 shift 정상).
- **SVG today marker 의 SSR 안정성**: optional `today` prop 으로 주입 가능하게 설계 — visual regression 테스트 결정성 보장.

## 다음 단계

1. Report 작성 → archive 이동
2. 백로그 6 항목 중 우선순위 재정렬 (spreadsheet G4 가 다음 후보)
3. widget integrity 시리즈 종료 — *기능 추가* 단독 사이클 또는 *다른 영역* 으로 자유 전환
