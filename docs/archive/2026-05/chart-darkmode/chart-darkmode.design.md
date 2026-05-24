---
template: design
version: 1.0
feature: chart-darkmode
date: 2026-05-24
project: MX White Paper
---

# Chart Darkmode — Design Document

> **Planning Doc**: [chart-darkmode.plan.md](../../01-plan/features/chart-darkmode.plan.md)
> **Status**: Draft

---

## 0. Recap

Plan §4가 이미 구체적 — 본 문서는 보강:
- `mergeThemeColors` 헬퍼 정확한 시그니처
- recharts XAxis/YAxis text 색 (Q3) 처리
- buildOption 노출 변경 사항

---

## 1. 파일 영향 (Plan §4.1과 동일)

```
apps/web/src/features/theme/
├── useResolvedTheme.ts                       # NEW
└── __tests__/useResolvedTheme.test.tsx       # NEW

apps/web/src/components/blocks/
├── ChartBlock.tsx                            # EDIT
├── EChartsView.tsx                           # EDIT  (mergeThemeColors export)
└── __tests__/
    ├── ChartBlock.darkmode.test.tsx          # NEW
    └── EChartsView.darkmode.test.tsx         # NEW
```

---

## 2. useResolvedTheme hook

Plan §4.2 코드 그대로. 시그니처 변경 없음.

**SSR 동작**: `renderToStaticMarkup` 에서 `typeof document === 'undefined'` 일 수도 / 있을 수도 (jsdom-free 환경에서는 undefined). 안전 default = `'light'`.

---

## 3. mergeThemeColors 시그니처

```ts
// apps/web/src/components/blocks/EChartsView.tsx (exported)

export interface ThemeColors {
  text: string       // 일반 텍스트 (textStyle.color, tooltip.textStyle.color)
  axis: string       // axis line/tick (axisLine.lineStyle.color, axisTick.lineStyle.color)
  axisLabel: string  // axis tick label (axisLabel.color) — text와 동일 값 사용
  split: string      // split line (splitLine.lineStyle.color)
  caption: string    // tooltip caption sub-text (xy-line caption)
  annDefault: string // annotation default (when ann.color undefined)
}

export const THEME_COLORS_LIGHT: ThemeColors = {
  text: '#1A1A1A',
  axis: '#E5E7EB',
  axisLabel: '#1A1A1A',
  split: '#F3F4F6',
  caption: '#888888',
  annDefault: '#666666',
}

export const THEME_COLORS_DARK: ThemeColors = {
  text: '#E5E7EB',
  axis: '#374151',
  axisLabel: '#E5E7EB',
  split: '#1F2937',
  caption: '#9CA3AF',
  annDefault: '#9CA3AF',
}

/**
 * Returns a new option with text/axis/split colours injected. Pure — does
 * not mutate input. Idempotent (running twice yields the same result).
 */
export function mergeThemeColors(
  option: EChartsOption,
  c: ThemeColors,
): EChartsOption {
  const next: EChartsOption = { ...option }
  next.textStyle = { ...(option.textStyle ?? {}), color: c.text }
  const applyAxis = (axis: unknown) => {
    if (!axis) return undefined
    const a = axis as Record<string, unknown>
    return {
      ...a,
      axisLine: { ...(a.axisLine as object ?? {}), lineStyle: { ...((a.axisLine as { lineStyle?: object })?.lineStyle ?? {}), color: c.axis } },
      axisTick: { ...(a.axisTick as object ?? {}), lineStyle: { ...((a.axisTick as { lineStyle?: object })?.lineStyle ?? {}), color: c.axis } },
      axisLabel: { ...(a.axisLabel as object ?? {}), color: c.axisLabel },
      splitLine: { ...(a.splitLine as object ?? {}), lineStyle: { ...((a.splitLine as { lineStyle?: object })?.lineStyle ?? {}), color: c.split } },
    }
  }
  if (Array.isArray(option.xAxis)) {
    next.xAxis = option.xAxis.map(applyAxis) as typeof option.xAxis
  } else if (option.xAxis) {
    next.xAxis = applyAxis(option.xAxis) as typeof option.xAxis
  }
  if (Array.isArray(option.yAxis)) {
    next.yAxis = option.yAxis.map(applyAxis) as typeof option.yAxis
  } else if (option.yAxis) {
    next.yAxis = applyAxis(option.yAxis) as typeof option.yAxis
  }
  // tooltip text
  if (option.tooltip) {
    next.tooltip = { ...option.tooltip, textStyle: { ...(option.tooltip as { textStyle?: object }).textStyle ?? {}, color: c.text } }
  }
  return next
}
```

---

## 4. EChartsView 통합

기존 `buildOption(block, onPointClick, ...)` 가 raw option 반환 → 그 위에 `mergeThemeColors(rawOption, theme === 'dark' ? THEME_COLORS_DARK : THEME_COLORS_LIGHT)` 적용.

Annotation default 색 (현재 `ann.color ?? '#666'`) 도 ThemeColors의 `annDefault` 로 분기:

```diff
- const color = ann.color ?? '#666'
+ const color = ann.color ?? colors.annDefault
```

`buildOption` 시그니처에 `colors: ThemeColors` 추가. 또는 더 단순하게: buildOption은 그대로 두고, useMemo에서:

```tsx
const themedOption = useMemo(() => {
  const colors = theme === 'dark' ? THEME_COLORS_DARK : THEME_COLORS_LIGHT
  const raw = buildOption(block, onPointClickRef.current, colors)
  return mergeThemeColors(raw, colors)
}, [block, theme, ...])
```

