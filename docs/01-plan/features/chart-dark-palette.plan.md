# Chart Dark Palette — Planning Document

> **Summary**: ECharts 시리즈 8 색 (smsg-blue-700/500 + 6 brand)을 dark에서
> brighter variant 로 자동 전환. 인덱스 일관성 유지 (blue series 가 다크에서도
> blue 계열). chart-darkmode 사이클의 "데이터 색은 의미 — 미변경" 결정을 *옵션*
> 으로 전환 — 인덱스 매핑 유지로 의미 보존 + 다크에서 가독성 ↑.
>
> **Date**: 2026-05-24

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | chart-darkmode 사이클은 시리즈 팔레트 미변경 결정 (데이터 색은 의미). 하지만 첫 색 `#1428A0` (smsg-blue-700) 가 다크 #111827 surface 위에서 대비 부족 → 막대 안 보임. |
| **Solution** | PALETTE_DARK 8색 변형 신설 — 인덱스 일관성 유지 (i=0 light blue-700 → dark brighter blue, i=1 light blue-500 → dark even brighter, ...). useResolvedTheme로 자동 전환. 사용자 옵션 토글 없음 (자동이 정직 — 다크에선 무조건 dark palette). |
| **Function/UX Effect** | 다크 테마 차트의 시리즈 막대/선이 어두운 배경에서 명확히 보임. 인덱스 매핑 유지로 "blue line = sales" 같은 의미 mapping 손상 X. |
| **Core Value** | "데이터 색 의미 보존 + 다크 가독성 둘 다" — chart-darkmode 사이클의 미해결 디테일 닫기. |

---

## 1. Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | PALETTE_DARK 위치 | EChartsView.tsx — PALETTE 옆 |
| 2 | 색 선택 방법 | 각 light hex를 brighter variant로 매핑 — tokens.css `.dark` 의 blue scale 참조: `#1428A0`→`#93A5FF` (light blue-700 dark), `#2E5BFF`→`#6E8BFF`, 나머지 6 brand는 +20% lightness 직접 계산 (Tailwind 표준 _emerald-400/_amber-400 등 매핑) |
| 3 | 매핑 표 | `#1428A0→#93A5FF`, `#2E5BFF→#6E8BFF`, `#10B981→#34D399`, `#F59E0B→#FBBF24`, `#DC2626→#F87171`, `#8B5CF6→#A78BFA`, `#0EA5E9→#38BDF8`, `#EC4899→#F472B6` |
| 4 | 적용 위치 | EChartsView 내 4곳 (`PALETTE[i % PALETTE.length]` 사용처) — `getPalette(theme)` 헬퍼로 추상화 |
| 5 | 사용자 옵션 | 없음 — 자동만 (yagni). 향후 사용자가 light palette 강제 원하면 별도 옵션 |
| 6 | series.color override | 사용자가 명시한 series.color 는 그대로 사용 (theme 무관) |
| 7 | 테스트 | mergeThemeColors 같은 단위 테스트 패턴 — getPalette('light')/[0]==='#1428A0', getPalette('dark')[0]==='#93A5FF' |
| 8 | matchRate | 90% |

---

## 2. Acceptance Criteria

1. **C1**: PALETTE_DARK 8색 + getPalette 헬퍼 export
2. **C2**: EChartsView 4곳 `PALETTE[...]` → `getPalette(theme)[...]`
3. **C3**: 다크에서 시리즈 색이 brighter variant
4. **C4**: 인덱스 일관성 (i=0 항상 blue 계열)
5. **C5**: series.color override 우선
6. **C6**: 회귀 0
7. **C7**: 단위 테스트 2 (getPalette light/dark)
8. **C8**: lat charts.md 갱신
9. **C9**: 사이클 보고서 + archive

---

## 3. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| PALETTE_DARK + getPalette + 4 호출처 변경 | ~30 | 15분 |
| 단위 테스트 2 | ~20 | 10분 |
| typecheck + vitest | — | 5분 |
| lat 갱신 + commit + archive | ~5 | 10분 |
| **합계** | **~55** | **~40분** |
