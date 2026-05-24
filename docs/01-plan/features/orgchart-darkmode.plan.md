# OrgChart Darkmode — Planning Document

> **Summary**: OrgChartBlock SVG 7 hex + figure/empty className 토큰화. mermaid 아닌
> 순수 SVG라 gantt-darkmode 패턴 그대로 (SVG `fill="var(--smsg-...)"`). 새 토큰 신설 X.
>
> **Project**: MX White Paper
> **Feature**: orgchart-darkmode
> **Date**: 2026-05-24
> **Previous**: chart-darkmode (`docs/archive/2026-05/chart-darkmode/`)

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | OrgChartBlock 다크 미대응. SVG 7 hex + figure 흰 박스. chart-darkmode/gantt-darkmode와 동일 결손. mermaid 컴포넌트가 아니라 **순수 SVG** 라 gantt-darkmode 패턴 그대로 적용 가능 (useResolvedTheme 불요). |
| **Solution** | 7 hex → `var(--smsg-...)` 토큰화. figure className에 Tailwind `dark:` 변형. empty state도 동일. 새 토큰 신설 X — slate scale을 smsg-gray scale로 매핑 (시각 거의 동일). |
| **Function/UX Effect** | 다크 테마에서 조직도 노드 어두운 surface + 밝은 텍스트, edge/border 적절한 dark gray, hover active 도 brighter blue. 라이트 회귀 0 (토큰 light값과 기존 hex 거의 동일). |
| **Core Value** | "OrgChart 다크 일관" + SVG 블록 darkmode 패턴 재검증 (3번째 적용 — gantt-zebra → gantt-darkmode → orgchart). 패턴 안정성 확인. |

---

## 1. Overview

### 1.1 Purpose

OrgChartBlock 다크 미대응 결손 해소. chart-darkmode report next-cycle 후보 #1.

### 1.2 갭 (1건)

| # | 갭 | 작업량 |
|---|---|---|
| O1 | OrgChartBlock SVG 7 hex + figure/empty className 토큰화 | ~30 LOC + 시각 검증 |

### 1.3 Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | 색 매핑 | `#1428A0` → `var(--smsg-blue-700)` (active edge/border), `#CBD5E1` → `var(--smsg-gray-300)` (inactive edge — light=#D1D5DB ≈), `#E8EFFF` → `var(--smsg-blue-100)` (active node fill — light=#E8EEFF ≈), `#FFFFFF` → `var(--smsg-surface)` (node fill), `#94A3B8` → `var(--smsg-gray-500)` (inactive border — light=#6B7280 vs slate-400), `#0F172A` → `var(--smsg-gray-900)` (label text — light=#1A1A1A vs slate-900), `#475569` → `var(--smsg-gray-700)` (role text — light=#374151 vs slate-600) |
| 2 | slate vs gray 차이 | 시각적 거의 동일 (4 단위 hex 이내). 별도 slate 토큰 신설은 yagni — gray 사용 |
| 3 | figure | `bg-white border-gray-200` → `bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700` |
| 4 | 빈 상태 div | `bg-gray-50 border-gray-300 text-gray-500` → `dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400` 추가 |
| 5 | 테스트 | view 회귀 1 (토큰 등장 검증) + 빈 상태 dark className 검증 = 2 케이스. snapshot 1 update |
| 6 | matchRate 기준 | 90% |
| 7 | lat 갱신 | `docs/lat/documents.md` OrgChartBlock 항목 (없으면 추가) — darkmode 한 줄 |

### 1.4 Acceptance Criteria

1. **C1**: SVG 7 hex 모두 `var(--smsg-...)` 교체
2. **C2**: figure dark className 변형
3. **C3**: 빈 상태 div dark className 변형
4. **C4**: 라이트 시각 회귀 0 (토큰 light값 ≈ 기존 hex)
5. **C5**: 다크에서 surface/text/edge 자연스럽게 inversion
6. **C6**: 회귀 0 (vitest, typecheck)
7. **C7**: 테스트 2건 + snapshot 1 update
8. **C8**: lat 갱신
9. **C9**: 사이클 보고서 + archive

---

## 2. Estimate

| 작업 | LOC | 시간 |
|---|---|---|
| OrgChartBlock.tsx — 7 SVG fill/stroke + 2 className | ~25 | 15분 |
| 테스트 2 + snapshot 갱신 | ~30 | 15분 |
| typecheck + vitest | — | 5분 |
| lat 갱신 | ~5 | 3분 |
| 단일 커밋 | — | 2분 |
| **합계** | **~60** | **~40분** |

---

## 3. Risks

| 위험 | 대응 |
|---|---|
| slate→gray 차이로 라이트 픽셀 변화 | hex 차이 최대 4 단위 — 시각 인지 X. snapshot 갱신으로 흡수 |
| node active fill `#E8EFFF` vs `#E8EEFF` (smsg-blue-100) | 1단위 차이 — 무시 |
| edge active stroke `#1428A0` = smsg-blue-700 정확 일치 | 변화 0 |
| 다크에서 active node fill (`--smsg-blue-100` dark = `#1F2A55`) 가 surface (`#111827`) 와 명확 구분되는지 | hex 비교 — `#1F2A55` 가 더 밝음, 식별 OK |

---

## 4. Open Questions

| # | 질문 | 결정 |
|---|---|---|
| Q1 | slate 토큰 별도 신설? | **No** — gray로 통일 (yagni) |
| Q2 | 다른 SVG 블록 같이 묶기? | **No** — S(audit) 사이클이 별도 |
| Q3 | mermaid theme 같이 처리? | **No** — OrgChart는 mermaid 아님 (순수 SVG). flow/diagram 블록이 mermaid 사용 (별도) |
