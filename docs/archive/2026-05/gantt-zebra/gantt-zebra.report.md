---
template: report
version: 1.0
feature: gantt-zebra
date: 2026-05-24
project: MX White Paper
---

# Gantt Zebra — PDCA Completion Report

> **Cycle**: Plan → Design → Do → Check → Report
> **Status**: Complete (archive 대기)
> **Commit**: `3ffc50d`
> **Match Rate**: 100%

---

## 1. Executive Summary

### 1.1 Cycle Overview

| 항목 | 값 |
|---|---|
| Feature | `gantt-zebra` |
| Started | 2026-05-24 |
| Completed | 2026-05-24 |
| Duration | ~1시간 (예상 ~1.5h, ⌀ 33% 초과 효율) |
| Commits | 1 (`3ffc50d`) |
| Files | 16 changed, +681/-27 |
| Tests | +4 new + 1 snapshot update |
| Match Rate | **100%** |

### 1.2 Acceptance Criteria

| | Criterion | Status |
|---|---|:---:|
| C1 | Gantt 옵션 "줄무늬" 체크박스 | ✅ |
| C2 | 토글 ON 시 odd 행 `<rect fill="#F9FAFB">` | ✅ |
| C3 | 토글 OFF 시 zebra rect 0개 | ✅ |
| C4 | 기본값 ON | ✅ |
| C5 | z-order 올바름 | ✅ |
| C6 | `getZebraClass('gantt', ...)` 동작 | ✅ |
| C7 | 회귀 0 | ✅ |
| C8 | 신규 테스트 4건 (실제 5+) | ✅ |
| C9 | lat + LLM rules 동기화 | ✅ |
| C10 | analysis + report + archive | 🔄 (report 본 문서) |

**10/10 (100%).**

### 1.3 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | Gantt 차트 task가 10+ 일 때 행 시각 흐름 끊김. zebra-striping-extended가 6 위젯 통합했지만 SVG 단일 컴포넌트인 gantt는 의도적 out-of-scope였음. |
| **Solution** | SVG 첫 자식으로 `<rect fill="#F9FAFB">` 그룹 추가 (axis line/막대 뒤). `STRIPE_CLASSES['gantt']`는 ZebraToggle exhaustive type 위한 dummy entry, 본문 fill은 인라인 hex. schema add-only optional 패턴 그대로. |
| **Function/UX Effect** | task 5+ gantt에서 행 구분 즉시 명확. label 영역 포함 전체 행 음영으로 시각 단위 명확. 옵션 미지정 옛 문서도 자동 ON. |
| **Core Value** | "zebra가 row-based widget **7/7**에 일관" — UX 일관성 100% 달성. 향후 row-widget 추가 시 1-2줄로 끝나는 패턴 검증 완료 (3번째 사이클로 굳어짐: pass-1 / zebra-striping-extended / gantt-zebra). |

---

## 2. Cycle Timeline

| Phase | 결과 |
|---|---|
| Plan | gantt-zebra.plan.md 작성, 3 Open Questions 명시, ~125 LOC 추정 |
| Design | design.md 작성, Q1/Q2/Q3 해소 (label 포함, STRIPE_HEX 신설 no, ZebraToggle 변경 no) |
| Do | 9-step 직접 순차 작업 (~1시간) — schema → zebra.ts → GanttBlock → Editor → 테스트 → typecheck → vitest → API pytest → lat/rules |
| Check | gap analysis 직접 작성 — 100% Match Rate |
| Report | 본 문서 |

---

## 3. What was Built

### 3.1 신규 파일 (1)
- `apps/web/src/components/blocks/__tests__/GanttBlock.zebra.test.tsx` — view 회귀 3 케이스

### 3.2 편집 파일 (5)
- `packages/shared/schemas/document.json` — GanttBlock `options.stripe?` 추가
- `apps/web/src/features/editor/blocks/zebra.ts` — union/map 1줄씩
- `apps/web/src/components/blocks/GanttBlock.tsx` — `stripeOn` + SVG zebra rect
- `apps/web/src/features/editor/blocks/GanttBlockEditor.tsx` — `<ZebraToggle>` 1줄
- `apps/web/src/features/editor/blocks/__tests__/zebra.test.ts` — gantt 단위 테스트 +1
- `apps/web/src/features/editor/blocks/__tests__/GanttBlockEditor.test.tsx` — 토글 노출 테스트 +1
- `docs/lat/documents.md`, `docs/llm-widgets-via-api.md` — 7-종 동기화

### 3.3 자동 갱신
- `apps/api/app/schemas/document.py` (pydantic regen)
- `apps/web/src/types/document.ts` (TS regen)
- AllBlocksRender snapshot 1개

---

## 4. What was *Not* Built (yagni)

| 항목 | 사유 |
|---|---|
| Gantt 다크 모드 | gantt 자체 light-mode 하드코딩 — 별도 사이클 필요 |
| 색 사용자 커스텀 | next cycle 후보 (zebra-striping-extended 보고서에도 명시) |
| docx/pptx export marker에 stripe 정보 | Gantt export 자체가 단순 placeholder — 의미 없음 |
| `STRIPE_HEX` 별도 map | 1곳 인라인 사용이라 추출 yagni — 향후 SVG zebra가 늘면 그때 |
| Other SVG widgets (org-chart, flow) zebra | row 개념 약함 — 의미 부족 |

---

## 5. Open Items (next-cycle 후보)

| # | 항목 | 우선순위 |
|---|---|:---:|
| 1 | Gantt 다크 모드 대응 (`fill="#1A1A1A"` 등 토큰화) | MED |
| 2 | Zebra 색 사용자 커스텀 (디자인 시스템 토큰 선택) | LOW |
| 3 | Gantt 기타 UX 갭 (drag, today marker, dependencies — `gantt-audit.md` 참조) | MED~OUT |

---

## 6. Lessons & Notes

### 6.1 패턴 확립
- **공통 utility + 공통 UI + 블록별 thin patch** 가 3사이클 연속 검증됨 (pass-1 zebra docs intro / zebra-striping-extended 4-block / gantt-zebra 1-block).
- 후속 row-widget 추가 시 *체크리스트*:
  1. schema에 `options.stripe?` add-only
  2. zebra.ts union/map에 1줄 (SVG면 dummy entry + comment)
  3. View에 `getZebraClass()` 호출 또는 SVG `<rect>` 그룹
  4. Editor에 `<ZebraToggle blockType="..." />` 1줄
  5. lat documents.md Gotcha #10의 종 수 갱신
  6. llm-widgets §3.X에 stripe 1줄 + §3.22 callout 종 수 갱신

### 6.2 작은 사이클 효율
- ~125 LOC 단일 컴포넌트 작업은 **agent 호출 비용 > 작업 비용**. gap-detector 호출 생략하고 직접 analysis 작성한 게 정답.
- Plan + Design 두 문서가 *간결*해서 Do가 헤맴 없이 직진했음.

### 6.3 SVG zebra 노하우
- **z-order = paint order**. zebra rect를 *첫 자식*으로 두면 모든 후속 element 가 위에 그려짐.
- `data-gantt-zebra-row` attribute가 테스트 fixture로 유용 — count 검증이 className grep보다 안정적.

---

## 7. Status / Next

- ✅ Plan → Design → Do → Check → Report 모두 완료
- ⏳ Archive 대기 — `docs/archive/2026-05/gantt-zebra/`
- 🎯 다음 후보: Section 5의 next-cycle 후보 또는 다른 영역
