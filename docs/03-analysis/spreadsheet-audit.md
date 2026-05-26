# Spreadsheet 위젯 진단 (post pass-1 false-negative 재검증)

> Date: 2026-05-19
> 트리거: pass-1 A1 audit 이 spreadsheet 갭을 *과대평가* 했을 가능성 → 재검증
> 결과: 큰 단독 사이클 불필요 — 작은 통합 사이클로 충분

## 현재 구현 (코드 확인됨)

| 항목 | 상태 | 근거 |
|---|:---:|---|
| Tab/Shift+Tab/Enter/Arrow 셀 이동 | ✅ | `SpreadsheetBlockEditor.tsx:128-154` |
| Formula 엔진 (8 함수: SUM/AVG/MIN/MAX/COUNT/IF/ROUND/CONCAT) | ✅ | `formulaEngine.ts` (500+ LOC) |
| 셀 참조 (`A1`, `A1:A10`) | ✅ | formulaEngine 파서 |
| 순환 참조 감지 (`#CYCLE!`) | ✅ | formulaEngine |
| 5 에러 타입 (`#REF!`, `#DIV/0!`, `#ERR!`, `#VALUE!`, `#CYCLE!`) | ✅ | formulaEngine |
| Headers 표시 | ✅ | SpreadsheetBlock view |
| 행/열 추가 (`addRow`, `addCol`) | ✅ | rows/cols 증가만 |
| **행/열 삽입 시 formula 참조 자동 보정** | ❌ | `A1:A5`가 그대로 — G1 |
| 행/열 삭제 UI | ❌ | G3 |
| 셀 범위 선택 (드래그/Shift+클릭) | ❌ | G4 |
| 엑셀에서 paste (TSV 다중 셀) | ❌ | G2 |
| 엑셀로 export (CSV/TSV) | ❌ | G5 |

## 진짜 갭 (우선순위)

| # | 갭 | 우선순위 | 작업량 (LOC) | 묶음 권고 |
|---|---|:---:|---:|---|
| **G1** | 행/열 삽입/삭제 시 formula 참조 자동 보정 | **HIGH** | 280 | pass-4 |
| **G3** | 행/열 삭제 UI | **HIGH** | 100 | pass-4 (G1과 같은 함수 재사용) |
| G4 | 셀 범위 선택 (드래그/Shift+클릭) | MED | 150 | pass-5 |
| G2 | 엑셀 paste (TSV 다중 셀) | MED | 190 | pass-5 (G4 이후) |
| G5 | 엑셀 export (CSV/TSV) | LOW | 80 | 백로그 |

## A1 audit false-negative 정정

**잘못된 보고 3건**:
1. "키보드 이동 없음" → 실제 Tab/Enter/Arrow 모두 처리됨
2. "Formula 엔진 부족" → 실제 8 함수 + 5 에러 타입 풀 구현
3. "에디터 부재" → 309 LOC 에디터 존재

**근본 원인**:
- audit이 함수 시그니처만 확인하고 *실제 호출 흐름*은 안 봄
- "Formula 자동 보정"을 "기본 formula 엔진 있음"으로 잘못 해석
- 작업량 추정이 부풀려짐

## 본 사이클 권고 (pass-4)

**G1 + G3 통합**: 행/열 *삽입/삭제 양쪽* 동작 + formula 참조 보정 한 묶음으로.
G1의 shift 로직이 G3 삭제에서도 *역방향*으로 재사용 가능 → 자연 통합.

예상: ~280 LOC + tests, **반나절 사이클**. 단독 vs 통합 — gantt audit 결과 보고 결정.

## 파일별 검증

- `SpreadsheetBlockEditor.tsx` (309 LOC) — 키보드 ✅, addRow/addCol만, insertRow/deleteRow/insertCol/deleteCol 전무
- `formulaEngine.ts` (500+ LOC) — 완벽
- `SpreadsheetBlock.tsx` (93 LOC) — read-only view
- `formulaEngine.test.ts` (263 LOC) — 풀 테스트
- `SpreadsheetBlockEditor.test.tsx` — smoke test만 (insert/delete 회귀 테스트 부족 — G1+G3 사이클에서 보강)
