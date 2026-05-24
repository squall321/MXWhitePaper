# Chart Darkmode — Planning Document

> **Summary**: ChartBlock (recharts) + EChartsView (echarts) 가 다크 모드에서
> 텍스트/축이 검정으로 남아 깨짐. **runtime theme resolver hook** + ECharts
> `dispose+init` 재초기화 + recharts 색 props 토큰 hex 주입으로 완전 다크 대응.
> 데이터 시리즈 팔레트는 그대로 (의미 보존).
>
> **Project**: MX White Paper
> **Feature**: chart-darkmode
> **Version**: 0.1.0
> **Date**: 2026-05-24
> **Status**: Draft
> **Previous**: gantt-darkmode (`docs/archive/2026-05/gantt-darkmode/`)

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | 차트 위젯 (chart-block: recharts + EChartsView: echarts) 가 다크 모드에서 검정 텍스트/축으로 남음. figure container도 흰 박스로 떠 있어 다크 본문에 충돌. gantt-darkmode와 동일 결손이지만 차트는 *런타임 raster* 라이브러리라 SVG fill 토큰 트릭이 안 통함. |
| **Solution** | `useResolvedTheme()` hook 신설 → `data-theme` 속성 + `.dark` class를 MutationObserver로 관찰, 변화 시 currentTheme state 갱신. EChartsView가 theme 변화 시 chart instance dispose+init 재생성 (option은 동일, theme prop만 다름). recharts는 props로 `stroke`/`fill` 토큰 hex 주입 (getComputedStyle 1회 해석). figure는 Tailwind dark 변형. |
| **Function/UX Effect** | 다크 테마에서 chart 텍스트가 밝아지고, axis가 흐린 회색 → 적절한 dark gray, container가 어두운 surface. 데이터 시리즈 색 (1428A0/2E5BFF 등 8색)은 그대로 — 데이터 의미 보존. 시스템 테마 변경 / 사용자 토글 모두 즉시 반영. |
| **Core Value** | "차트도 위젯 전반 다크 일관성에 합류" + **runtime theme resolver 패턴 확립** (재사용 자산). 향후 다크 대응 필요한 외부 라이브러리 (Plotly, Cytoscape 등) 가 들어와도 같은 hook으로 5분 통합. |

---

## 1. Overview

### 1.1 Purpose

ChartBlock + EChartsView 다크 모드 완전 대응. gantt-darkmode 의 SVG-only 토큰화로
부족한 *라이브러리 raster* 케이스 처리.

### 1.2 본 사이클 처리 갭

| # | 갭 | 작업량 |
|---|---|---|
| C1 | `useResolvedTheme()` hook 신설 — `html` element class/attr observer | ~50 LOC + tests |
| C2 | EChartsView — theme 변화 시 dispose+init 재생성, axis/text 색을 토큰 hex로 inject | ~70 LOC |
| C3 | ChartBlock (recharts) — CartesianGrid `stroke` props 토큰화, figure className 다크 변형 | ~30 LOC |
| C4 | tests — useResolvedTheme hook 단위 + Chart/EChartsView 통합 | ~80 LOC |
| C5 | lat docs/lat/charts.md + documents.md 갱신 | ~10 LOC |

### 1.3 본 사이클 *제외* (근거)

