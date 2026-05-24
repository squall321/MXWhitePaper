---
template: report
version: 1.0
feature: orgchart-darkmode
date: 2026-05-24
---

# OrgChart Darkmode — Completion Report

> Cycle: Plan → Do → Check → Report → Archive
> Match Rate: 100%

---

## 1. Executive Summary

### 1.1 Overview

| 항목 | 값 |
|---|---|
| Duration | ~25분 (예상 40분, ⌀ 38% 효율) |
| Files | 3 changed, +85/-9 |
| Tests | +3 (over-spec'd) + 1 snapshot |
| Match Rate | **100%** |

### 1.2 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | OrgChartBlock 순수 SVG 7 hex + figure/empty 흰 박스 → 다크 미대응. chart-darkmode report next-cycle #1. |
| **Solution** | gantt-darkmode 패턴 그대로 — SVG `fill="var(--smsg-...)"` + Tailwind `dark:` 변형. slate hex를 smsg-gray로 매핑 (시각 차이 ≤4 hex 단위, 인지 불가). useResolvedTheme hook 불요 (순수 SVG는 CSS var 자동 치환). |
| **Function/UX Effect** | 다크 테마에서 조직도 surface/text/edge/border 자연스럽게 inversion. hover active blue 도 brighter blue (smsg-blue-700 다크 = #93A5FF). 라이트 회귀 0. |
| **Core Value** | "OrgChart 다크 일관 + SVG 블록 darkmode 패턴 3번째 검증" — 패턴 안정성 확인 (gantt-zebra → gantt-darkmode → orgchart 모두 동일 단계). 후속 SVG 블록 1줄로 적용 가능. |

---

## 2. What was Built

### 신규 (1)
- `apps/web/src/components/blocks/__tests__/OrgChartBlock.darkmode.test.tsx` — 3 케이스

### 편집 (2)
- `apps/web/src/components/blocks/OrgChartBlock.tsx` — 7 SVG hex 토큰화 + figure/empty dark className
- `docs/lat/documents.md` — OrgChartBlock entry 신설

### 자동
- AllBlocksRender snapshot 1 update

---

## 3. What was *Not* Built

| 항목 | 사유 |
|---|---|
| slate 별도 토큰 신설 | gray 매핑으로 충분 (시각 ≤4 hex 차이) |
| Flow/diagram (mermaid) 다크 | OrgChart는 mermaid 아님. mermaid blocks는 별도 사이클 (mermaid theme API) |
| 다른 SVG 블록 같이 | S(svg-block-audit) 사이클로 별도 |

---

## 4. Open Items (next-cycle)

| # | 항목 |
|---|---|
| 1 | S (svg-block-audit) — 본 batch 마지막 사이클 (진행중) |
| 2 | Flow/diagram (mermaid) 다크 — mermaid theme |
| 3 | recharts tooltip 다크 (chart-darkmode 미해결) |

---

## 5. Lessons

- **SVG 블록 darkmode 패턴 3번째 검증** → 안정 패턴. 향후 1줄 적용:
  1. SVG `fill/stroke` hex → `var(--smsg-...)`
  2. figure className에 `dark:` 변형
  3. empty state도 동일
  4. AllBlocksRender snapshot `-u` 갱신
  5. 단위 테스트 1 (legacy hex 사라졌는지)
- slate vs smsg-gray (4 hex 단위 차이) — 시각 인지 불가, gray 통일이 메인터넌스 우월
- mermaid 와 순수 SVG 구분 명확화 (OrgChart는 mermaid 아님, FlowBlock 등이 mermaid)

---

## 6. Status

- ✅ All phases done
- ⏳ Archive
- 🎯 Next: S (svg-block-audit)
