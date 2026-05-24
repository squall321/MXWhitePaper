# Gantt Darkmode — Planning Document

> **Summary**: GanttBlock SVG 의 하드코딩 hex 5개 + figure 배경 2개를
> `var(--smsg-...)` 토큰으로 교체. tokens.css 의 `.dark` 변형이 자동 적용 →
> 다크 모드 자동 대응. 새 토큰 신설 X, schema 변경 X.
>
> **Project**: MX White Paper
> **Feature**: gantt-darkmode
> **Version**: 0.1.0
> **Date**: 2026-05-24
> **Status**: Draft
> **Previous**: gantt-zebra (`docs/archive/2026-05/gantt-zebra/`) — next-cycle 후보 #1

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | Gantt 차트가 다크 모드에서 깨진다. SVG 5색 (`#F9FAFB`, `#E5E7EB`, `#1A1A1A`, `#2E5BFF`, `#1428A0`) + figure (`bg-white border-gray-200`) 가 모두 하드코딩이라 다크 테마에서도 강제 라이트 컬러로 렌더 → 다크 본문 안 흰 박스가 떠 있고 회색 막대명이 흰 막대 위에 표시되어 가독성 0. |
| **Solution** | 토큰화 — `var(--smsg-gray-050/200/900)` + `var(--smsg-blue-500/700)` 로 교체. `tokens.css` 의 `.dark` 변형이 이미 모든 토큰을 정의했으므로 추가 토큰 신설 불요. figure는 Tailwind arbitrary value (`bg-[var(--smsg-surface)]`). schema/options 무변경. |
| **Function/UX Effect** | 다크 테마에서 Gantt 가 어두운 패널 + 밝은 텍스트 + 다크-환경용 brighter blue 막대로 자연스럽게 렌더. zebra rect 도 다크 토큰으로 자동 — 회색 행이 light 모드에선 `#F9FAFB`, dark 모드에선 `#111827`. AA 대비 보장 (tokens.css 주석에 명시). |
| **Core Value** | "Gantt가 다른 모든 위젯과 동일하게 다크 대응" — 위젯 전반의 다크 일관성 1단계 완성. 향후 ChartBlock/OrgChartBlock 도 같은 패턴으로 1줄씩 토큰화 가능 (별도 사이클). |

---

## 1. Overview

### 1.1 Purpose

GanttBlock 다크 모드 미지원 결손 해소. gantt-zebra 사이클 보고서가
next-cycle 후보 #1로 명시.

### 1.2 본 사이클 처리 갭 (1건 — Gantt 한정)

| # | 갭 | 출처 | 작업량 |
|---|---|---|---|
| D1 | GanttBlock SVG hex + figure className 토큰화 | gantt-zebra report next-cycle #1 | ~30 LOC + 시각 검증 |

### 1.3 본 사이클 *제외* (근거)

| 항목 | 사유 |
|---|---|
| ChartBlock 다크 모드 | recharts/echarts 자체 darkMode 옵션이 있음 — 별도 사이클로 echarts theme 통합 |
| OrgChartBlock 다크 모드 | mermaid 의 theme 옵션 — 별도 |
| 새 다크 토큰 신설 | tokens.css에 이미 모든 필요 토큰 존재 — yagni |
| 다크 모드 토글 UI | ThemeProvider 가 이미 존재 (lat 외부) — 본 사이클은 *반영* 만 |
| 다크 모드 default | 현재 light default — 사용자 선택에 영향 안 줌 |

