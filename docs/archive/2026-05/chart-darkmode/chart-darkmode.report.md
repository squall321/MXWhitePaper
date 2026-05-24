---
template: report
version: 1.0
feature: chart-darkmode
date: 2026-05-24
project: MX White Paper
---

# Chart Darkmode — PDCA Completion Report

> **Cycle**: Plan → Design → Do → Check → Report → Archive
> **Status**: Complete
> **Commit**: `f911503`
> **Match Rate**: 98%

---

## 1. Executive Summary

### 1.1 Cycle Overview

| 항목 | 값 |
|---|---|
| Feature | `chart-darkmode` |
| Duration | ~2시간 (예상 2h, ⌀ 동일) |
| Commits | 1 (`f911503`) |
| Files | 10 changed, +913/-31 |
| Tests | +10 new + 1 snapshot |
| Match Rate | **98%** |

### 1.2 Acceptance Criteria

11/11 met (analysis 참조).

### 1.3 Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | 차트 위젯 (recharts ChartBlock + echarts EChartsView) 다크 미대응 — 흰 박스 + 검정 텍스트로 다크 본문에서 깨짐. SVG fill 토큰 트릭 (gantt-darkmode 패턴) 이 라이브러리 raster 내부에는 안 통함. |
| **Solution** | **useResolvedTheme hook** 신설 — html class/data-theme MutationObserver. ECharts는 theme 변화 시 dispose+init 으로 default 재픽업 + mergeThemeColors 로 axis/text 색 inject. recharts는 props 분기. 데이터 시리즈 8색 팔레트 그대로 (데이터 색은 *의미*, 다크 변형 시 시각화 의미 손실). |
| **Function/UX Effect** | 다크 테마에서 차트 figure 어두운 surface, 텍스트 밝음, axis 적절한 dark gray, PNG export 도 theme 배경. 사용자 시스템 테마 / 토글 모두 즉시 반영 (MutationObserver). |
| **Core Value** | "차트도 위젯 전반 다크 일관성에 합류" — 위젯 8/N 다크 지원 (table/spreadsheet/list/kpi/bibliography/figure-index/gantt + chart). **useResolvedTheme 패턴 확립** = 향후 외부 라이브러리 다크 통합 1시간으로 단축 (OrgChart, Plotly, Cytoscape 등). |

---

## 2. Cycle Timeline

| Phase | 결과 |
|---|---|
| Plan | 3 Open Q 명시, ~250 LOC 추정 |
| Design | mergeThemeColors 시그니처 구체화, dispose+init 패턴 명시 |
| Do | 10-step 직접 (~2h) — hook → EChartsView → ChartBlock → 테스트 → snapshot → lat |
| Check | 직접 작성, 98% Match Rate (function 분리 구조에 따른 LOW 디자인 deviation 1건) |
| Report | 본 문서 |

---

## 3. What was Built

### 3.1 신규 (4)
- `apps/web/src/features/theme/useResolvedTheme.ts` — hook + `readResolvedTheme` 헬퍼
- `__tests__/useResolvedTheme.test.tsx` — 4 케이스
- `apps/web/src/components/blocks/__tests__/ChartBlock.darkmode.test.tsx` — 2 케이스
- `apps/web/src/components/blocks/__tests__/EChartsView.darkmode.test.tsx` — 4 케이스

### 3.2 편집 (3)
- `EChartsView.tsx` — 헬퍼들 export + theme 분기 + dispose+init + figure dark
- `ChartBlock.tsx` — useResolvedTheme + recharts stroke 분기 + figure dark
- `docs/lat/charts.md` — 다크모드 한 문단 + Gotchas 1줄

### 3.3 자동
- AllBlocksRender snapshot 1 update

---

## 4. What was *Not* Built (yagni)

| 항목 | 사유 |
|---|---|
| 데이터 시리즈 8색 다크 변형 | 데이터 색은 *의미*. Plotly/D3 모두 동일 정책 |
| ECharts builtin 'dark' theme | 너무 검정, 디자인 시스템 deep navy 와 불일치 |
| recharts darkmode theme API | recharts에 공식 theme API 없음 |
| recharts Tooltip 다크 | 별도 (개선 ROI 낮음) |
| visual regression 자동화 | 인프라 사이클 (V 후보) |

---

## 5. Open Items (next-cycle)

| # | 항목 | 우선순위 |
|---|---|---|
| 1 | OrgChartBlock 다크 (mermaid theme) — 본 batch O 사이클 진행 중 | 진행중 |
| 2 | SVG 블록 audit — 본 batch S 사이클 다음 | 진행중 |
| 3 | recharts Tooltip 다크 변형 | LOW |
| 4 | 데이터 시각화 다크 팔레트 옵션 (사용자가 끄고 켤 수 있게) | LOW |
| 5 | visual regression (Playwright pixel diff) | LOW — 인프라 |

---

## 6. Lessons & Notes

### 6.1 useResolvedTheme 패턴 — 재사용 자산
다음 외부 라이브러리 다크 통합 시 그대로 사용:
```tsx
const theme = useResolvedTheme()
const colors = theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS
// 1. props로 색 분기 (recharts 류) — 즉시 반영
// 2. dispose+init (echarts 류) — useEffect on [theme]
// 3. SVG fill="var(...)" (네이티브 SVG) — 자동 (gantt-darkmode 패턴)
```

### 6.2 read 헬퍼 분리 = jsdom-free 테스트
프로젝트 컨벤션 (jsdom 미사용)에 따라 hook 내부 `read()` 를 `export readResolvedTheme()` 로 분리. globalThis.document 스텁만으로 4 케이스 검증 가능.

### 6.3 데이터 색 = 의미
시리즈 팔레트는 다크에서도 동일 — 보고서/논문에서 "blue line = sales" 같은 의미 mapping 이 다크/라이트 토글로 흔들리면 안 됨. Plotly/Tableau/D3 모두 동일 정책.

### 6.4 ECharts dispose+init 비용
한 차트당 ms 단위. theme 토글은 사용자 의도적 → 인터랙션 상태 reset OK. 시스템 다크 자동 전환도 거의 발생 X (사용자가 night-mode 켤 때 정도).

### 6.5 recharts ResponsiveContainer SSR 한계
SSR에서 width=0이라 차트 내부 (stroke 등) 미렌더. 테스트는 figure className 만 검증 (CartesianGrid stroke는 mergeThemeColors 단위 테스트가 커버).

---

## 7. Status / Next

- ✅ Plan → Design → Do → Check → Report 완료
- ⏳ Archive 대기
- 🎯 다음: O (orgchart-darkmode) → S (svg-block-audit)
