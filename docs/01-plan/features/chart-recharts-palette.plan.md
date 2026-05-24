# Chart Recharts Palette — Planning Document

> **Summary**: chart-dark-palette 사이클의 EChartsView 패턴을 ChartBlock
> (recharts) 에도 적용. 8색 PALETTE_DARK brighter variant + getRechartsPalette()
> 헬퍼. 인덱스 일관성 유지.
>
> **Date**: 2026-05-24

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | chart-dark-palette 사이클이 EChartsView (xy-line/echarts) 만 처리. ChartBlock (recharts — line/bar/area/pie/radar/scatter, 기본 차트 엔진) 의 PALETTE 8색은 여전히 light 고정 → 다크에서 시리즈 색 가독성 ↓. |
| **Solution** | chart-dark-palette 패턴 그대로 — PALETTE_DARK 8색 brighter variant + `getRechartsPalette(theme)` export 헬퍼. renderChart 시그니처에 palette 인자 추가. 8 호출처 일괄 `palette[...]` 로 변경. |
| **Function/UX Effect** | 다크에서 일반 차트 (line/bar/area 등) 시리즈 색이 brighter blue/emerald 등으로 자동 전환. 인덱스 일관성 유지 (i=0 always blue family). |
| **Core Value** | "chart 양 엔진 (recharts + echarts) 다크 팔레트 일관" — chart-dark-palette 사이클의 미해결 디테일 닫음. |

## Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | PALETTE_DARK 위치 | ChartBlock.tsx PALETTE 옆 (EChartsView와 별도 — 색 미세 다름 idx 5/6) |
| 2 | EChartsView와 통합? | No — 각 엔진의 own palette 유지가 더 명확 (의도된 미세 차이) |
| 3 | 헬퍼 이름 | `getRechartsPalette` (EChartsView의 `getPalette` 와 구분) |
| 4 | renderChart 시그니처 | palette 인자 추가 (마지막) |
| 5 | 호출처 | 8곳 (line stroke, bar fill, area stroke+fill, pie cell, radar fill+stroke, scatter fill) |
| 6 | series.color override | 본 사이클 out-of-scope (현재 ChartBlock에 series.color override 자체 미지원) |
| 7 | 테스트 | getRechartsPalette light/dark 2 케이스 + figure title 다크 1 (기존) |

## AC

1. PALETTE_DARK 8색 + getRechartsPalette export
2. renderChart palette 인자
3. 8 호출처 변경
4. 회귀 0
5. 테스트 2 신설 (getRechartsPalette)
6. lat charts.md 갱신
7. 보고서 + archive

## Estimate

| 작업 | 시간 |
|---|---|
| PALETTE_DARK + 헬퍼 + 8 호출처 + renderChart 시그니처 | 15분 |
| 테스트 2 + typecheck + vitest | 10분 |
| lat 갱신 + commit + archive | 10분 |
| **합계** | **~35분** |