### 1.4 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | 작업 방식 | 직접 순차 (단일 컴포넌트 ~30 LOC). 에이전트 안 씀 |
| 2 | 색 매핑 | `#F9FAFB` → `var(--smsg-gray-050)` (zebra row), `#E5E7EB` → `var(--smsg-gray-200)` (axis), `#1A1A1A` → `var(--smsg-gray-900)` (text), `#2E5BFF` → `var(--smsg-blue-500)` (bar), `#1428A0` → `var(--smsg-blue-700)` (progress) |
| 3 | figure 배경 | `bg-white border-gray-200` → `bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700` (검증된 패턴 — `RestrictedBlockPlaceholder.tsx` 와 일관). arbitrary `bg-[var(--smsg-surface)]` 보다 안전 (Tailwind purge 위험 없음) |
| 4 | gantt-zebra 의 인라인 hex 처리 | `fill="#F9FAFB"` → `fill="var(--smsg-gray-050)"`. **gantt-zebra 사이클의 `STRIPE_CLASSES['gantt']` dummy entry 주석에 적힌 "인라인 fill" 도 같이 토큰화** — 일관성 |
| 5 | 다크 색 검증 | tokens.css 의 `.dark` 변형: blue-500=#6E8BFF (AA on dark 4.5:1 보장 — 주석 명시), gray-050=#111827 (deepest panel — figure surface와 명확히 구분), gray-200=#374151 (axis가 너무 흐리지 않게 brighter than gray-100) |
| 6 | 테스트 전략 | view 회귀 1 — `fill="var(--smsg-blue-500)"` 같은 토큰 참조 형태가 SVG에 등장하는지 검증. 다크 실제 색은 CSS 변수라 unit test 불가 (브라우저에서만 resolve). 시각 회귀는 manual 또는 향후 visual regression |
| 7 | matchRate 기준 | 90% |
| 8 | lat 갱신 | `docs/lat/documents.md` 의 GanttBlock entry 한 줄에 "다크모드 토큰화" 명시. zebra Gotcha #10 의 inline `#F9FAFB` 언급도 `var(--smsg-gray-050)` 으로 update |
| 9 | LLM rules 갱신 | gantt 섹션 영향 없음 — 색은 LLM 입력과 무관 (서버가 schema 검증만) |
| 10 | snapshot 회귀 | AllBlocksRender gantt snapshot 갱신 필요 (hex → var 변경). 1 snapshot update. |

### 1.5 Acceptance Criteria

1. **C1**: GanttBlock SVG의 5개 hex 가 모두 `var(--smsg-...)` 토큰으로 교체됨
2. **C2**: figure 배경/테두리가 토큰 (`--smsg-surface`/`--smsg-border`)으로 교체됨
3. **C3**: 라이트 모드에서 시각 변화 0 (토큰 light 값이 기존 hex와 동일)
4. **C4**: 다크 모드에서 figure가 어두운 surface, 텍스트가 밝음, 막대가 brighter blue, zebra가 어두운 패널로 자동 렌더
5. **C5**: 회귀 0 (web vitest, api pytest, typecheck 모두 통과)
6. **C6**: 시각 회귀 테스트 1 (SVG token 참조 등장 검증)
7. **C7**: AllBlocksRender snapshot 1 update (light 색은 동일하지만 markup이 var 로 바뀜)
8. **C8**: lat documents.md 의 GanttBlock entry 갱신
9. **C9**: 사이클 보고서 (analysis + report) 작성 후 archive

---

## 2. Scope & Out-of-scope

### 2.1 In-scope

- GanttBlock.tsx SVG 5 hex + figure className 토큰화
- view 회귀 테스트 1건
- AllBlocksRender snapshot 갱신
- lat documents.md 1줄 갱신

### 2.2 Out-of-scope

- ChartBlock/OrgChartBlock 다크 (별도)
- 새 토큰 신설 (yagni)
- 다크 모드 토글/저장 UX (이미 존재)
- 시각 회귀 자동화 (visual regression) — 향후 인프라 사이클

---

## 3. Risks & Mitigations

