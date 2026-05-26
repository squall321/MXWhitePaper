# Gantt 위젯 진단 (post pass-1 false-negative 재검증)

> Date: 2026-05-19
> 트리거: pass-1 A1 audit 이 "에디터 없음 (추정)" 으로 보고했으나 사실 200 LOC 에디터 존재
> 결과: spreadsheet 와 같은 패턴 — 큰 단독 사이클 불필요, *시각 편집*만 추가하면 됨
> 비고: gantt-audit Explore 에이전트가 600초 stall 로 watchdog kill → 메인 직접 진단

## 현재 구현 (코드 확인됨)

| 항목 | 상태 | 근거 |
|---|:---:|---|
| **GanttBlockEditor.tsx 존재** | ✅ | 200 LOC, 풀 에디터 |
| Task 추가 (`add()`) | ✅ | L68, 기본값 progress=0, today ISO |
| Task 삭제 (`remove(idx)`) | ✅ | L87 + 173 onClick |
| Task 이름 input | ✅ | L136 |
| start 날짜 picker | ✅ | L141 `type="date"` |
| end 날짜 picker | ✅ | L149 `type="date"` |
| progress 숫자 input | ✅ | L160-165, 0-100 clamp |
| `shiftDate(iso, days)` 헬퍼 (날짜 ±) | ✅ | L25, 키보드 보조용 |
| GanttBlock.tsx 시각 렌더 (SVG) | ✅ | 66 LOC, axis + bar + progress overlay |
| docx export marker | ✅ | pass-2 G6 layout marker |
| 테스트 파일 | ✅ | GanttBlockEditor.test.tsx 존재 |

## 진짜 갭

| # | 갭 | 우선순위 | 작업량 |
|---|---|:---:|---|
| **G1** | **막대 drag로 start/end 시각 조정 (마우스)** | MED | ~150 LOC |
| G2 | 막대 키보드 조작 (←→ 일자 ±, `shiftDate` 헬퍼 이미 있음 — 연결만) | MED | ~50 LOC |
| G3 | 일자 축 토글 (week/month/quarter) | LOW | ~80 LOC |
| G4 | 오늘 표시 (today marker, 빨간 세로선) | LOW | ~20 LOC |
| G5 | task 간 dependencies (schema에도 없음 — 별도 사이클) | OUT | schema 변경 필요 |
| G6 | task 순서 변경 (drag 또는 ▲▼) | LOW | ~40 LOC |

## A1 audit false-negative 정정

**잘못된 보고 1건**:
- "에디터 없음 (추정), 수동 JSON 편집만" → 사실 *완전한* 에디터 200 LOC 존재 (add/remove/name/start/end/progress 다 입력 UI)

**근본 원인**: A1 audit이 file glob에서 `GanttBlockEditor` 누락. spreadsheet 와 같은 *함수만 보고 동작 안 봄* 패턴.

## 본 사이클 권고

**spreadsheet G1+G3 (행/열 삽입/삭제 + formula 보정) + gantt G2 (키보드 조작)** 통합 — 작은 픽스 묶음 cleanup 사이클.

gantt G1 (drag로 시각 조정)은 *MED 분량 큼* → 별도 단독 사이클 (gantt UX) 또는 백로그.

**추천**: pass-4 통합 사이클
- spreadsheet G1+G3 (~380 LOC) — HIGH
- gantt G2 (~50 LOC) — MED, `shiftDate` 이미 있어 연결만
- gantt G4 today marker (~20 LOC) — LOW, 시각 가치 큼

합계: ~450 LOC + tests, **~3~4시간**. 어제 pass-3와 비슷한 cleanup 패턴.

## 파일별 검증

- `GanttBlockEditor.tsx` (200 LOC) — 풀 입력 UI, drag/keyboard 부재
- `GanttBlock.tsx` (66 LOC) — 정적 SVG, today marker / 축 토글 부재
- schema `GanttBlock.tasks[].{name, start, end, progress}` — dependencies 필드 없음
- `GanttBlockEditor.test.tsx` — 존재 (구체 내용 미확인)

## 학습

audit 에이전트가 600초 stall 한 건 *gantt 쪽 코드 작아서* 인스펙션 단계에서 너무 많은 grep 시도하다 timeout 가능성. **다음에는 LOC 작은 위젯은 audit 에이전트 안 쓰고 메인 직접 점검** 권고.