| 항목 | 사유 |
|---|---|
| 데이터 시리즈 8 색 다크 변형 | 데이터 시각화 색은 *의미*. 다크에서도 동일 색이 정석 (Plotly/D3/Tableau 모두 동일 정책) |
| chart-block hidden marker (docx export) | export는 BE 무관, FE 시각만 |
| ECharts 빌트인 'dark' theme 사용 | 너무 검정 — 우리 디자인 시스템의 deep navy (#0B1220) 와 다름. 커스텀 light/dark 분기가 일관성 우선 |
| recharts darkmode theme prop | recharts에 공식 theme API 없음 — props 명시가 표준 |

### 1.4 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | Hook 위치 | `apps/web/src/features/theme/useResolvedTheme.ts` (ThemeProvider 인접) |
| 2 | Hook API | `useResolvedTheme(): 'light' \| 'dark'`. SSR-safe (기본 'light'). MutationObserver on `documentElement.classList` |
| 3 | EChartsView dispose+init | theme 변화 useEffect에서 `inst.current?.dispose() + init(el, undefined, ...)` 후 option setOption 재호출. existing build option 함수 그대로 |
| 4 | ECharts option 색 주입 | option.textStyle.color, xAxis/yAxis.axisLine.lineStyle.color, axisLabel.color, splitLine.lineStyle.color 등을 currentTheme 에 따라 hex 직접 주입 |
| 5 | 색 매핑 (light → dark) | text: `#1A1A1A` → `#E5E7EB`, axis line: `#E5E7EB` → `#374151`, split line: `#F3F4F6` → `#1F2937`, caption text: `#888` → `#9CA3AF`, annotation default: `#666` → `#9CA3AF` |
| 6 | recharts CartesianGrid stroke | currentTheme 에 따라 `#E5E7EB` 또는 `#374151` props로 분기 |
| 7 | figure className | 두 컴포넌트 모두 `dark:border-gray-700 dark:bg-gray-900` 추가 (gantt-darkmode와 일관) |
| 8 | ECharts PNG export bg | `backgroundColor: '#fff'` → currentTheme 에 따라 `#fff` 또는 `#111827`. 사용자가 export 시 보던 그대로 PNG |
| 9 | 시리즈 팔레트 | 변경 X — 데이터 시각화 색 의미 보존 (Decision 1.3) |
| 10 | tests | useResolvedTheme 단위 4 (default light / .dark class detection / data-theme detection / class change observer) + EChartsView option 색 분기 2 + ChartBlock CartesianGrid color 분기 1 = 7 |
| 11 | matchRate 기준 | 90% |
| 12 | lat 갱신 | `docs/lat/charts.md` (useResolvedTheme 추가 + EChartsView dispose+init 패턴 명시) + `docs/lat/documents.md` (ChartBlock 다크 한 줄) |

### 1.5 Acceptance Criteria

1. **C1**: `useResolvedTheme()` hook 동작 — `.dark` class 또는 `data-theme="dark"` 시 'dark', 아니면 'light' 반환
2. **C2**: ThemeProvider가 토글하면 hook이 자동 갱신 (MutationObserver)
3. **C3**: EChartsView가 theme 변화 시 dispose+init 재생성, 새 option에 dark 색 적용됨
4. **C4**: ChartBlock CartesianGrid stroke 가 theme에 따라 분기
5. **C5**: 두 컴포넌트 figure 모두 dark 변형 className
6. **C6**: 시리즈 데이터 색 (8색 팔레트) 그대로 유지
7. **C7**: PNG export 가 현재 theme 배경으로
8. **C8**: 회귀 0 (web vitest, typecheck)
9. **C9**: 신규 테스트 7건
10. **C10**: lat 갱신
11. **C11**: 사이클 보고서 + archive

---

## 2. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| useResolvedTheme hook + 단위 테스트 4 | ~100 | 30분 |
| EChartsView theme 분기 + option 색 주입 + dispose+init | ~70 | 45분 |
| ChartBlock CartesianGrid + figure className | ~20 | 10분 |
| 통합 테스트 3 (option 색 분기 2 + Cartesian 1) | ~50 | 20분 |
| AllBlocksRender snapshot 갱신 (chart 1, gantt는 영향 X) | — | 5분 |
| typecheck + 전체 vitest | — | 10분 |
| lat charts.md + documents.md 갱신 | ~10 | 5분 |
| **합계** | **~250** | **~2시간** |

---

## 3. Risks & Mitigations

| 위험 | 영향 | 대응 |
|---|---|---|
| ECharts dispose+init 가 사용자 인터랙션 (zoom 등) 상태를 리셋 | UX 후퇴 | theme 변화는 사용자 의도적 토글이라 reset OK. 인터랙션 중 자동 다크 전환은 거의 안 일어남 (시스템 테마 변경 정도) |
| Hook이 SSR (renderToStaticMarkup) 에서 documentElement 없음 | crash | typeof document 체크 + 기본 'light' 반환 |
| MutationObserver leak | 메모리 | useEffect cleanup에서 disconnect() |
| recharts CartesianGrid stroke props만으로 부족 (axis text는 따로) | 일부 다크 미적용 | recharts XAxis/YAxis 의 `stroke`/`tick` props 도 토큰화 — 작업 범위 약간 확장 |
| getComputedStyle 호출이 다크 변경 직후 stale 값 반환 | 잘못된 색 | MutationObserver는 *변경 후* 발화 — `getPropertyValue` 호출 시 이미 새 값 |
| 시리즈 팔레트 첫 색 `#1428A0` (smsg-blue-700) 이 어두워서 다크 배경에서 가독성 저하 | 시각 손실 | Decision 1.3 + 보고서 §5에 후속 사이클로 escalate (데이터 시각화 다크 팔레트 별도) |

---

## 4. Design 세부

### 4.1 파일

```
apps/web/src/features/theme/
├── useResolvedTheme.ts                       # NEW (hook)
└── __tests__/useResolvedTheme.test.tsx       # NEW (4 케이스)

apps/web/src/components/blocks/
├── ChartBlock.tsx                            # EDIT — CartesianGrid stroke + figure className
├── EChartsView.tsx                           # EDIT — theme effect + option 색 주입
└── __tests__/
    ├── ChartBlock.darkmode.test.tsx          # NEW (1 케이스 — Cartesian stroke 분기)
    └── EChartsView.darkmode.test.tsx         # NEW (2 케이스 — option text/axis 색 분기)
```

### 4.2 useResolvedTheme hook

```tsx
// apps/web/src/features/theme/useResolvedTheme.ts
import { useEffect, useState } from 'react'

export type ResolvedTheme = 'light' | 'dark'

function read(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light'
  const html = document.documentElement
  if (html.classList.contains('dark')) return 'dark'
  if (html.getAttribute('data-theme') === 'dark') return 'dark'
  return 'light'
}

export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() => read())

  useEffect(() => {
    if (typeof document === 'undefined') return
    setTheme(read()) // sync mount
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    return () => obs.disconnect()
  }, [])

  return theme
}
```

### 4.3 EChartsView 패치

```tsx
import { useResolvedTheme } from '@/features/theme/useResolvedTheme'

// ... in component
const theme = useResolvedTheme()

// Inject theme-aware colours into the built option
const themedOption = useMemo(() => {
  const baseOption = buildOption(block, ...)
  const colors = theme === 'dark'
    ? { text: '#E5E7EB', axis: '#374151', split: '#1F2937', caption: '#9CA3AF', annDefault: '#9CA3AF' }
    : { text: '#1A1A1A', axis: '#E5E7EB', split: '#F3F4F6', caption: '#888',    annDefault: '#666'    }
  return mergeThemeColors(baseOption, colors)
}, [block, theme, ...])

// On theme change, dispose+init so ECharts picks up new defaults cleanly
useEffect(() => {
  if (!inst.current) return
  inst.current.dispose()
  inst.current = echarts.init(elRef.current!)
  inst.current.setOption(themedOption)
}, [theme])

// On normal option change (block update)
useEffect(() => {
  inst.current?.setOption(themedOption, true)
}, [themedOption])

// figure className
<figure className="rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
```

`mergeThemeColors(option, colors)` 헬퍼는 option 의 textStyle.color, xAxis/yAxis.axisLine/axisLabel/splitLine 색, tooltip text 색 등을 colors 값으로 덮어쓰는 *순수* 함수 — 단위 테스트로 검증.

### 4.4 ChartBlock 패치

```tsx
import { useResolvedTheme } from '@/features/theme/useResolvedTheme'

// ... in component
const theme = useResolvedTheme()
const gridStroke = theme === 'dark' ? '#374151' : '#E5E7EB'

// figure className
<figure className="rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">

// CartesianGrid (4곳)
<CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
```

### 4.5 tests

```tsx
// useResolvedTheme.test.tsx (4 cases)
// - default 'light' when no class/attr
// - 'dark' when document.documentElement.classList.contains('dark')
// - 'dark' when data-theme='dark'
// - observer updates state on class toggle

// EChartsView.darkmode.test.tsx (2 cases)
// - mergeThemeColors light → option.textStyle.color === '#1A1A1A'
// - mergeThemeColors dark → option.textStyle.color === '#E5E7EB'

// ChartBlock.darkmode.test.tsx (1 case)
// - SSR with html.classList containing 'dark' → CartesianGrid stroke='#374151'
//   (jsdom 회피: hook이 SSR에서 'light' 반환하므로 jsdom 환경 테스트 필요 — Decision: SSR 한정 ‘light’ branch만 검증, dark는 mergeThemeColors 단위 테스트로 충분)
```

---

## 5. References

- 직전 사이클: gantt-darkmode (토큰 매핑 사전 검증 패턴)
- ThemeProvider: `apps/web/src/features/theme/ThemeProvider.tsx`
- 대상: ChartBlock.tsx (213 LOC), EChartsView.tsx (859 LOC)

---

## 6. Open Questions

| # | 질문 | 결정 |
|---|---|---|
| Q1 | dispose+init 비용? | 한 chart당 ms 단위 — theme 토글은 사용자 의도적이라 OK |
| Q2 | mergeThemeColors 위치? | EChartsView 내부 helper (export하여 단위 테스트) |
| Q3 | recharts XAxis/YAxis text 색 토큰화? | 본 plan in-scope (위 4.4 디테일에 누락 — design 단계에서 확인) |
