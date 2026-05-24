# Whiteboard Darkmode Decision — Planning Document

> **Summary**: Whiteboard 사용자 그림 색을 다크에서 어떻게 처리할지 *최종 결정
> 사이클*. 결정 = "현재 유지 + lat 명시화". 코드 변경 0.
>
> **Date**: 2026-05-24

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | Whiteboard 는 사용자가 직접 색을 입력 (`el.color`, `el.stroke`) + 캔버스 `bg-white` 영구. 다크 모드에서 *흰 캔버스 + 사용자 진한 색* 그대로 → 다크 본문 안 광원처럼 떠 있음. svg-block-audit는 의도 예외로 분류, block-darkmode-batch는 allow-list. UX 결정이 미정 상태. |
| **Solution** | 3 옵션 검토: (1) 현재 유지, (2) escape hatch `darkBehavior?` 옵션, (3) 자동 inversion. **결정: (1) 현재 유지**. Figma/Excalidraw 관례 + 사용자 그린 의도 보존 우선. 사용자 명시 요청 없으므로 yagni. lat에 *의도 + 검토 결과* 명시 — 향후 무지로 인한 재논의 방지. |
| **Function/UX Effect** | 사용자 체감 변화 0. lat가 "왜 whiteboard만 다르게 동작하나" 의문 즉답. 향후 사용자 요청 시 (2) escape hatch 추가 패턴 lat에 명시화. |
| **Core Value** | "UX 결정을 *결정으로 명시*" — 침묵의 의도 ↗ 명시적 의도. svg-block-audit 4가지 SVG 패턴 (tokenization/currentColor/user-driven/intentional hardcode) 의 "user-driven" 카테고리 강화. |

---

## 1. Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | UX 정책 | (1) **현재 유지** — Figma/Excalidraw 관례, painter 도구는 사용자 색 책임 |
| 2 | escape hatch | 미요청 시 미구현 — 사용자가 명시 요청 시 `options.darkBehavior?: 'invert'` 패턴 도입 |
| 3 | 코드 변경 | **0건** (의도 명시 사이클) |
| 4 | lat 갱신 | WhiteboardBlock entry 신설 + 결정 사유 명시 |
| 5 | matchRate | 90% |

---

## 2. Acceptance Criteria

1. **C1**: lat documents.md 의 WhiteboardBlock entry 신설 — 의도 + 결정 사유 + escape hatch 후보
2. **C2**: 회귀 0 (코드 무변경)
3. **C3**: 사이클 보고서 + archive

---

## 3. Risks

| 위험 | 대응 |
|---|---|
| 사용자가 다크에서 흰 캔버스 불편 호소 | 의도 (Figma 관례) 설명 + escape hatch 후보 안내 |
| 향후 누군가가 lat 모르고 다크 변형 추가 | lat에 *유지 결정 명시* + svg-block-audit allow-list로 회귀 가드도 차단 |

---

## 4. Estimate

| 작업 | 시간 |
|---|---|
| lat 1 entry 갱신 (완료) | 5분 |
| plan/analysis/report 작성 | 15분 |
| commit + archive | 5분 |
| **합계** | **~25분** |
