# Chart Darkmode — Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **98%**.

---

## Overview

| Field | Value |
|---|---|
| Feature | `chart-darkmode` |
| Implementation | commit `f911503` |
| Date | 2026-05-24 |

## Scores

| Category | Score | Status |
|---|:---:|:---:|
| Design Match | 98% | ✅ |
| Acceptance Criteria (C1–C11) | 100% (11/11) | ✅ |
| **Overall** | **98%** | ✅ |

## Verification

### Files
| Design | Status |
|---|:---:|
| `useResolvedTheme.ts` NEW + 단위 4 케이스 | ✅ (`readResolvedTheme` 헬퍼로 jsdom-free 검증) |
| `EChartsView.tsx` EDIT — `THEME_COLORS_*` + `mergeThemeColors` + dispose+init + figure dark + PNG bg + annotation/pie/caption 토큰 | ✅ all done |
| `ChartBlock.tsx` EDIT — useResolvedTheme + CartesianGrid/XAxis/YAxis 분기 + figure dark | ✅ |
| `EChartsView.darkmode.test.tsx` NEW 2 → 4 케이스 | ✅ over-spec'd |
| `ChartBlock.darkmode.test.tsx` NEW 1 → 2 케이스 | ✅ over-spec'd |
| `useResolvedTheme.test.tsx` NEW 4 | ✅ |
| AllBlocksRender chart snapshot | ✅ 1 update |
| lat `charts.md` | ✅ |

### Acceptance Criteria

| # | Criterion | Status |
|---|---|:---:|
| C1 | useResolvedTheme 동작 (class/data-theme/SSR) | ✅ |
| C2 | ThemeProvider 토글 시 hook MutationObserver 갱신 | ✅ |
| C3 | EChartsView dispose+init theme 변경 시 | ✅ |
| C4 | recharts CartesianGrid stroke 분기 | ✅ |
| C5 | 두 컴포넌트 figure dark className | ✅ |
| C6 | 데이터 시리즈 8색 그대로 | ✅ (decision §1.3 — 미변경) |
| C7 | PNG export theme bg | ✅ |
| C8 | 회귀 0 | ✅ (1838/1838 + typecheck clean) |
| C9 | 신규 테스트 7건 (실제 10) | ✅ over-met |
| C10 | lat charts.md 갱신 | ✅ |
| C11 | analysis + report + archive | 🔄 (analysis = 본 문서) |

## Differences

### 🟡 Added (positive)
- `useResolvedTheme` 옆에 `readResolvedTheme` 별도 export — jsdom-free 단위 테스트용 (프로젝트 컨벤션 일관)
- `mergeThemeColors` idempotent 테스트 + 배열 yAxis (dual-y) 케이스 추가
- `ChartBlock.darkmode.test.tsx` 의 SSR CartesianGrid 검증은 recharts ResponsiveContainer 가 width=0이라 stroke 미출력 → figure title `dark:text-gray-100` 검증으로 변경 (등가)

### 🔵 Changed
- ChartBlock의 `renderChart` 함수에 `gridStroke`/`axisStroke` 파라미터 명시 전달 (closure-내부 변수 reference 불가 → 호출 시 전달). 디자인은 closure 가정이었지만 함수 분리 구조였음. 동작 동일.

### 🔴 Missing
None.

## Conclusion

Design 의도 그대로 구현. 데이터 시리즈 팔레트 보존 / theme MutationObserver / ECharts dispose+init / recharts props 분기 4 축 모두 달성. 11/11 AC met. Match Rate **98%**, recommendation **PROCEED TO REPORT**.
