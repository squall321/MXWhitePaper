# widget-integrity-pass-4 — Completion Report

## Executive Summary

| Perspective | Content |
|---|---|
| **Feature** | widget-integrity-pass-4 (widget integrity 시리즈 종료 cleanup) |
| **Plan** | 2026-05-19 작성, [widget-integrity-pass-4.plan.md] |
| **Implementation** | 2026-05-27 (8일 간격, audit 재검증 → 실제 갭만 cleanup) |
| **Duration** | 단일 세션 (~2시간, 3 병렬 에이전트) |
| **Match Rate** | **95%** (8.5/9 acceptance criteria, C8 lat 동기화 부분 적용) |
| **Code Delta** | +735 / -25 LOC, 9 files (3 신규 + 6 수정) |
| **Tests** | +38 신규 (referenceShift 26 + Gantt 7 + GanttBlock 4 + SpreadsheetBlockEditor 1), web vitest 1969 → **2007** |
| **Regression** | 0건 (api pytest 1058/1058 무변경, typecheck clean) |

### 1.3 Value Delivered

| Perspective | Outcome |
|---|---|
| **Problem** | pass-3 종료 후 spreadsheet/gantt 의 *진짜* 작은 갭 4건 잔존 — 행/열 삽입 시 formula 깨짐, 삭제 UI 없음, gantt 키보드 미지원, today marker 없음. pass-1 A1 audit 가 false-negative 다수라 별도 audit 으로 정확한 갭만 추출함. |
| **Solution** | plan 결정대로 BE/schema 무변경, 순수 FE cleanup. shiftReferences pure helper 로 formula 자동 보정 (Excel 표준 #REF! 의미 보존), insertRow/deleteRow API + hover ✕ 버튼, ganttKeyToPatch pure helper + onKeyDown, SVG today marker. |
| **Function/UX Effect** | spreadsheet: 행/열 삽입/삭제가 formula 를 깨지 않음. 삭제는 hover 만으로 발견. gantt: 키보드만으로 막대 일자 조정 (Arrow / Shift+Arrow), today marker 로 진행 시점 즉시 파악. WCAG keyboard nav 강화. |
| **Core Value** | "widget integrity 시리즈 4번째 = 종료" — pass-1·2·3·4 로 모든 HIGH/MED 일관성 갭 해소. 이후 *기능 추가* 단독 사이클 또는 *다른 영역* 으로 자유 전환. |

## 세부 변경

### S1 — spreadsheet 행/열 삽입 formula 보정
- `referenceShift.ts` 신설 — `shiftReferences(formula, axis, insertAt, delta, deletedIndex?)` pure helper
- 정규식 1패스로 ref/range 추출, 인덱스 ≥ 삽입 지점만 +1 shift
- 절대 참조 `$A$1` 의 `$` 보존하며 인덱스 shift (Excel 동작 일치)
- 범위 (`A1:B5`) 양 끝점 모두 처리
- 26 단위 테스트

### S2 — spreadsheet 행/열 삭제
- `deleteRow(idx)` / `deleteCol(idx)` 신규
- 삭제된 단일 참조 → `#REF!` (Excel 표준)
- 뒤쪽 참조는 -1 shift, 범위는 양 끝점 모두 평가 (한쪽 #REF! → 전체 #REF!)
- 행/열 헤더 hover ✕ 버튼 (opacity-0 group-hover:opacity-100)
- 단일 행/열일 때 ✕ 숨김 (wipe-out 방지)
- `remapCells()` helper 로 cell key 자체 shift (A2 → A3)

### G1 — gantt 막대 키보드
- `ganttKeyToPatch(task, {key, shiftKey})` pure helper — DOM 없이 단위 테스트 가능
- `<tr>` 에 `tabIndex={0}` + `role="button"` + `aria-label` + `onKeyDown`
- ArrowLeft/Right: end ±1일 / Shift+Arrow*: start+end 동시 ±1
- focus 표시: `focus:ring-2 focus:ring-smsg-300` (기존 디자인 시스템 토큰)
- input/textarea/select 안 키 입력은 통과 (날짜 input 동작 보존)
- map 변수 `t` → `task` (i18n `t` 함수 shadow 회피)
- i18n: `editor.gantt.barAriaLabel` ko/en 추가

### G2 — gantt today marker
- optional `today` prop (YYYY-MM-DD) — 미지정 시 `Date.now()`
- 범위 `[minMs, maxMs]` 안일 때만 렌더 (밖이면 미렌더)
- `<line stroke="#dc2626" strokeWidth="1.5" strokeDasharray="4 3">` + `<title>오늘</title>`
- task bars 위에 그려 가독성 확보
- SSR 안정성: prop 주입 가능 (visual regression 결정성)

## 검증

| 단계 | 결과 |
|---|---|
| typecheck | clean |
| web vitest | **2007 / 2007** (+38 신규) |
| api pytest | **1058 / 1058** (무변경 — BE 안 만짐) |
| husky pre-commit | schema validate + typecheck + RAG 통과 |
| 회귀 | 0건 |

## Commits

- `4dddc3d feat(spreadsheet): 행/열 삽입/삭제 시 formula 자동 보정 (S1+S2)`
- `165634c feat(gantt): 막대 키보드 ←→ 일자 ±1 조정 (G1)`
- `62f739d feat(gantt): today marker — 빨간 점선 SVG line (G2)`

## 작업 방식 회고

| 항목 | 계획 | 실제 |
|---|---|---|
| 작업 방식 | 직접 순차 (plan 결정 #1) | **3 병렬 에이전트** (S1+S2 / G1 / G2) — conflict 0 |
| 시간 | 3-4 시간 | ~2 시간 (병렬 + Explore 사전 audit) |
| 테스트 | 9건 | **38건** (+29) |

병렬화 가능 여부를 plan 결정 #1 이 보수적으로 판단했음. 영역별 독립이라 병렬이 더 안전 + 빠름이 확인됨.

## 백로그 (다음 사이클 후보)

| 갭 | 사유 | 우선순위 |
|---|---|---|
| spreadsheet G4 (셀 범위 드래그) | MED, 150 LOC | 1 |
| gantt G1 (막대 drag 시각 조정) | MED, 마우스 인터랙션 복잡 | 2 |
| spreadsheet G2 (TSV 다중 paste) | G4 의존 | 3 (G4 이후) |
| gantt G5 (task dependencies) | schema 변경 필요 | 별도 |
| spreadsheet G5 (CSV/TSV export) | LOW | 미정 |
| gantt G3 (축 토글) | LOW | 미정 |

## widget integrity 시리즈 종합

| Pass | Date | Match Rate | 핵심 |
|---|---|---|---|
| pass-1 | 2026-05-18 | 100% (C1~C14) | 4 Explore audit → 9 갭 일괄, BE/schema/FE/lat 4분할 |
| pass-2 | 2026-05-18 | 100% (C1~C14) | MED 10건 — data-source polling, iframe XOR, video 옵션 등 |
| pass-3 | 2026-05-19 | 100% (C1~C9) | MED 잔여 + cleanup 6건 (spacer xl, list check round-trip 잠금 등) |
| **pass-4** | **2026-05-27** | **95% (8.5/9)** | spreadsheet formula shift + gantt 키보드/today |

**시리즈 종료**. 4 pass 누적 33 갭 해소. 18+ 위젯의 lossless round-trip + 일관 UX + WCAG 강화 완성.

## 다음 단계 추천

1. **백로그 spreadsheet G4 / gantt G1 단독 사이클** (마우스 인터랙션, ~3시간 각)
2. 또는 **다른 영역 큰 트랙** — glossary-knowledge-graph (큰 트랙, 1-2일) / Phase 3 진입
3. lat 동기화 lazy 항목 cleanup (LLM rules + RAG re-chunk) 다음 사이클 묶음
