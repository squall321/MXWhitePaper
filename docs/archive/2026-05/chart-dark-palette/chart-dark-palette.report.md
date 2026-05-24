---
template: report
version: 1.0
feature: chart-dark-palette
date: 2026-05-24
---

# Chart Dark Palette — Completion Report

> Cycle: Plan → Do → Check → Report → Archive
> Match Rate: 100%

---

## 1. Executive Summary

### 1.1 Overview

| 항목 | 값 |
|---|---|
| Duration | ~30분 (예상 40분, ⌀ 25% 효율) |
| Files | EChartsView.tsx + 단위 테스트 1 + lat 1 |
| Match Rate | **100%** |

### 1.2 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | chart-darkmode 사이클은 "데이터 색은 의미 — 미변경" 결정. 하지만 시리즈 0번 (`#1428A0` = smsg-blue-700) 가 다크 surface (`#111827`) 위에서 대비 부족 → 막대 가독성 ↓. |
| **Solution** | `PALETTE_DARK` 8색 brighter variant 신설 + `getPalette(theme)` 헬퍼. 인덱스 일관성 유지 (i=0 always blue family) → 의미 매핑 보존. buildOption 시그니처에 palette 인자 추가 (default PALETTE — 호환). useMemo에서 자동 전달. series.color override는 그대로 우선. |
| **Function/UX Effect** | 다크 차트에서 시리즈 색이 brighter blue/emerald/amber 등으로 자동 전환 → 가독성 ↑. 사용자가 "blue line = sales" 같은 의미 mapping을 인지하던 흐름 그대로. |
| **Core Value** | "데이터 색 의미 + 다크 가독성 둘 다" — chart-darkmode 사이클의 미해결 디테일 닫음. **인덱스 일관성으로 의미 보존**이 핵심 — 색을 바꾸지 *않은* 게 아니라 *같은 색의 다른 luminance*. |

---

## 2. What was Built

### 2.1 신규 (1)
- `apps/web/src/components/blocks/__tests__/EChartsView.palette.test.ts` — 3 케이스

### 2.2 편집 (2)
- `EChartsView.tsx` — PALETTE_DARK + getPalette export + buildOption palette 인자 + 5 호출처 변경 + useMemo 호출
- `docs/lat/charts.md` — Gotchas 1줄 갱신

---

## 3. What was *Not* Built (yagni)

| 항목 | 사유 |
|---|---|
| 사용자 옵션 토글 (강제 light palette 선택) | 자동이 정직 — 다크에선 무조건 dark variant. 옵션은 미요청 |
| recharts ChartBlock 동일 적용 | 본 사이클은 EChartsView 한정. recharts에도 적용은 후속 사이클 (chart-darkmode 사이클의 PALETTE도 같이 다크 변형 필요할 수 있음) |
| 8색 외 추가 색 | yagni — 8색 cycle 충분 |
| color blindness 친화 변형 | 별도 a11y 사이클 |

---

## 4. Open Items (next-cycle 후보)

| # | 항목 |
|---|---|
| 1 | recharts ChartBlock 동일 PALETTE 다크 변형 (현재 ChartBlock에 별도 PALETTE 8색 존재) |
| 2 | E (whiteboard-color-auto-invert) — 다음 batch |
| 3 | color blindness 친화 (별도 a11y) |

---

## 5. Lessons

### 5.1 의미 보존 = "같은 색의 다른 luminance"
"데이터 색은 의미"라는 chart-darkmode 결정은 *반은 맞고 반은 틀림*. **인덱스 일관성**만 유지하면 luminance shift는 OK — 사용자는 "blue line"이 "어두운 blue vs 밝은 blue"로 인식, 의미 동일. 절대 hex는 가변, 의미는 인덱스+계열.

### 5.2 buildOption 시그니처 확장 패턴
chart-darkmode (`colors` 인자) + chart-dark-palette (`palette` 인자) 둘 다 *default 값으로 호환*. 향후 더 추가될 수 있음 — 매개변수 객체로 묶을지 고민 (현재는 2개라 yagni).

### 5.3 단위 테스트의 의미 검증
"blue family preservation" 케스: RGB 값 직접 비교로 *어떤 light/dark든 i=0이 blue 계열*임을 자동 검증. 향후 누군가가 PALETTE_DARK[0] 을 red로 잘못 바꾸면 CI 빨강.

---

## 6. Status

- ✅ All phases done
- ⏳ Archive
- 🎯 Next: F → E
