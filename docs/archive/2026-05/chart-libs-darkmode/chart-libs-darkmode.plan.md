# Chart Libs Darkmode — Planning Document

> **Summary**: chart-darkmode 사이클의 미해결 2건 처리 — (A) FlowBlock mermaid
> theme 다크 + (B) recharts Tooltip contentStyle 다크.
>
> **Project**: MX White Paper
> **Date**: 2026-05-24

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | (A) FlowBlock mermaid 다이어그램은 `theme:'default'` (밝은 배경) 고정 → 다크 본문 안 흰 다이어그램. (B) recharts Tooltip은 default 흰 박스 + 검정 텍스트 → 다크에서 가독성 0. chart-darkmode가 표면만 처리하고 두 라이브러리 내부는 남겨둠. |
| **Solution** | (A) useResolvedTheme + mermaid `initialize({theme: dark ? 'dark' : 'default'})` 재실행 + render 재실행. (B) tooltipProps에 contentStyle 추가 (theme 분기 background/border/color). useResolvedTheme 인프라 그대로 재사용. |
| **Function/UX Effect** | 다크 테마에서 mermaid 다이어그램이 어두운 배경 + 밝은 노드, recharts Tooltip이 어두운 박스 + 밝은 텍스트로 자연 inversion. theme 토글 시 자동 재렌더. |
| **Core Value** | "chart 라이브러리 다크 완성" — useResolvedTheme 패턴 4번째 적용 (chart/orgchart는 SVG, mermaid/recharts tooltip은 라이브러리 내부). 패턴 안정성 추가 검증. |

---

## 1. Overview

### 1.1 갭 (2건)

| # | 갭 | 작업량 |
|---|---|---|
| A1 | FlowBlock mermaid theme dark + 재초기화 | ~30 LOC |
| B1 | ChartBlock recharts Tooltip contentStyle 분기 | ~15 LOC |

### 1.2 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | mermaid theme 매핑 | `default` (light) / `dark` (built-in). 'forest'/'neutral' 등은 미사용 (디자인 시스템과 색 충돌 위험) |
| 2 | mermaid 재초기화 | mermaidPromise 캐시는 유지 (모듈 import는 1회), 매 render마다 initialize 재호출. `idRef.current` 도 theme 변경 시 새로 생성 (mermaid가 같은 id 재사용 시 캐시 문제) |
| 3 | recharts tooltip contentStyle | `theme === 'dark' ? { background: '#111827', border: '1px solid #374151', color: '#E5E7EB' } : { background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#1A1A1A' }` |
| 4 | recharts itemStyle (series 값 색) | `color`만 theme 따라 분기 (배경은 contentStyle 처리) |
| 5 | useResolvedTheme 위치 | 이미 import됨 (chart-darkmode 사이클). 추가 작업 없음 |
| 6 | mermaid 재렌더 useEffect 의존성 | `[block.source, theme]` |
| 7 | tests | mermaid: 직접 검증 어려움 (jsdom 미사용 + mermaid가 dynamic import) → manual 시각 확인만. recharts: tooltipProps 가 theme에 따라 분기되는지 단위 1 |
| 8 | matchRate 기준 | 90% |

### 1.3 Acceptance Criteria

1. **C1**: FlowBlock mermaid가 theme 변경 시 재초기화 + 재렌더
2. **C2**: ChartBlock recharts Tooltip이 다크에서 어두운 박스
3. **C3**: 회귀 0 (vitest/typecheck)
4. **C4**: 신규 테스트 1 (recharts tooltipProps 분기)
5. **C5**: lat charts.md 갱신
6. **C6**: 사이클 보고서 + archive

---

## 2. 작업 순서

1. FlowBlock.tsx — useResolvedTheme + initialize 재실행 + render 재실행
2. ChartBlock.tsx — tooltipProps에 contentStyle/itemStyle 분기 추가
3. 단위 테스트 — recharts tooltip 분기 1
4. typecheck + vitest 전체
5. lat charts.md 갱신
6. 단일 commit + archive

---

## 3. Risks

| 위험 | 대응 |
|---|---|
| mermaid initialize() 재호출이 다른 mermaid 인스턴스에 영향 (singleton) | mermaid는 process-wide singleton — 전체 앱 일관성. 사용자 토글 시 모든 mermaid가 같이 바뀜 = OK |
| mermaid render id 중복 시 캐시 문제 | idRef.current를 theme 변경 시 갱신 (`Math.random()` 재생성) |
| recharts contentStyle override 가 일부 차트 타입에서 무시 | 확인 — 모든 chart type 공통 tooltip props 통과 |

---

## 4. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| FlowBlock theme + 재렌더 | ~25 | 20분 |
| ChartBlock tooltipProps 분기 | ~15 | 10분 |
| 단위 테스트 1 | ~25 | 10분 |
| typecheck + vitest | — | 5분 |
| lat 1줄 | ~3 | 3분 |
| commit + archive | — | 5분 |
| **합계** | **~70** | **~55분** |