buildOption 시그니처 `(block, onPointClick) → (block, onPointClick, colors)` 로 확장 — annotation default 만 colors 전달.

### 4.1 dispose+init 효과

ECharts theme 변경의 정석은 `init(el, theme)` 시점 결정. setOption만으로는 일부 default가 안 바뀜. 따라서:

```tsx
const themeChangedRef = useRef(theme)
useEffect(() => {
  if (themeChangedRef.current === theme) return
  themeChangedRef.current = theme
  if (!inst.current) return
  inst.current.dispose()
  inst.current = echarts.init(elRef.current!)
  inst.current.setOption(themedOption, true)
}, [theme, themedOption])
```

mount effect (init) 와 별개. 초기 mount 는 기존 useEffect 가 처리.

### 4.2 PNG export bg

```diff
  getPng() {
    if (!inst.current) return null
-   return inst.current.getDataURL({ type: 'png', backgroundColor: '#fff' })
+   return inst.current.getDataURL({ type: 'png', backgroundColor: theme === 'dark' ? '#111827' : '#fff' })
  }
```

`getPng()` 가 메서드 — theme를 ref로 보관 (useImperativeHandle 안에서 closure):

```tsx
const themeRef = useRef(theme)
themeRef.current = theme
useImperativeHandle(ref, () => ({
  getPng() {
    return inst.current?.getDataURL({
      type: 'png',
      backgroundColor: themeRef.current === 'dark' ? '#111827' : '#fff',
    }) ?? null
  },
}))
```

### 4.3 figure className

```diff
- <figure className="rounded border border-gray-200 bg-white p-3">
+ <figure className="rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
```

---

## 5. ChartBlock 통합 (recharts)

```tsx
import { useResolvedTheme } from '@/features/theme/useResolvedTheme'

const theme = useResolvedTheme()
const c = theme === 'dark'
  ? { grid: '#374151', axis: '#E5E7EB' }
  : { grid: '#E5E7EB', axis: '#1A1A1A' }

// figure
<figure className="rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">

// 4개 CartesianGrid
<CartesianGrid strokeDasharray="3 3" stroke={c.grid} />

// XAxis / YAxis (Q3 — 추가)
<XAxis ... stroke={c.axis} tick={{ fill: c.axis }} />
<YAxis ... stroke={c.axis} tick={{ fill: c.axis }} />
```

기존 XAxis/YAxis 호출 모두 4곳 — props 추가. tooltip은 recharts default가 다크 mode css 자동 안 됨이지만 흰 박스 + 검정 텍스트라 다크에서도 가독성 보통 (개선 ROI 낮음 — out-of-scope).

---

## 6. 테스트

| 파일 | 케이스 |
|---|---|
| `useResolvedTheme.test.tsx` | 4 — default 'light' / class 'dark' / data-theme 'dark' / MutationObserver 갱신 |
| `EChartsView.darkmode.test.tsx` | 2 — `mergeThemeColors(option, LIGHT).textStyle.color === '#1A1A1A'`, `mergeThemeColors(option, DARK).textStyle.color === '#E5E7EB'` |
| `ChartBlock.darkmode.test.tsx` | 1 — SSR (light default) → CartesianGrid stroke='#E5E7EB' |

Total 7 케이스.

---

## 7. 회귀 위험

| 위험 | 대응 |
|---|---|
| AllBlocksRender chart snapshot 깨짐 | `-u` 갱신 (light 색은 동일하지만 figure className에 dark: 변형 추가됨) |
| EChartsView 기존 buildOption 단위 테스트 (option.test.ts) | `buildOption(block, onPointClick)` → `(block, onPointClick, colors)` 시그니처 확장 — 기본값 (`= THEME_COLORS_LIGHT`) 제공으로 기존 호출자 영향 0 |
| dispose+init 가 zoom 상태 reset | theme 변화는 사용자 의도적 — OK |
| recharts SSR (renderToStaticMarkup) 에서 hook 'light' 반환 → 기존 테스트 그대로 통과 | 회귀 0 |

---

## 8. 작업 순서 (Do)

1. `useResolvedTheme.ts` 신설 + 단위 테스트 4 (jsdom 환경)
2. `EChartsView.tsx` — `THEME_COLORS_*` + `mergeThemeColors` export + theme 분기 + dispose+init + figure className
3. `EChartsView.darkmode.test.tsx` — mergeThemeColors 2 케이스
4. `EChartsView.option.test.ts` (기존) — buildOption signature 변경 호환 확인 (default 인자라 영향 0 예상)
5. `ChartBlock.tsx` — useResolvedTheme + CartesianGrid/XAxis/YAxis stroke 분기 + figure className
6. `ChartBlock.darkmode.test.tsx` — SSR light branch 1 케이스
7. `pnpm vitest run -u` — chart snapshot 갱신 (AllBlocksRender)
8. `pnpm typecheck + vitest run + API pytest`
9. lat `charts.md` + `documents.md` 갱신
10. 단일 커밋 — `feat(chart): darkmode — useResolvedTheme hook + ECharts dispose+init + recharts 토큰화`

---

## 9. Open Items

| # | 항목 | 결정 |
|---|---|---|
| O1 | jsdom 환경 추가 비용? | vitest config 확인 — 이미 일부 테스트가 사용. 추가 cost 0 |
| O2 | recharts tooltip 다크 미대응 | Out-of-scope (개선 ROI 낮음, 별도 사이클 후보) |
