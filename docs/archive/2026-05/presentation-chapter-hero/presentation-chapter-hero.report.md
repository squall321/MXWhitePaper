---
template: report
version: 1.0
feature: presentation-chapter-hero
date: 2026-05-25
---

# Presentation Chapter Hero — Completion Report

> Match Rate: 100% / Duration: ~45분
> 사용자 체감 디자인 변화 (이전 사이클 *내부 구조* 위 *눈에 띄는 임팩트*)

## Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | 사용자: "지금 뭔가 엄청 바꾼 것 같은데 실제로 프레젠테이션 화면은 별로 바뀐 거 없는데?" 정직한 평가 — presentation-layout + followups 사이클이 슬라이드 수 7→4 / iframe placeholder / mobile fix / visual baseline 등 *내부 구조*는 정비했지만 **콘텐츠 자체 디자인은 거의 동일**. max-width 1200→1440, padding 약간만. 시각적 체감 적음. |
| **Solution** | level-1 section 의 *첫* 슬라이드 (continuation 아님) 에 chapter-hero 스타일 — 슬라이드 좌상단 배경에 *거대한 챕터 번호* (clamp 120-220px, semi-transparent gradient) + 헤더 글자는 z-1로 그 위에 + 헤더 하단 2px gradient 보더. continuation/level-2 슬라이드는 평범 헤더 유지. |
| **Function/UX Effect** | chapter 시작 슬라이드에 *거대한 1, 2* 가 좌상단 배경에 떠 있어 청자가 "새 챕터 시작" 즉시 인지. 이전 사이클들의 정비 (4 슬라이드, mobile fit, iframe) 위에 *발표 임팩트* 추가. continuation 슬라이드는 hero 없이 평범 → 챕터 안 흐름 일관성 유지. |
| **Core Value** | "내부 구조 + 시각 임팩트 = 발표 가능 + 청자 인지 부담 ↓ + 챕터 전환 명확" — 사용자 *체감 가능* 한 디자인 변화. *"별로 안 바뀐 것 같다"* 피드백이 *진짜 가치 있는* 디자인 사이클을 trigger. |

## What was Built

### Code (2 files)
- `Presentation.tsx`:
  - `isChapterHero = !isContinuation && slide.level === 1` 분기
  - `<span className="chapter-bignum">` 거대 번호 렌더 (hero일 때만)
  - className `slide-chapter-hero` 추가
- `Presentation.tsx` CSS:
  - `.slide-chapter-hero .slide-heading` margin/padding/보더
  - `.chapter-bignum` absolute 좌상단 + gradient + z-0 + pointer-events:none
  - light/dark gradient 별도 정의
  - h2 폰트 44-64px 약간 큼

### Tests
- 회귀 0 — vitest 1862/1862 + typecheck clean
- visual-presentation baseline 갱신 (4 PNG)

### 시각 audit
- 임시 `_preso-hero-audit.spec.ts` → 4 슬라이드 캡쳐 → 시각 확인 → 삭제
- before: 일반 헤더 "1 동기화 알고리즘" / after: 거대 `1` 배경 + 강조 헤더 + 보더

## What was *Not* Built

| 항목 | 사유 |
|---|---|
| level-2 subsection hero | 의도 — chapter 임팩트는 level-1 만. 너무 자주 등장하면 효과 ↓ |
| chapter divider *별도 슬라이드* (hero only) | 슬라이드 수 늘리는 trade-off — 현재 콘텐츠와 같이 있는 게 자연 |
| 다른 hero 스타일 (큰 사진 배경 등) | 사용자 콘텐츠 의존 — 별도 사용자 옵션 사이클 |
| animation (number fade-in 등) | reduced-motion 정책과 충돌 가능 — 별도 사이클 |

## Open Items (선택적)

| # | 항목 |
|---|---|
| 1 | section number 가 multi-segment (1.2.3 등) 일 때 polish |
| 2 | chapter hero를 사용자 옵션으로 끄기 (theme toggle 처럼) |
| 3 | section-divider only 슬라이드 옵션 (slide count +N) |

## Lessons

### 사용자 피드백이 진짜 가치 trigger
*"별로 안 바뀐 것 같다"* 라는 정직한 피드백이 *진짜* 사용자 체감 변화로 이끌었음. 이전 사이클들 (presentation-layout, followups) 은 *기술적으로* 큰 win 이지만 *시각적으로* 작음. 사용자가 보는 *첫 화면* 의 변화가 중요 — "끝까지 가봐야 보임" 은 영업 실패.

### Internal vs External 변화 구분
- **Internal**: 슬라이드 수, BUDGET, iframe timeout — *기능 안정성*
- **External**: chapter hero, 색, 폰트 — *사용자 체감*

둘 다 필요하지만 *체감 변화* 가 우선 사용자에게 *완료감* 줌. 내부 정리만 길게 하면 "왜 이렇게 오래?" 라고 보임.

### 슬라이드 수 늘리지 않는 디자인 변화
chapter divider 도입 = 보통 *별도 슬라이드* 1장 추가 — 슬라이드 수 ↑. 본 사이클은 *같은 슬라이드 안에서 디자인 임팩트* 만 — 슬라이드 수 4 유지. 본문도 같이 보여 *발표 효율* + *시각 임팩트* 둘 다.

### z-index + pointer-events 패턴
배경에 거대 데코 (chapter-bignum) 깔고 콘텐츠는 그 위 z-1 + 데코는 pointer-events:none. 흔한 hero 패턴. 향후 다른 영역 (title slide 등) 에도 재사용 가능.

## Status

- ✅ All phases done
- ⏳ Archive
- 🎯 사용자 피드백 따라 다음 (다른 sample doc 검증 / mobile audit / 다른 디자인 요소)
