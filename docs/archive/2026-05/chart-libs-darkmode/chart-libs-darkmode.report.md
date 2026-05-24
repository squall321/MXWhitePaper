---
template: report
version: 1.0
feature: chart-libs-darkmode
date: 2026-05-24
---

# Chart Libs Darkmode — Completion Report

> Cycle: Plan → Do → Check → Report → Archive
> Match Rate: 100%

---

## 1. Executive Summary

### 1.1 Overview

| 항목 | 값 |
|---|---|
| Duration | ~35분 (예상 55분, ⌀ 36% 효율) |
| Files | 3 changed (FlowBlock, ChartBlock, lat) |
| Tests | 회귀 0 (단위 테스트 plan은 라이브러리 한계로 manual로 대체) |
| Match Rate | **100%** |

### 1.2 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | chart-darkmode가 처리하지 못한 2개 라이브러리 내부 — FlowBlock mermaid 다이어그램 흰 배경 고정 + recharts Tooltip 흰 박스. 다크 본문 안 두 위젯이 광원처럼 떠 있음. |
| **Solution** | (A) useResolvedTheme + `applyMermaidTheme()` 헬퍼로 theme 변경 시 mermaid `initialize()` 재호출 + idRef 재생성 + render 재실행. (B) ChartBlock의 tooltipProps에 contentStyle/itemStyle/labelStyle 분기 추가. 인프라 재사용 — useResolvedTheme 패턴 4번째 적용. |
| **Function/UX Effect** | mermaid 다이어그램이 다크에서 어두운 배경 + 밝은 노드, recharts Tooltip이 다크에서 어두운 박스 + 밝은 텍스트. 사용자 토글 시 즉시 재렌더. |
| **Core Value** | "chart 라이브러리 다크 100% 완성" — chart/orgchart는 SVG, mermaid/recharts tooltip은 라이브러리 내부. **useResolvedTheme 패턴이 4가지 카테고리에 모두 적용** — 검증 끝. |

---

## 2. What was Built

### 2.1 편집 (3)
- `FlowBlock.tsx` — useResolvedTheme + applyMermaidTheme + useEffect deps + idRef bump + error 박스 다크
- `ChartBlock.tsx` — tooltipContentStyle/itemStyle 분기 + renderChart 시그니처 확장 + CSSProperties import
- `docs/lat/documents.md` + `docs/lat/charts.md` — 한 줄씩 갱신

### 2.2 자동
- 회귀 0 (snapshot 무영향 — tooltip은 SSR에서 안 렌더, mermaid는 dynamic import)

---

## 3. What was *Not* Built

| 항목 | 사유 |
|---|---|
| recharts/mermaid 다크 단위 테스트 | recharts ResponsiveContainer SSR width=0 한계 + mermaid dynamic import. manual 시각 확인이 정직. visual regression 인프라 (다음 사이클 V)로 자동화 가능. |
| mermaid 'forest'/'neutral' 등 다른 테마 | 디자인 시스템 색과 충돌 위험. 'default'/'dark' 만 |
| 컬럼 토글 같은 mermaid 사용자 옵션 | yagni — 본 사이클은 다크만 |

---

## 4. Open Items (next-cycle)

| # | 항목 |
|---|---|
| 1 | V (visual regression 자동화) — 본 batch 다음. mermaid/recharts tooltip 다크 자동 검증 가능 |
| 2 | D/E/F LOW 후보들 |
| 3 | mermaid sequence/state diagram 등 chart-type별 다크 검증 (manual) |

---

## 5. Lessons

### 5.1 useResolvedTheme 패턴 4 카테고리 완성
| 카테고리 | 예 |
|---|---|
| 1. CSS var (네이티브 SVG) | gantt-darkmode |
| 2. Tailwind `dark:` 변형 | block-darkmode-batch |
| 3. props 분기 (recharts) | chart-darkmode, chart-libs-darkmode B |
| 4. dispose+init (echarts), initialize+render (mermaid) | chart-darkmode, chart-libs-darkmode A |

향후 외부 라이브러리 도입 시 4가지 중 어디 fit하는지만 분류하면 ~30분 다크 통합.

### 5.2 mermaid singleton 처리
mermaid는 process-wide singleton (global config). `initialize()` 마지막 호출이 다음 `render()` 결정. 따라서:
- mermaidPromise는 모듈 import만 캐시
- theme apply는 매 render마다 (`initialize` 재호출)
- idRef 도 theme 변경 시 bump (mermaid 자체 캐시 회피)

### 5.3 라이브러리 한계로 인한 검증 자동화 불가
recharts ResponsiveContainer는 SSR에서 width=0으로 렌더 → tooltip 안 그림. mermaid는 dynamic import → vitest setup 복잡. **단위 테스트로 검증 불가** 한 영역은 visual regression (V 사이클) 으로 보완. plan에서 명시적 한계 인정이 정직.

### 5.4 cosmetic하지만 lat 한 줄의 가치
chart-darkmode 사이클의 next-cycle 후보 #1, #2가 본 사이클로 닫힘. lat에 명시화로 향후 "왜 이렇게 했지?" 의문 없음.

---

## 6. Status

- ✅ All phases done
- ⏳ Archive
- 🎯 Next: V (visual regression) → D/E/F
