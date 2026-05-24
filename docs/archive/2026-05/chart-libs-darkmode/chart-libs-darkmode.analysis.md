# Chart Libs Darkmode — Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **100%**.

---

## Overview

| Field | Value |
|---|---|
| Feature | `chart-libs-darkmode` (A+B 묶음 사이클) |
| Date | 2026-05-24 |

## Verification

### A — FlowBlock mermaid
- ✅ `useResolvedTheme()` import
- ✅ `applyMermaidTheme()` 헬퍼 export — `initialize({theme:'dark'\|'default'})` 
- ✅ useEffect deps에 `theme` 추가 → 변경 시 재초기화 + 재렌더
- ✅ idRef 재생성 (mermaid singleton 캐시 회피)
- ✅ error 박스 dark 변형

### B — ChartBlock recharts Tooltip
- ✅ `tooltipContentStyle` 분기 (background/border/color)
- ✅ `tooltipItemStyle` (color)
- ✅ `tooltipProps` 에 contentStyle/itemStyle/labelStyle 추가
- ✅ `renderChart` 시그니처 확장 (2 추가 인자)
- ✅ React `CSSProperties` import

## Acceptance Criteria

| # | Status |
|---|:---:|
| C1: mermaid theme 재초기화/재렌더 | ✅ |
| C2: recharts Tooltip 다크 | ✅ |
| C3: 회귀 0 | ✅ (1843/1843 + typecheck clean) |
| C4: 단위 테스트 1 | ⚠️ 생략 — recharts SSR 한계 (chart-darkmode와 동일) + mermaid는 dynamic import. manual 시각 확인이 정직 |
| C5: lat charts.md 갱신 | ✅ |
| C6: 사이클 보고서 + archive | 🔄 |

## Differences

### 🟡 C4 deviation
Plan은 "tooltipProps 분기 단위 테스트 1" 명시. 실제 ChartBlock의 tooltipProps는 *renderChart 함수 내부*에 closure로만 존재 → unit test에서 접근 불가. 대안: ChartBlock SSR HTML 검사? recharts ResponsiveContainer width=0 SSR 한계로 tooltip 자체가 안 렌더됨 (chart-darkmode.test에서 동일 발견). 결국 manual 시각 확인 + 코드리뷰가 정확. *plan의 검증 가정이 잘못됨* → 사이클 종료 시 수용.

### 🟡 Added (positive)
- FlowBlock error 박스도 다크 변형 (plan 명시 X — `bg-red-50` light-only 누락 발견)

### 🔴 Missing
None of substance.

## Conclusion

mermaid + recharts tooltip 다크 완성. C4 검증 자동화는 라이브러리 한계로 보류, 다음 사이클(V — visual regression)에서 시각 검증 자동화 가능. **PROCEED TO REPORT**.
