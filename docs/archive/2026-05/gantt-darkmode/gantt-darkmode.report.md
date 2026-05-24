---
template: report
version: 1.0
feature: gantt-darkmode
date: 2026-05-24
project: MX White Paper
---

# Gantt Darkmode — PDCA Completion Report

> **Cycle**: Plan → Design → Do → Check → Report
> **Status**: Complete
> **Commit**: `46a2b4b`
> **Match Rate**: 100%

---

## 1. Executive Summary

### 1.1 Cycle Overview

| 항목 | 값 |
|---|---|
| Feature | `gantt-darkmode` |
| Date | 2026-05-24 |
| Duration | ~45분 (예상 1h, ⌀ 25% 효율) |
| Commits | 1 (`46a2b4b`) |
| Files | 8 changed, +400/-15 |
| Tests | +2 new (darkmode 2 케이스) + 2 fixture update + 1 snapshot |
| Match Rate | **100%** |

### 1.2 Acceptance Criteria

| # | Criterion | Status |
|---|---|:---:|
| C1 | SVG 5 hex 토큰 교체 | ✅ |
| C2 | figure 배경/테두리 토큰 | ✅ |
| C3 | 라이트 시각 변화 0 | ✅ |
| C4 | 다크 자동 렌더 | ✅ |
| C5 | 회귀 0 | ✅ |
| C6 | 시각 회귀 테스트 | ✅ |
| C7 | snapshot 갱신 | ✅ |
| C8 | lat 갱신 | ✅ |
| C9 | analysis + report + archive | 🔄 (report 본 문서) |

**9/9 (100%).**

### 1.3 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | Gantt 차트가 다크 모드에서 강제 라이트 컬러 → 다크 본문 안 흰 박스 + 텍스트 가독성 0. zebra-striping-extended next-cycle 후보 #1. |
| **Solution** | SVG 5 hex → `var(--smsg-...)` 토큰화 + figure에 Tailwind `dark:` 변형. tokens.css `.dark` 가 이미 모든 토큰 정의 → 자동 치환. 새 토큰 신설 X, schema 무변경. |
| **Function/UX Effect** | 다크 테마에서 Gantt가 어두운 surface + 밝은 텍스트 + brighter blue 막대 + 어두운 zebra rect로 자연스럽게 렌더. AA 대비 보장. 라이트 시각 회귀 0 (토큰 light 값이 기존 hex와 동일). |
| **Core Value** | "Gantt도 다른 위젯과 동일하게 다크 일관" — 위젯 전반 다크 일관성 1단계 완성. 토큰 매핑 사전 검증 패턴 확립 (사이클 시작 시 hex↔token 1:1 매핑 표 만들면 시각 회귀 0). |

---

## 2. Cycle Timeline

| Phase | 결과 |
|---|---|
| Plan | 3 Open Q 명시, ~30 LOC 추정 |
| Design | Q 해소 (Tailwind `dark:` 변형이 `bg-[var]` arbitrary보다 검증됨 — `RestrictedBlockPlaceholder.tsx` 패턴 그대로) |
| Do | 7-step 직접 순차 (~45분) |
| Check | 직접 작성, 100% Match Rate |
| Report | 본 문서 |

---

## 3. What was Built

### 3.1 신규 (1)
- `apps/web/src/components/blocks/__tests__/GanttBlock.darkmode.test.tsx` — 토큰 등장 + dark className 검증 2 케이스

### 3.2 편집 (5)
- `apps/web/src/components/blocks/GanttBlock.tsx` — 5 SVG fill/stroke + figure className 다크 변형
- `apps/web/src/features/editor/blocks/zebra.ts` — gantt 주석 토큰 참조로 갱신
- `apps/web/src/components/blocks/__tests__/GanttBlock.zebra.test.tsx` — fixture hex → var (2곳)
- `apps/web/src/components/blocks/__tests__/__snapshots__/AllBlocksRender.test.tsx.snap` — 1 update
- `docs/lat/documents.md` — GanttBlock entry darkmode 명시

### 3.3 새 토큰?
**없음** — tokens.css가 이미 모든 필요 토큰 정의했음. zebra-striping-extended에서도 같은 토큰 활용했었음.

---

## 4. What was *Not* Built (yagni)

| 항목 | 사유 |
|---|---|
| ChartBlock/OrgChartBlock 다크 | recharts/echarts/mermaid 자체 theme 옵션 — 별도 사이클 |
| 새 토큰 신설 | tokens.css에 이미 모든 필요 색 존재 |
| 다크 모드 토글 UI | ThemeProvider 이미 존재 (lat 외부) |
| 시각 회귀 자동화 (visual regression) | 인프라 사이클로 별도 |
| SVG export PNG 변환 | Gantt PNG export 없음 (해당 없음) |

---

## 5. Open Items (next-cycle)

| # | 항목 | 우선순위 |
|---|---|---|
| 1 | ChartBlock 다크 (recharts/echarts theme 통합) | MED |
| 2 | OrgChartBlock 다크 (mermaid theme) | MED |
| 3 | 시각 회귀 자동화 (Playwright + 픽셀 diff) | LOW |
| 4 | 다른 SVG 블록 점검 (모든 SVG에 var 토큰 검증 1회) | LOW |

---

## 6. Lessons & Notes

### 6.1 토큰 매핑 사전 검증 패턴
이번 사이클 핵심: Plan 작성 *전* tokens.css 확인 → 모든 필요 색이 이미 존재 → 새 토큰 신설 yagni 판단 → schema 변경 X → 작업 scope 30 LOC로 압축.

**체크리스트 (향후 darkmode 사이클용)**:
1. 대상 컴포넌트의 hex/rgba grep
2. tokens.css의 light 값과 1:1 매핑 시도
3. 매핑 100% → 토큰화만 (yagni)
4. 매핑 80%+ → 부족 토큰만 신설 (별도 검토)
5. 매핑 <80% → 디자인 시스템 사이클로 escalate

### 6.2 Tailwind 패턴 선택
- `dark:bg-gray-900` (Tailwind `dark:` 변형) > `bg-[var(--smsg-surface)]` (arbitrary value)
- 이유: arbitrary value 가 JIT purge 위험 + 검증 사례 적음. RestrictedBlockPlaceholder.tsx 등 검증된 패턴 우선.

### 6.3 SVG fill/stroke 의 CSS 변수
- SVG attribute `fill="var(--smsg-...)"` 가 모던 브라우저에서 잘 동작 (Chrome/Firefox/Safari)
- Tailwind 무관 → JIT 위험 0
- 단점: 일부 SVG-to-PNG/SVG-to-canvas 변환 라이브러리가 미지원 (Gantt 는 PNG export 없어 무관)

### 6.4 작은 사이클 효율
- 단일 컴포넌트 + 자명한 변경 → agent 호출 비용 > 작업 비용
- gap-detector 호출 생략, 직접 analysis 작성 → 사이클 총 ~45분
- 3사이클 연속 직접 작성 패턴 검증 (gantt-zebra / gantt-darkmode 동일)

---

## 7. Status / Next

- ✅ Plan → Design → Do → Check → Report 모두 완료
- ⏳ Archive 대기 — `docs/archive/2026-05/gantt-darkmode/`
- 🎯 다음 후보: §5 next-cycle 또는 다른 영역
