---
template: report
version: 1.0
feature: presentation-followups
date: 2026-05-25
---

# Presentation Follow-ups — Completion Report

> Match Rate: 100% / Duration: ~1.5시간
> Open Items 4건 일괄 close, sample 5→4 슬라이드

## Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | presentation-layout 사이클의 *Open Items 4건* — slide-3 잠재, iframe silent fail, visual regression 미설정, mobile 미확인. 모두 *완성도*에 영향. |
| **Solution** | F1: slideMachine `_isSoloVisual` 직전 (heading-4 + paragraph) 페어 caption 흡수 + SubsectionInline body=0 skip / F2: SrcIframeWithFallback 4s timeout placeholder + "새 탭" 버튼 / F3: visual-presentation.spec.ts 4 baseline / F4: mobile audit + padding clamp + toolbar 충돌 fix. |
| **Function/UX Effect** | sample 슬라이드 5 → **4** (전체 7→4, -43%). iframe 차단 시 친절한 안내 + 호스트명 + 새 탭 버튼. 향후 변경 자동 검출 (visual baseline). mobile (375px) 정상 발표 가능. |
| **Core Value** | "presentation 모드 *완성도* + 자동 회귀 가드" — 큰 win 위에 디테일 마무리. 인프라 (visual regression) 정착으로 향후 회귀 방지. |

## What was Built

### Code (4 files + tests)
- `slideMachine.ts`: `_isSoloVisual` 직전 (heading-4 또는 paragraph) 캡션 흡수 while loop max 2 — "소제목 + 한 줄 설명 + 시각자료" 패턴
- `Presentation.tsx`:
  - SubsectionInline body=0 child=0 skip
  - `.slide padding: max(60px, clamp(16, 5vh, 56)) clamp(16, 5vw, 80) clamp(16, 5vh, 56)` — mobile padding 축소 + toolbar 충돌 60px 보장
  - iframe height `clamp(220, 65vh, 720)` — mobile 친화
- `IframeBlock.tsx`:
  - `SrcIframeWithFallback` 컴포넌트 추출
  - 4초 timeout → `'loading'` | `'loaded'` | `'blocked'` 상태
  - placeholder overlay: hostname + 로딩 메시지 + "새 탭에서 열기" (blocked 시)
  - `data-iframe-status` / `data-iframe-placeholder` attributes (테스트 anchor)
- `tests/e2e/visual-presentation.spec.ts`: 4 baseline (title + sec1 + sec2-chunk1 + sec2-final)

### Tests
- `slideMachine.test.ts` +2: heading-4 caption / (heading + paragraph + visual) triple
- `IframeBlock.test.tsx` NEW 4: html mode / src loading placeholder / figcaption / empty
- AllBlocksRender snapshot 1 update (iframe overlay 추가)
- Total 1862/1862 통과

## What was *Not* Built

| 항목 | 사유 |
|---|---|
| iframe blocked detection 정확도 향상 (4s timeout 외) | postMessage handshake 필요 — 외부 사이트 협조 필요. timeout 만으로 80% 케이스 커버 |
| mobile presentation visual regression baseline | mobile은 audit 기반 — baseline 추가는 별도 사이클 (chromium-mobile project 활성화 필요) |
| iframe sandbox 완화 옵션 | 보안 정책 변경 — 별도 PRD |

## Open Items (선택적)

| # | 항목 |
|---|---|
| 1 | mobile visual-presentation baseline (chromium-mobile project) |
| 2 | iframe handshake 기반 정확한 차단 검출 |
| 3 | presentation-darkmode audit (다크 테마 4 슬라이드) |

## Lessons

### Open Items as 1 통합 사이클
4 개 작은 fix를 *별 사이클로 분리*하면 6 commit + 4 archive 가 noise. 1 사이클로 묶으면 관련성 명확 + 시간 1.5h. **연관 Open Items는 묶기**.

### Audit script as throwaway (재확인)
`_preso-audit.spec.ts` + `_preso-mobile-audit.spec.ts` 사이클 안에서 *임시 도구*. 사이클 종료 시 삭제. 영구 baseline은 `visual-presentation.spec.ts` 가 담당. 두 spec의 책임 분리.

### desktop baseline 부수 갱신
mobile fix (`padding clamp`) 가 desktop padding도 약간 변경 → desktop baseline 깨짐. 의도된 *일관성* 갱신. update-snapshots 한 번에.

### sample 슬라이드 추이
- 원본 baseline: 7장
- presentation-layout: 5장 (-29%)
- presentation-followups: 4장 (-43% 누적)

같은 콘텐츠를 *발표 가능한 흐름* 으로 압축. 청자 인지 부담 누적 ↓.

## Status

- ✅ All phases done
- ⏳ Archive
- 🎯 presentation 모드 완성 — 추가 요청 시 mobile baseline / 다른 sample doc 검증
