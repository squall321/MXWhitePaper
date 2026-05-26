# Presentation Chapter Hero — Planning Document

> **Summary**: 사용자 "별로 안 바뀐 거 같다" 피드백 → 이전 사이클들은 *내부 구조*
> 개선이라 시각적 체감 적음. *눈에 띄는 디자인 변화* 로 chapter divider hero
> 스타일 도입. 거대한 챕터 번호 + gradient + 보더로 챕터 전환 임팩트.
>
> **Date**: 2026-05-25

---

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | presentation-layout + followups 사이클이 7→4 슬라이드 / iframe placeholder / visual baseline 등 *내부 구조* 다 정비했지만 사용자 체감 "별로 안 바뀐 것 같다". 정직한 평가: 콘텐츠 자체 디자인은 거의 동일 — max-width 1200→1440, padding 약간만 변경. 슬라이드 수 줄어든 *흐름* 변화는 발표 끝까지 가야 보임. 챕터 전환 임팩트도 약함 ("2 팀 구성 & 외부 자료" 일반 슬라이드와 시각 차이 X). |
| **Solution** | level-1 section 의 *첫* 슬라이드 (`continuation === 0 또는 undefined`) 에 chapter-hero 스타일 추가. 슬라이드 좌상단 배경에 *거대한 챕터 번호* (semi-transparent gradient) + 헤더 글자는 그 위에 떠 있어 가독성 유지 + 하단 보더로 헤더-본문 분리. 슬라이드 갯수는 늘리지 않음 (4 그대로). |
| **Function/UX Effect** | 챕터 시작 슬라이드에서 *거대한 1, 2* 숫자가 좌상단 배경에 떠 있어 청자가 "새 챕터 시작" 을 즉시 인지. continuation 슬라이드 (2/3, 3/3 등) 는 hero 적용 X — 평범 헤더로 챕터 안 흐름 유지. level-2 subsection 슬라이드도 평범. |
| **Core Value** | "*눈에 띄는* 시각 변화" — 내부 구조 사이클들의 폴리시 위에 사용자 체감 가능한 디자인 임팩트. 발표 흐름 인지 부담 ↓. |

---

## 1. Decisions

| # | 항목 | 결정 |
|---|---|---|
| 1 | hero 적용 조건 | `!isContinuation && slide.level === 1` — level-1 첫 슬라이드만. continuation / level-2 subsection 평범 |
| 2 | hero 시각 요소 | (a) 좌상단 거대 번호 absolute (chapter-bignum), (b) 헤더 하단 2px gradient border, (c) 헤더 h2 폰트 약간 큼 (44-64px) |
| 3 | 거대 번호 색 | light: gradient #6f87d6α20 → #1428a0α08, dark: #93a5ffα28 → #6f87d6α08 |
| 4 | 거대 번호 위치 | `position: absolute; left: -16px; top: -32px` — 좌상단 살짝 잠식. pointer-events 없음 |
| 5 | 거대 번호 폰트 | JetBrains Mono 900, clamp(120, 14vw, 220), letter-spacing -0.04em |
| 6 | z-index | 거대 번호 z-0, 헤더 글자 z-1 |
| 7 | 보더 | `border-bottom: 2px solid rgba(111, 135, 214, 0.25)` — chapter 헤더와 본문 시각 구분 |
| 8 | matchRate | 90% |

---

## 2. AC

1. level-1 section 첫 슬라이드에 chapter-bignum 배경 + 강조 헤더
2. continuation 슬라이드 (2/3 등) hero 적용 X
3. level-2 subsection hero 적용 X (현 sample doc엔 해당 case 없음)
4. 다크/라이트 양쪽 gradient 자연
5. 슬라이드 수 유지 (4)
6. 회귀 0
7. 시각 audit before/after — chapter 슬라이드 임팩트 명확
8. visual-presentation baseline 갱신
9. 사이클 보고서 + archive

---

## 3. Estimate

| 작업 | 시간 |
|---|---|
| isChapterHero 분기 + chapter-bignum 렌더 | 10분 |
| CSS .slide-chapter-hero 스타일 + 다크 변형 | 15분 |
| audit 캡쳐 + 시각 확인 | 10분 |
| visual baseline 갱신 + typecheck + vitest | 10분 |
| commit + archive | 10분 |
| **합계** | **~55분** |

## 4. Risks

| 위험 | 대응 |
|---|---|
| 거대 번호 배경이 헤더 글자 가독성 해침 | gradient α20 (light) / α28 (dark) — 매우 옅게, 글자 위 z-1로 우선 |
| level 2 subsection도 hero가 적용되어 과함 | `slide.level === 1` 조건 명시 |
| 다른 sample doc에서 chapter 번호 길이 가변 (`A.1`, `Ⅴ` 등) | 폰트 monospace + letter-spacing 음수로 자연 압축. fallback 안전 |
| continuation 슬라이드도 같은 헤더 색으로 chapter 인식 — hero만 다르면 일관성 ↓ | 의도된 분리: chapter 첫 슬라이드 = hero (강조), 후속 = 평범 (안정). 발표 흐름에 맞음 |