| 위험 | 영향 | 대응 |
|---|---|---|
| Tailwind arbitrary value `bg-[var(--smsg-surface)]` 가 JIT 모드에서 purge 됨 | 다크에서 배경 사라짐 | 이미 다른 컴포넌트 (ZebraToggle 등) 가 같은 패턴 사용 중 — JIT가 인식. zebra-striping-extended 사이클에서 검증됨 |
| `.dark` class root vs `data-theme=dark` 우선순위 | 일부 환경에서 다크 미적용 | tokens.css의 selector `:root.dark, [data-theme='dark']` 가 둘 다 커버 |
| AllBlocksRender snapshot 단일 갱신이 다른 hex-기반 시각 회귀 숨김 | 시각 버그 미검출 | 본 사이클은 *토큰화만* — hex 값과 var 값이 light 모드에서 동일하므로 회귀 0 (단위 테스트는 CSS 변수 미해석, 시각만 영향) |
| SVG `fill="var(...)"` 가 일부 SVG-to-PNG 변환에서 미지원 (echarts getPng 류) | export 깨짐 | Gantt는 PNG export 없음 (lat 확인). 영향 없음 |
| zebra-striping-extended 사이클의 `STRIPE_CLASSES['gantt']` 주석이 inline `#F9FAFB` 언급 — 주석 outdated | 문서 drift | 본 사이클에서 zebra.ts 주석도 같이 갱신 (`var(--smsg-gray-050)` 로) |

---

## 4. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| GanttBlock.tsx — 5 SVG hex 교체 | ~5 | 5분 |
| GanttBlock.tsx — figure className 교체 | ~1 | 2분 |
| zebra.ts 주석 갱신 (#F9FAFB → var) | ~2 | 2분 |
| view 회귀 테스트 1 | ~20 | 15분 |
| `pnpm vitest run -u` snapshot 갱신 | — | 5분 |
| 다크 모드 시각 확인 (브라우저) | — | 15분 |
| typecheck + 전체 vitest + API pytest | — | 10분 |
| lat documents.md 한 줄 갱신 | ~3 | 3분 |
| **합계** | **~30** | **~1시간** |

---

## 5. Plan → Design 핸드오프

design 단계에서 추가 결정 필요:

1. **Tailwind arbitrary value 검증** — 빌드 후 `bg-[var(--smsg-surface)]` 가 JIT purge 안 되는지 사전 확인 (다른 컴포넌트 grep로 동일 패턴 검증)
2. **figure border 두께/색 조합** — dark에서 border가 거의 안 보일 수도 (border-gray-200 → 다크 #374151). 더 진한 색 (`--smsg-gray-300` = #4B5563) 이 필요한지 design 단계에서 시각 확인
3. **gantt zebra rect의 `data-gantt-zebra-row` attribute** 는 그대로 유지 — 테스트가 의존

---

## 6. References

- 직전 사이클: `docs/archive/2026-05/gantt-zebra/gantt-zebra.report.md`
- 대상: `apps/web/src/components/blocks/GanttBlock.tsx` (78 LOC)
- 토큰: `apps/web/src/styles/tokens.css` (라인 92-125 다크 변형)
- 토큰 매핑 (라이트):
  - `#F9FAFB` = `--smsg-gray-050`
  - `#E5E7EB` = `--smsg-gray-200`
  - `#1A1A1A` = `--smsg-gray-900` (= `--smsg-text`)
  - `#2E5BFF` = `--smsg-blue-500`
  - `#1428A0` = `--smsg-blue-700`

---

## 7. Open Questions

| # | 질문 | 결정 |
|---|---|---|
| Q1 | figure border 색? | **`border-gray-200 dark:border-gray-700`** — Tailwind dark 변형, 검증된 패턴 (`RestrictedBlockPlaceholder.tsx`) 그대로 |
| Q2 | SVG text fontSize 토큰화? | **No** — 색만 토큰화. yagni |
| Q3 | OrgChart/Chart 같이 묶기? | **No** — Gantt 한정 (chart는 recharts/echarts theme 별도, OrgChart는 mermaid theme 별도) |
